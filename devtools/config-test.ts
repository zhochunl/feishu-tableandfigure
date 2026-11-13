import { lastSaved, renderedCount, setDashboard, setTable, setTableList } from './sdk-stub';
import {
  ALL_RANGE,
  defaultChart,
  levelIds,
  parseConfig,
  rangeKey,
  rangeLabel,
  resolveHeader,
  resolveJoin,
  resolveLevels,
  toSavePayload,
} from '../src/lib/config';
import { listRanges, loadChart, markRendered, saveChart } from '../src/lib/bitable';
import type { ChartConfig, FieldMeta } from '../src/lib/types';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `  实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`}`);
}

const fields: FieldMeta[] = [
  { id: 'fldSUBJ', name: 'SUBJECT', type: 1 },
  { id: 'fldSOC', name: 'AESOC', type: 3 },
  { id: 'fldPT', name: 'AEPT', type: 3 },
  { id: 'fldSER', name: 'AESER', type: 7 },
];

const headerFields: FieldMeta[] = [
  { id: 'hSUBJ', name: 'SUBJECT', type: 1 },
  { id: 'hARM', name: 'TRT01P', type: 3 },
];

const chart: ChartConfig = {
  tableId: 'tblAE',
  dataRange: { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件' },
  levels: [
    { fieldId: 'fldSOC', dedupe: true, distinctFieldId: 'fldSUBJ', percent: true },
    { fieldId: 'fldPT', distinctFieldId: 'fldSUBJ' },
  ],
};

// 解析后的规范形态：normalizeLevels 会补齐 dedupe/percent，往返比较都用它
const normalizedLevels = [
  { fieldId: 'fldSOC', dedupe: true, distinctFieldId: 'fldSUBJ', percent: true },
  { fieldId: 'fldPT', dedupe: false, distinctFieldId: 'fldSUBJ', percent: false },
];

const withHeader: ChartConfig = {
  ...chart,
  header: { tableId: 'tblDM', fieldId: 'hARM' },
  join: { fieldId: 'fldSUBJ', headerFieldId: 'hSUBJ' },
};

console.log('--- 写回宿主的 payload ---');
const payload = toSavePayload(chart);
check('1 dataConditions 一条，表与范围对得上', payload.dataConditions.length, 1);
check('1b 视图范围转成宿主枚举', payload.dataConditions[0].dataRange, {
  type: 'VIEW',
  viewId: 'viwGr',
  viewName: '严重不良事件',
});
check('2 groups 按层级顺序且多选拆开统计', payload.dataConditions[0].groups, [
  { fieldId: 'fldSOC', mode: 'enumerated', sort: { order: 1, sortType: 'VIEW' } },
  { fieldId: 'fldPT', mode: 'enumerated', sort: { order: 1, sortType: 'VIEW' } },
]);
check('2b 计数口径交给宿主是记录数', payload.dataConditions[0].series, 'COUNTA');
check('2c 去重/表头/百分比宿主都算不了，只进 customConfig', payload.customConfig, {
  aeThreeLine: { version: 2, ...chart },
});
check('2d 跨表连接不写进 dataConditions', toSavePayload(withHeader).dataConditions[0].groups.length, 2);

console.log('\n--- 配置往返 ---');
check('3 存进去读出来等价', parseConfig(payload), { ...chart, levels: normalizedLevels });
check('4 表头与连接一起往返', parseConfig(toSavePayload(withHeader)), {
  ...withHeader,
  levels: normalizedLevels,
});
check('5 全表范围往返', parseConfig(toSavePayload({ ...chart, dataRange: ALL_RANGE }))?.dataRange, ALL_RANGE);

// 老配置/别的图表配置：没有 customConfig 时从 dataConditions 还原，只是丢失去重与分列口径
const legacy = { dataConditions: [{ tableId: 'tblAE', dataRange: { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件' }, groups: [{ fieldId: 'fldSOC' }, { fieldId: 'fldPT' }] }] };
check('6 无 customConfig 时按 groups 还原', parseConfig(legacy), {
  tableId: 'tblAE',
  dataRange: { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件' },
  levels: [
    { fieldId: 'fldSOC', dedupe: false, percent: false },
    { fieldId: 'fldPT', dedupe: false, percent: false },
  ],
});
check('7 空配置返回 null', parseConfig({ dataConditions: [{ tableId: '' }] }), null);
check('8 版本不符时退回 dataConditions', parseConfig({ ...legacy, customConfig: { aeThreeLine: { version: 99, tableId: 'x', levels: [] } } })?.tableId, 'tblAE');
check('9 脏 levels 被过滤', parseConfig({ dataConditions: [], customConfig: { aeThreeLine: { version: 2, tableId: 'tblAE', dataRange: ALL_RANGE, levels: [{ fieldId: '' }, null, { fieldId: 'fldPT', distinctFieldId: '' }] } } })?.levels, [{ fieldId: 'fldPT', dedupe: false, percent: false }]);

console.log('\n--- v1 配置迁移 ---');
const v1 = { customConfig: { aeThreeLine: { version: 1, tableId: 'tblAE', dataRange: ALL_RANGE, levels: [{ fieldId: 'fldSOC', distinctFieldId: 'fldSUBJ' }, { fieldId: 'fldPT' }] } } };
check('10 v1 配了去重字段视作勾选去重', parseConfig(v1)?.levels, [
  { fieldId: 'fldSOC', dedupe: true, distinctFieldId: 'fldSUBJ', percent: false },
  { fieldId: 'fldPT', dedupe: false, percent: false },
]);
check('10b v1 没有表头配置', parseConfig(v1)?.header, undefined);
check('10c v2 取消勾选后保留去重字段', parseConfig({ customConfig: { aeThreeLine: { version: 2, tableId: 'tblAE', dataRange: ALL_RANGE, levels: [{ fieldId: 'fldSOC', dedupe: false, distinctFieldId: 'fldSUBJ' }] } } })?.levels, [
  { fieldId: 'fldSOC', dedupe: false, distinctFieldId: 'fldSUBJ', percent: false },
]);

console.log('\n--- 脏的表头/连接配置 ---');
check('11 表头没表 id 就当没配', parseConfig({ customConfig: { aeThreeLine: { version: 2, tableId: 'tblAE', dataRange: ALL_RANGE, levels: [{ fieldId: 'fldSOC' }], header: { tableId: '' }, join: { fieldId: 'fldSUBJ', headerFieldId: 'hSUBJ' } } } })?.header, undefined);
check('12 连接缺一侧就不分列', parseConfig({ customConfig: { aeThreeLine: { version: 2, tableId: 'tblAE', dataRange: ALL_RANGE, levels: [{ fieldId: 'fldSOC' }], header: { tableId: 'tblDM' }, join: { fieldId: 'fldSUBJ', headerFieldId: '' } } } })?.join, undefined);

console.log('\n--- fieldId 翻译成字段名 ---');
check('13 层级名、去重名与百分比', resolveLevels(chart, fields), [
  { field: 'AESOC', distinctBy: 'SUBJECT', percent: true },
  { field: 'AEPT', percent: false },
]);
check('14 没勾去重则不算例数', resolveLevels({ ...chart, levels: [{ fieldId: 'fldSOC', distinctFieldId: 'fldSUBJ' }] }, fields), [{ field: 'AESOC', percent: false }]);
check('15 字段被删则整层作废', resolveLevels({ ...chart, levels: [{ fieldId: 'fldGONE' }, { fieldId: 'fldPT' }] }, fields), [{ field: 'AEPT', percent: false }]);
check('16 表头解析出列变量名', resolveHeader(withHeader, headerFields), { tableId: 'tblDM', field: 'TRT01P' });
check('16b 列变量被删则退回总计列', resolveHeader({ ...withHeader, header: { tableId: 'tblDM', fieldId: 'hGONE' } }, headerFields), { tableId: 'tblDM' });
check('16c 没配表头返回 undefined', resolveHeader(chart, headerFields), undefined);
check('17 连接按两表同名字段各取一侧', resolveJoin(withHeader, fields, headerFields), { dataField: 'SUBJECT', headerField: 'SUBJECT' });
check('17b 任一侧字段被删就连不上', resolveJoin({ ...withHeader, join: { fieldId: 'fldGONE', headerFieldId: 'hSUBJ' } }, fields, headerFields), undefined);
check('17c 没有表头表时连接不生效', resolveJoin(chart, fields, headerFields), undefined);
check('18 钻取列取分组、去重与连接字段且不重复', levelIds(withHeader), ['fldSOC', 'fldSUBJ', 'fldPT']);
check('18b 没勾去重时不带去重字段', levelIds({ ...chart, levels: [{ fieldId: 'fldSOC', distinctFieldId: 'fldSUBJ' }] }), ['fldSOC']);
check('19 新建配置默认一层空', defaultChart('tblAE'), { tableId: 'tblAE', dataRange: ALL_RANGE, levels: [{ fieldId: '' }] });
check('20 范围文案', [rangeLabel(ALL_RANGE), rangeLabel(chart.dataRange), rangeLabel({ type: 'VIEW', viewId: 'v', filterInfo: {} })], ['全部数据', '严重不良事件', 'v（视图筛选）']);
check('21 范围键可作下拉 value', rangeKey(chart.dataRange) !== rangeKey(ALL_RANGE), true);

console.log('\n--- 与宿主的读写 ---');
setTableList([{ id: 'tblAE', name: 'AE', isSync: false }]);
setTable({ id: 'tblAE', getFieldMetaList: async () => fields, getViewMetaList: async () => [{ id: 'viwGr', name: '严重不良事件', type: 1 }] });
setDashboard({ ranges: [], config: null, state: 'Config' });

check('22 没配置时 loadChart 给 null', await loadChart(), null);
await saveChart(withHeader);
check('23 saveChart 落到宿主 saveConfig', lastSaved()?.customConfig, toSavePayload(withHeader).customConfig);
check('24 保存后能读回同一份配置', await loadChart(), { ...withHeader, levels: normalizedLevels });

// 宿主给不出数据范围（老版本/无权限）时，退回视图列表，至少要能选全部数据
check('25 getTableDataRange 失败时退回视图列表', await listRanges('tblAE'), [ALL_RANGE, { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件' }]);

setDashboard({ ranges: [{ type: 'ALL' }, { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件', filterInfo: { conditions: [] } }] });
check('26 宿主范围原样列出', await listRanges('tblAE'), [
  { type: 'ALL' },
  { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件', filterInfo: { conditions: [] } },
]);

// 独立页面打开时没有宿主，setRendered 失败不能让插件卡住
setDashboard({ config: null, renderFails: true });
const before = renderedCount();
await markRendered();
check('27 setRendered 异常被吞掉', renderedCount(), before);
check('28 读取配置异常时按未配置处理', await loadChart(), null);

console.log(`\n${failures ? `FAIL ${failures} 项` : '全部通过'}`);
process.exitCode = failures ? 1 : 0;
