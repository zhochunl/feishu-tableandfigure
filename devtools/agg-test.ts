import { aggregate } from '../src/lib/aeAggregate';
import { normalizeCell } from '../src/lib/cellText';
import type { DataRow, GroupRow } from '../src/lib/types';

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

function pick(groups: GroupRow[], value: string) {
  return groups.find(g => g.value === value)!;
}

// 同一份 AE 数据：SOC 有 3 条（受试者 001 两次、002 一次），OTHER 1 条
const base = [
  row('r1', { AESOC: 'SOC', AEPT: 'PT1', SUBJECT: '001' }),
  row('r2', { AESOC: 'SOC', AEPT: 'PT1', SUBJECT: '001' }),
  row('r3', { AESOC: 'SOC', AEPT: 'PT2', SUBJECT: '002' }),
  row('r4', { AESOC: 'OTHER', AEPT: 'PT9', SUBJECT: '003' }),
];

console.log('--- 计数与去重 ---');
let g = aggregate(base, [{ field: 'AESOC' }]);
check('1 单层例次', [pick(g, 'SOC').count, pick(g, 'OTHER').count], [3, 1]);
check('1b 未配去重时 distinct 为空', pick(g, 'SOC').distinct, undefined);

g = aggregate(base, [{ field: 'AESOC', distinctBy: 'SUBJECT' }]);
check('2 单层唯一数', [pick(g, 'SOC').count, pick(g, 'SOC').distinct, pick(g, 'OTHER').distinct], [3, 2, 1]);

g = aggregate(base, [{ field: 'AESOC' }, { field: 'AEPT' }]);
const soc = pick(g, 'SOC');
check('3 两层例次', [pick(soc.children, 'PT1').count, pick(soc.children, 'PT2').count], [2, 1]);

g = aggregate(base, [{ field: 'AESOC', distinctBy: 'SUBJECT' }, { field: 'AEPT', distinctBy: 'SUBJECT' }]);
const soc2 = pick(g, 'SOC');
check('4 两层父组唯一数（不能被子层相加污染）', soc2.distinct, 2);
check('4b 子层唯一数', [pick(soc2.children, 'PT1').distinct, pick(soc2.children, 'PT2').distinct], [1, 1]);

console.log('\n--- 同一受试者跨子组：唯一数只算一次 ---');
const sameSubject = [
  row('r1', { AESOC: 'SOC', AEPT: 'A', SUBJECT: '001' }),
  row('r2', { AESOC: 'SOC', AEPT: 'B', SUBJECT: '001' }),
];
g = aggregate(sameSubject, [{ field: 'AESOC', distinctBy: 'SUBJECT' }, { field: 'AEPT', distinctBy: 'SUBJECT' }]);
check('5 父组例次/唯一数', [pick(g, 'SOC').count, pick(g, 'SOC').distinct], [2, 1]);

console.log('\n--- 单元格类型归一化 ---');
const selectTyped = [
  row('r1', { AESOC: { id: 'o1', text: '心脏疾病' }, SUBJECT: '001' }, { AESOC: 3 }),
  row('r2', { AESOC: { id: 'o1', text: '心脏疾病' }, SUBJECT: '002' }, { AESOC: 3 }),
];
g = aggregate(selectTyped, [{ field: 'AESOC', distinctBy: 'SUBJECT' }]);
check('6 单选字段取 text，不出现 [object Object]', [g.length, g[0].value, g[0].distinct], [1, '心脏疾病', 2]);

const multi = [
  row('r1', { AESOC: [{ id: 'a', text: '胃肠系统' }, { id: 'b', text: '皮肤系统' }], SUBJECT: '001' }, { AESOC: 4 }),
  row('r2', { AESOC: { id: 'a', text: '胃肠系统' }, SUBJECT: '001' }, { AESOC: 3 }),
];
g = aggregate(multi, [{ field: 'AESOC', distinctBy: 'SUBJECT' }]);
check('7 多选展开到各组的唯一数（组名排序后：胃肠系统=2 皮肤系统=1）', g.map(x => [x.value, x.count, x.distinct]), [
  ['胃肠系统', 2, 1],
  ['皮肤系统', 1, 1],
]);

const withMissing = [
  row('r1', { AESOC: 'SOC', SUBJECT: '001' }),
  row('r2', { AESOC: undefined, SUBJECT: '002' }),
  row('r3', { AESOC: null, SUBJECT: undefined }),
];
g = aggregate(withMissing, [{ field: 'AESOC', distinctBy: 'SUBJECT' }]);
check('8 缺失组有名字且沉底', g.map(x => x.value), ['SOC', '缺失']);
check('8b 缺失组去重字段为空时不计入唯一数', [pick(g, '缺失').count, pick(g, '缺失').distinct], [2, 1]);

console.log('\n--- 钻取用的 recordIds ---');
g = aggregate(base, [{ field: 'AESOC' }, { field: 'AEPT' }]);
check('9 父组 recordIds 覆盖整桶', pick(g, 'SOC').recordIds, ['r1', 'r2', 'r3']);
check('9b 子组 recordIds', pick(pick(g, 'SOC').children, 'PT1').recordIds, ['r1', 'r2']);

console.log(`\n${failures ? `FAIL ${failures} 项` : '全部通过'}`);
process.exitCode = failures ? 1 : 0;
