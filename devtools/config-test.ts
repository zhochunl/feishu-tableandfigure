import { lastSaved, renderedCount, setDashboard, setTable, setTableList } from './sdk-stub';
import { ALL_RANGE, defaultChart, levelIds, parseConfig, rangeKey, rangeLabel, resolveLevels, toSavePayload } from '../src/lib/config';
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

const chart: ChartConfig = {
  tableId: 'tblAE',
  dataRange: { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件' },
  levels: [
    { fieldId: 'fldSOC', distinctFieldId: 'fldSUBJ' },
    { fieldId: 'fldPT', distinctFieldId: 'fldSUBJ' },
  ],
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
check('3 去重口径只存在于 customConfig', payload.customConfig, {
  aeThreeLine: { version: 1, ...chart },
});

console.log('\n--- 配置往返 ---');
check('4 存进去读出来等价', parseConfig(payload), chart);
check('5 全表范围往返', parseConfig(toSavePayload({ ...chart, dataRange: ALL_RANGE }))?.dataRange, ALL_RANGE);

// 老配置/别的图表配置：没有 customConfig 时从 dataConditions 还原，丢失去重口径但不炸
const legacy = { dataConditions: [{ tableId: 'tblAE', dataRange: { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件' }, groups: [{ fieldId: 'fldSOC' }, { fieldId: 'fldPT' }] }] };
check('6 无 customConfig 时按 groups 还原', parseConfig(legacy), {
  tableId: 'tblAE',
  dataRange: { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件' },
  levels: [{ fieldId: 'fldSOC' }, { fieldId: 'fldPT' }],
});
check('7 空配置返回 null', parseConfig({ dataConditions: [{ tableId: '' }] }), null);
check('8 版本不符时退回 dataConditions', parseConfig({ ...legacy, customConfig: { aeThreeLine: { version: 99, tableId: 'x', levels: [] } } })?.tableId, 'tblAE');
check('9 脏 levels 被过滤', parseConfig({ dataConditions: [], customConfig: { aeThreeLine: { version: 1, tableId: 'tblAE', dataRange: ALL_RANGE, levels: [{ fieldId: '' }, null, { fieldId: 'fldPT', distinctFieldId: '' }] } } })?.levels, [{ fieldId: 'fldPT' }]);

console.log('\n--- fieldId 翻译成字段名 ---');
check('10 层级名与去重名', resolveLevels(chart, fields), [
  { field: 'AESOC', distinctBy: 'SUBJECT' },
  { field: 'AEPT', distinctBy: 'SUBJECT' },
]);
check('11 字段被删则整层作废', resolveLevels({ ...chart, levels: [{ fieldId: 'fldGONE' }, { fieldId: 'fldPT' }] }, fields), [{ field: 'AEPT' }]);
check('12 没配去重就不带 distinctBy', resolveLevels({ ...chart, levels: [{ fieldId: 'fldSOC' }] }, fields), [{ field: 'AESOC' }]);
check('13 钻取列取分组与去重字段且不重复', levelIds(chart), ['fldSOC', 'fldSUBJ', 'fldPT']);
check('14 新建配置默认一层空', defaultChart('tblAE'), { tableId: 'tblAE', dataRange: ALL_RANGE, levels: [{ fieldId: '' }] });
check('15 范围文案', [rangeLabel(ALL_RANGE), rangeLabel(chart.dataRange), rangeLabel({ type: 'VIEW', viewId: 'v', filterInfo: {} })], ['全部数据', '严重不良事件', 'v（视图筛选）']);
check('16 范围键可作下拉 value', rangeKey(chart.dataRange) !== rangeKey(ALL_RANGE), true);

console.log('\n--- 与宿主的读写 ---');
setTableList([{ id: 'tblAE', name: 'AE', isSync: false }]);
setTable({ id: 'tblAE', getFieldMetaList: async () => fields, getViewMetaList: async () => [{ id: 'viwGr', name: '严重不良事件', type: 1 }]});
setDashboard({ ranges: [], config: null, state: 'Config' });

check('17 没配置时 loadChart 给 null', await loadChart(), null);
await saveChart(chart);
check('18 saveChart 落到宿主 saveConfig', lastSaved()?.customConfig, payload.customConfig);
check('19 保存后能读回同一份配置', await loadChart(), chart);

// 宿主给不出数据范围（老版本/无权限）时，退回视图列表，至少要能选全部数据
const fallbackViews = await listRanges('tblAE');
check('20 getTableDataRange 失败时退回视图列表', fallbackViews, [ALL_RANGE, { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件' }]);

setDashboard({ ranges: [{ type: 'ALL' }, { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件', filterInfo: { conditions: [] } }] });
check('21 宿主范围原样列出', await listRanges('tblAE'), [
  { type: 'ALL' },
  { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件', filterInfo: { conditions: [] } },
]);

// 独立页面打开时没有宿主，setRendered 失败不能让插件卡住
setDashboard({ config: null, renderFails: true });
const before = renderedCount();
await markRendered();
check('22 setRendered 异常被吞掉', renderedCount(), before);
check('23 读取配置异常时按未配置处理', await loadChart(), null);

console.log(`\n${failures ? `FAIL ${failures} 项` : '全部通过'}`);
process.exitCode = failures ? 1 : 0;
