import { aggregate, attachHeaderFields, drillSortFields, planColumns, sortDrillRows, type HeaderSource } from '../src/lib/aeAggregate';
import { applyFilters } from '../src/lib/filters';
import { cellDisplay, normalizeCell } from '../src/lib/cellText';
import type { DataRow, FieldMeta, GroupCell, GroupRow, LevelConfig } from '../src/lib/types';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `  实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`}`);
}

function row(recordId: string, raw: Record<string, unknown>, types: Record<string, number> = {}): DataRow {
  const cells: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(raw)) cells[name] = normalizeCell(value, types[name] ?? 1);
  return { recordId, cells };
}

/** 汇总层级：不写 percent 就是不看百分比；distinctType 用来验证去重键的类型归一化 */
function lv(field: string, opts: { distinctBy?: string; distinctType?: number; percent?: boolean } = {}): LevelConfig {
  return { field, distinctBy: opts.distinctBy, distinctType: opts.distinctType, percent: !!opts.percent };
}

/** 不分列时的第一格，老用例都只看这一列 */
function cell(group: GroupRow): GroupCell {
  return group.cells[0];
}

function pick(groups: GroupRow[], value: string) {
  return groups.find(g => g.value === value)!;
}

// 表头表：两个试验组、三名受试者，列分母来自这里的记录数
const dm = [
  row('d1', { SUBJECT: '001', TRT01P: 'A组' }),
  row('d2', { SUBJECT: '002', TRT01P: 'A组' }),
  row('d3', { SUBJECT: '003', TRT01P: 'B组' }),
];
const bySubject: HeaderSource = { rows: dm, field: 'TRT01P', join: { dataField: 'SUBJECT', headerField: 'SUBJECT' } };

// 同一份 AE 数据：SOC 有 3 条（受试者 001 两次、002 一次），OTHER 1 条
const base = [
  row('r1', { AESOC: 'SOC', AEPT: 'PT1', SUBJECT: '001' }),
  row('r2', { AESOC: 'SOC', AEPT: 'PT1', SUBJECT: '001' }),
  row('r3', { AESOC: 'SOC', AEPT: 'PT2', SUBJECT: '002' }),
  row('r4', { AESOC: 'OTHER', AEPT: 'PT9', SUBJECT: '003' }),
];

// 没有表头配置时的计划，前面的用例都走这条路径
const flat = planColumns(base);

console.log('--- 计数与去重 ---');
let g = aggregate(base, [lv('AESOC')], flat);
check('1 单层例次', [cell(pick(g, 'SOC')).count, cell(pick(g, 'OTHER')).count], [3, 1]);
check('1b 未配去重时 distinct 为空', cell(pick(g, 'SOC')).distinct, undefined);

g = aggregate(base, [lv('AESOC', { distinctBy: 'SUBJECT' })], flat);
check('2 单层唯一数', [cell(pick(g, 'SOC')).count, cell(pick(g, 'SOC')).distinct], [3, 2]);
check('2b 另一组唯一数', cell(pick(g, 'OTHER')).distinct, 1);

g = aggregate(base, [lv('AESOC'), lv('AEPT')], flat);
const soc = pick(g, 'SOC');
check('3 两层例次', [cell(pick(soc.children, 'PT1')).count, cell(pick(soc.children, 'PT2')).count], [2, 1]);

g = aggregate(base, [lv('AESOC', { distinctBy: 'SUBJECT' }), lv('AEPT', { distinctBy: 'SUBJECT' })], flat);
const soc2 = pick(g, 'SOC');
check('4 两层父组唯一数（不能被子层相加污染）', cell(soc2).distinct, 2);
check('4b 子层唯一数', [cell(pick(soc2.children, 'PT1')).distinct, cell(pick(soc2.children, 'PT2')).distinct], [1, 1]);

console.log('\n--- 同一受试者跨子组：唯一数只算一次 ---');
const sameSubject = [row('r1', { AESOC: 'SOC', AEPT: 'A', SUBJECT: '001' }), row('r2', { AESOC: 'SOC', AEPT: 'B', SUBJECT: '001' })];
g = aggregate(sameSubject, [lv('AESOC', { distinctBy: 'SUBJECT' }), lv('AEPT', { distinctBy: 'SUBJECT' })], planColumns(sameSubject));
check('5 父组例次/唯一数', [cell(pick(g, 'SOC')).count, cell(pick(g, 'SOC')).distinct], [2, 1]);

console.log('\n--- 单元格类型归一化 ---');
const selectTyped = [
  row('r1', { AESOC: { id: 'o1', text: '心脏疾病' }, SUBJECT: '001' }, { AESOC: 3 }),
  row('r2', { AESOC: { id: 'o1', text: '心脏疾病' }, SUBJECT: '002' }, { AESOC: 3 }),
];
g = aggregate(selectTyped, [lv('AESOC', { distinctBy: 'SUBJECT' })], planColumns(selectTyped));
check('6 单选字段取 text，不出现 [object Object]', [g.length, g[0].value, cell(g[0]).distinct], [1, '心脏疾病', 2]);

const multi = [
  row('r1', { AESOC: [{ id: 'a', text: '胃肠系统' }, { id: 'b', text: '皮肤系统' }], SUBJECT: '001' }, { AESOC: 4 }),
  row('r2', { AESOC: { id: 'a', text: '胃肠系统' }, SUBJECT: '001' }, { AESOC: 3 }),
];
g = aggregate(multi, [lv('AESOC', { distinctBy: 'SUBJECT' })], planColumns(multi));
check('7 多选展开到各组的唯一数（组名排序后：胃肠系统=2 皮肤系统=1）', g.map(x => [x.value, cell(x).count, cell(x).distinct]), [
  ['胃肠系统', 2, 1],
  ['皮肤系统', 1, 1],
]);

const withMissing = [
  row('r1', { AESOC: 'SOC', SUBJECT: '001' }),
  row('r2', { AESOC: undefined, SUBJECT: '002' }),
  row('r3', { AESOC: null, SUBJECT: undefined }),
];
g = aggregate(withMissing, [lv('AESOC', { distinctBy: 'SUBJECT' })], planColumns(withMissing));
check('8 缺失组有名字且沉底', g.map(x => x.value), ['SOC', '缺失']);
check('8b 缺失组去重字段为空时不计入唯一数', [cell(pick(g, '缺失')).count, cell(pick(g, '缺失')).distinct], [2, 1]);

console.log('\n--- 去重键：字符型也能去重 ---');
// 真实飞书的文本单元格是富文本片段数组：同一段文字可能被格式切成几段，还常带首尾空白与零宽字符
const noisyText = [
  row('r1', { AESOC: 'SOC', SUBJECT: [{ type: 'text', text: 'S001' }] }, { AESOC: 1, SUBJECT: 1 }),
  row('r2', { AESOC: 'SOC', SUBJECT: [{ type: 'text', text: ' S001 ' }, { type: 'text', text: '' }] }, { AESOC: 1, SUBJECT: 1 }),
  row('r3', { AESOC: 'SOC', SUBJECT: [{ type: 'text', text: 'S0\u200b01' }] }, { AESOC: 1, SUBJECT: 1 }),
  row('r4', { AESOC: 'SOC', SUBJECT: [{ type: 'text', text: 'S' }, { type: 'text', text: '001' }] }, { AESOC: 1, SUBJECT: 1 }),
  row('r5', { AESOC: 'SOC', SUBJECT: [{ type: 'text', text: 'S002' }] }, { AESOC: 1, SUBJECT: 1 }),
];
g = aggregate(noisyText, [lv('AESOC', { distinctBy: 'SUBJECT', distinctType: 1 })], planColumns(noisyText));
check('8c 片段切分/首尾空白/零宽字符都算同一个值', [cell(pick(g, 'SOC')).count, cell(pick(g, 'SOC')).distinct], [5, 2]);

// 归一化只去首尾空白，不折叠中间空格，也不能把相近的编号并成一个
const nearValues = [
  row('r1', { AESOC: 'SOC', SUBJECT: [{ type: 'text', text: 'S001' }] }, { AESOC: 1, SUBJECT: 1 }),
  row('r2', { AESOC: 'SOC', SUBJECT: [{ type: 'text', text: 'S 001' }] }, { AESOC: 1, SUBJECT: 1 }),
  row('r3', { AESOC: 'SOC', SUBJECT: [{ type: 'text', text: 'S0010' }] }, { AESOC: 1, SUBJECT: 1 }),
];
g = aggregate(nearValues, [lv('AESOC', { distinctBy: 'SUBJECT', distinctType: 1 })], planColumns(nearValues));
check('8d 中间空格与相近编号不合并', cell(pick(g, 'SOC')).distinct, 3);

// 多选字段是集合：值相同但顺序不同不能算成两个对象
const shuffled = [
  row('r1', { AESOC: 'SOC', AEPTMOD: [{ id: 'a', text: '恶心' }, { id: 'b', text: '呕吐' }] }, { AESOC: 1, AEPTMOD: 4 }),
  row('r2', { AESOC: 'SOC', AEPTMOD: [{ id: 'a', text: '恶心' }, { id: 'b', text: '呕吐' }].reverse() }, { AESOC: 1, AEPTMOD: 4 }),
];
g = aggregate(shuffled, [lv('AESOC', { distinctBy: 'AEPTMOD', distinctType: 4 })], planColumns(shuffled));
check('8e 多选顺序不同算同一个对象', cell(pick(g, 'SOC')).distinct, 1);

// 去重键只服务例数，展示文本继续按顿号连接、保留原样
check('8f 展示文本不受去重键影响', cellDisplay([' S001 ', 'S002']), ' S001 、S002');

console.log('\n--- 钻取用的 recordIds（例次级别，不去重）---');
g = aggregate(base, [lv('AESOC'), lv('AEPT')], flat);
check('9 父组 recordIds 覆盖整桶', cell(pick(g, 'SOC')).recordIds, ['r1', 'r2', 'r3']);
check('9b 子组 recordIds', cell(pick(pick(g, 'SOC').children, 'PT1')).recordIds, ['r1', 'r2']);

console.log('\n--- 列计划：不配表头 ---');
check('10 不配表头只有一列总计', flat.columns, [{ key: '', label: '总计', total: 0 }]);
check('10b 全部记录都归这一列', flat.keysByRecord.size, 4);
check('10c 没有分母就不出百分比', cell(pick(aggregate(base, [lv('AESOC', { percent: true })], flat), 'SOC')).percent, undefined);

console.log('\n--- 列计划：只配表头表，不配列变量 ---');
const totalOnly = planColumns(base, { rows: dm });
check('11 一列总计，分母是表头表记录数', totalOnly.columns, [{ key: '', label: '总计', total: 3 }]);
check('11b 明细全部进总计列', totalOnly.keysByRecord.get('r4'), ['']);

console.log('\n--- 列计划：按表头列变量分列 ---');
const split = planColumns(base, bySubject);
check('12 列顺序跟表头表出现顺序，最右再补一列总计', split.columns.map(c => c.label), ['A组', 'B组', '总计']);
check('12b 每列分母是该列表头记录数，总计列是表头全表', split.columns.map(c => c.total), [2, 1, 3]);
check('12c 明细按连接变量归列，同时都进总计列', [split.keysByRecord.get('r1'), split.keysByRecord.get('r4')], [['A组', '__total__'], ['B组', '__total__']]);

g = aggregate(base, [lv('AESOC', { distinctBy: 'SUBJECT' })], split);
check('13 分列后每列各算例次/例数', pick(g, 'SOC').cells.map(c => [c.count, c.distinct]), [
  [3, 2],
  [0, 0],
  [3, 2],
]);
check('13b 另一组只落在 B 列', pick(g, 'OTHER').cells.map(c => [c.count, c.distinct]), [
  [0, 0],
  [1, 1],
  [1, 1],
]);
check('13c 六格钻取同一批例次记录', pick(g, 'SOC').cells.map(c => c.recordIds), [['r1', 'r2', 'r3'], [], ['r1', 'r2', 'r3']]);

console.log('\n--- 百分比：有去重就按例数 ---');
const pct = (row: GroupRow) => row.cells.map(c => Math.round((c.percent ?? 0) * 10) / 10);
g = aggregate(base, [lv('AESOC', { distinctBy: 'SUBJECT', percent: true })], split);
check('14 勾了去重用例数做分子（2/2，总计 2/3）', pct(pick(g, 'SOC')), [100, 0, 66.7]);
g = aggregate(base, [lv('AESOC', { percent: true })], split);
check('14b 没勾去重用例次做分子（3/2 可以超 100%）', pct(pick(g, 'SOC')), [150, 0, 100]);
g = aggregate(base, [lv('AESOC', { distinctBy: 'SUBJECT' })], split);
check('14c 不勾百分比就不算', pick(g, 'SOC').cells.map(c => c.percent), [undefined, undefined, undefined]);

console.log('\n--- 连不上表头表的记录 ---');
const withStray = [...base, row('r5', { AESOC: 'SOC', AEPT: 'PT1', SUBJECT: '009' })];
const stray = planColumns(withStray, bySubject);
check('15 匹配不到的记录计入 unmatched', stray.unmatched, 1);
check('15b 匹配不到的记录只进总计列', stray.keysByRecord.get('r5'), ['__total__']);
check('15c 分列不虚增，总计列按筛选后的明细全算', pick(aggregate(withStray, [lv('AESOC')], stray), 'SOC').cells.map(c => c.count), [3, 0, 4]);

console.log('\n--- 退回与边界 ---');
const noJoin = planColumns(base, { rows: dm, field: 'TRT01P' });
check('16 配了列变量但没配连接，退回一个总计列', noJoin.columns, [{ key: '', label: '总计', total: 3 }]);
const emptyHeader = planColumns(base, { rows: [], field: 'TRT01P', join: bySubject.join });
check('17 表头表空时只剩总计列', [emptyHeader.columns.map(c => c.label), emptyHeader.unmatched], [['总计'], 4]);
check('17b 没有分组列时只剩总计那一格', aggregate(base, [lv('AESOC')], emptyHeader).map(r => r.cells.map(c => c.count)), [[3], [1]]);
const twoArms = planColumns([row('r1', { AESOC: 'SOC', SUBJECT: '001' })], {
  rows: [row('d1', { SUBJECT: '001', TRT01P: [{ id: 'a', text: 'A组' }, { id: 'b', text: 'B组' }] }, { TRT01P: 4 })],
  field: 'TRT01P',
  join: bySubject.join,
});
check('18 表头一行多值时同一条明细计入两列', [twoArms.columns.map(c => c.label), twoArms.keysByRecord.get('r1')], [['A组', 'B组', '总计'], ['A组', 'B组', '__total__']]);
check('19 没有层级配置不出表', aggregate(base, [], flat), []);

console.log('\n--- 表头专有变量按连接变量补进明细 ---');
const aeFields: FieldMeta[] = [
  { id: 'a_soc', name: 'AESOC', type: 1 },
  { id: 'a_sub', name: 'SUBJECT', type: 1 },
  { id: 'a_sex', name: 'SEX', type: 1 },
];
const dmFields: FieldMeta[] = [
  { id: 'd_sub', name: 'SUBJECT', type: 1 },
  { id: 'd_arm', name: 'TRT01P', type: 1 },
  { id: 'd_sex', name: 'SEX', type: 1 },
];
// DM 有 TRT01P，AE 没有；SEX 两张表都有，以 AE 自己的为准
const dmArms = [
  row('d1', { SUBJECT: '001', TRT01P: 'A组', SEX: '女' }),
  row('d2', { SUBJECT: '002', TRT01P: 'A组', SEX: '男' }),
  row('d3', { SUBJECT: '003', TRT01P: 'B组', SEX: '女' }),
];
const aeArms = [
  row('r1', { AESOC: 'SOC', SUBJECT: '001', SEX: '男' }),
  row('r2', { AESOC: 'SOC', SUBJECT: '002', SEX: '男' }),
  row('r3', { AESOC: 'OTHER', SUBJECT: '003', SEX: '男' }),
  row('r4', { AESOC: 'SOC', SUBJECT: '009', SEX: '男' }),
];
const attached = attachHeaderFields(aeArms, dmArms, { dataField: 'SUBJECT', headerField: 'SUBJECT' }, aeFields);
check('20 只有表头表有的变量按连接值补到明细行上', attached.slice(0, 3).map(r => r.cells.TRT01P), [['A组'], ['A组'], ['B组']]);
check('21 同名变量以明细表自己的为准', attached.map(r => r.cells.SEX), [['男'], ['男'], ['男'], ['男']]);
check('21b 连不到表头记录的明细不补新列', attached[3].cells.TRT01P, undefined);
const multiJoin = attachHeaderFields(
  [row('r9', { AESOC: 'SOC', SUBJECT: ['001', '003'] }, { SUBJECT: 4 })],
  dmArms,
  { dataField: 'SUBJECT', headerField: 'SUBJECT' },
  aeFields,
);
check('22 一条明细连到多条表头记录时取值取并集', multiJoin[0].cells.TRT01P, ['A组', 'B组']);

// 表头配置里的筛选条件因此在明细上也生效：只留 A 组的 AE 记录
const onlyA = applyFilters(attached, [{ fieldId: 'd_arm', operator: 'eq', value: 'A组' }], dmFields);
check('23 表头的筛选条件能筛明细', onlyA.map(r => r.recordId), ['r1', 'r2']);
const splitA = planColumns(onlyA, {
  rows: applyFilters(dmArms, [{ fieldId: 'd_arm', operator: 'eq', value: 'A组' }], dmFields),
  field: 'TRT01P',
  join: { dataField: 'SUBJECT', headerField: 'SUBJECT' },
});
check('24 筛完只剩 A 组列，总计不再把 B 组算进来', [splitA.columns.map(c => [c.label, c.total]), aggregate(onlyA, [lv('AESOC')], splitA).map(r => [r.value, ...r.cells.map(c => c.count)])], [
  [['A组', 2], ['总计', 2]],
  [['SOC', 2, 2]],
]);

console.log('\n--- 钻取列表排序 ---');
const drillLevels = [lv('AESOC', { distinctBy: 'SUBJECT' }), lv('AEPT')];
const drillPool = [
  row('p1', { AESOC: 'SOC', AEPT: 'PT2', SUBJECT: '002' }),
  row('p2', { AESOC: 'SOC', AEPT: 'PT1', SUBJECT: '010' }),
  row('p3', { AESOC: 'SOC', AEPT: 'PT2', SUBJECT: '001' }),
  row('p4', { AESOC: 'SOC', AEPT: 'PT1', SUBJECT: '001' }),
  row('p5', { AESOC: 'SOC', AEPT: 'PT9' }),
];
check('25 排序字段：当前层去重变量 + 后续层级分组字段', drillSortFields(drillLevels, 0), ['SUBJECT', 'AEPT']);
check('26 去重变量按数字、同人再按后续层级，缺失沉底', sortDrillRows(drillPool, drillLevels, 0).map(r => r.recordId), ['p4', 'p3', 'p1', 'p2', 'p5']);
check('27 当前层没有去重变量时只看后续层级', drillSortFields([lv('AESOC'), lv('AEPT')], 0), ['AEPT']);
check('28 最末层没有可排字段时保持原顺序', sortDrillRows(drillPool, drillLevels, 1).map(r => r.recordId), ['p1', 'p2', 'p3', 'p4', 'p5']);

console.log(`\n${failures ? `FAIL ${failures} 项` : '全部通过'}`);
process.exitCode = failures ? 1 : 0;
