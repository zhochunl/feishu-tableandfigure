import { aggregate, planColumns } from '../src/lib/aeAggregate';
import { FILTER_OPERATORS, applyFilters, candidateValues, isComparable, operatorsFor, resolveFilters } from '../src/lib/filters';
import type { DataRow, FieldMeta, FilterCondition } from '../src/lib/types';

let failures = 0;
function check(label: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` ${extra}`}`);
}

const fields: FieldMeta[] = [
  { id: 'fldSUBJ', name: 'SUBJECT', type: 1 },
  { id: 'fldSOC', name: 'AESOC', type: 3 },
  { id: 'fldPT', name: 'AEPT', type: 4 },
  { id: 'fldGR', name: 'AETOXGR', type: 2 },
  { id: 'fldDATE', name: 'AESTDT', type: 5 },
  { id: 'fldSER', name: 'AESER', type: 7 },
  { id: 'fldGONE', name: 'REMOVED', type: 1 },
];

function row(recordId: string, cells: Record<string, string[]>): DataRow {
  return { recordId, cells };
}

const rows: DataRow[] = [
  row('r1', { SUBJECT: ['S001'], AESOC: ['心脏疾病'], AEPT: ['心悸', '头痛'], AETOXGR: ['3'], AESTDT: ['2026-01-05'], AESER: ['是'] }),
  row('r2', { SUBJECT: ['S002'], AESOC: ['胃肠疾病'], AEPT: ['恶心'], AETOXGR: ['1'], AESTDT: ['2026-02-10'], AESER: ['否'] }),
  row('r3', { SUBJECT: ['S003'], AESOC: [], AEPT: [], AETOXGR: ['5'], AESTDT: ['2026-03-01'], AESER: ['是'] }),
  row('r4', { SUBJECT: ['s001'], AESOC: ['心脏疾病'], AEPT: ['咳嗽'], AETOXGR: ['10'], AESTDT: ['2026-04-20'], AESER: ['否'] }),
];

const cond = (fieldId: string, operator: FilterCondition['operator'], value?: string): FilterCondition[] => [
  { fieldId, operator, value },
];

const ids = (items: DataRow[]) => items.map(item => item.recordId).join(',');

check('1 操作符就这八个', FILTER_OPERATORS.map(op => op.label).join('|') === '大于|等于|小于|大于等于|不等于|小于等于|属于|不属于');

console.log('\n--- 相等与集合 ---');
check('2 等于命中单选', ids(applyFilters(rows, cond('fldSOC', 'eq', '心脏疾病'), fields)) === 'r1,r4');
check('3 等于大小写不敏感', ids(applyFilters(rows, cond('fldSUBJ', 'eq', 'S001'), fields)) === 'r1,r4');
check('4 不等于取补集', ids(applyFilters(rows, cond('fldSOC', 'ne', '心脏疾病'), fields)) === 'r2,r3');
check('5 属于逗号分隔', ids(applyFilters(rows, cond('fldSOC', 'in', '心脏疾病,胃肠疾病'), fields)) === 'r1,r2,r4');
check('6 属于支持中文逗号', ids(applyFilters(rows, cond('fldSOC', 'in', '心脏疾病，胃肠疾病'), fields)) === 'r1,r2,r4');
check('7 不属于取补集', ids(applyFilters(rows, cond('fldSOC', 'notIn', '心脏疾病,胃肠疾病'), fields)) === 'r3');
check('8 多选任一命中', ids(applyFilters(rows, cond('fldPT', 'eq', '头痛'), fields)) === 'r1');

console.log('\n--- 大小比较：数值列与日期列 ---');
check('9 大于按数值', ids(applyFilters(rows, cond('fldGR', 'gt', '3'), fields)) === 'r3,r4');
check('10 大于等于含边界', ids(applyFilters(rows, cond('fldGR', 'gte', '3'), fields)) === 'r1,r3,r4');
check('11 小于按数值', ids(applyFilters(rows, cond('fldGR', 'lt', '3'), fields)) === 'r2');
check('12 小于等于含边界', ids(applyFilters(rows, cond('fldGR', 'lte', '3'), fields)) === 'r1,r2');
check('13 大于按日期', ids(applyFilters(rows, cond('fldDATE', 'gt', '2026-03-01'), fields)) === 'r4');
check('14 大于等于按日期', ids(applyFilters(rows, cond('fldDATE', 'gte', '2026-03-01'), fields)) === 'r3,r4');
check('15 小于等于按日期', ids(applyFilters(rows, cond('fldDATE', 'lte', '2026-02-10'), fields)) === 'r1,r2');

console.log('\n--- 多条与作废 ---');
check('16 多条之间取且', ids(applyFilters(rows, [{ fieldId: 'fldSOC', operator: 'eq', value: '心脏疾病' }, { fieldId: 'fldGR', operator: 'gt', value: '5' }], fields)) === 'r4');
check('17 字段被删的条件作废', ids(applyFilters(rows, cond('fldZZZ', 'eq', 'x'), fields)) === ids(rows));
check('18 没填值的条件作废', ids(applyFilters(rows, cond('fldSOC', 'eq', '  '), fields)) === ids(rows));
check('19 无条件时原样返回', applyFilters(rows, [], fields) === rows);
// 单选列既不是数值也不是日期，配了大于也不该悄悄按文本比出结果来
check('20 非数值非日期列的比较作废', ids(applyFilters(rows, cond('fldSOC', 'gt', '3'), fields)) === ids(rows));
check('21 比较条件解析阶段就丢掉', resolveFilters(cond('fldPT', 'lte', '5'), fields).length === 0);

console.log('\n--- 操作符按字段类型给 ---');
check('22 数值列八个全开', operatorsFor(fields.find(f => f.id === 'fldGR'))?.length === 8);
check('23 日期列八个全开', operatorsFor(fields.find(f => f.id === 'fldDATE'))?.length === 8);
check('24 单选列只留四个', operatorsFor(fields.find(f => f.id === 'fldSOC'))?.map(op => op.value).join('|') === 'eq|ne|in|notIn');
check('25 没选字段时也只留四个', operatorsFor(undefined)?.map(op => op.value).join('|') === 'eq|ne|in|notIn');
check('26 数值与日期可比较，其余不可', isComparable(fields[3]) && isComparable(fields[4]) && !isComparable(fields[1]) && !isComparable(fields[5]));

console.log('\n--- 解析与候选值 ---');
const resolved = resolveFilters([{ fieldId: 'fldSOC', operator: 'eq', value: ' 心脏疾病 ' }, { fieldId: '', operator: 'eq', value: 'x' }], fields);
check('27 解析成字段名', resolved.length === 1 && resolved[0].field === 'AESOC' && resolved[0].value === '心脏疾病');

const candidates = candidateValues(rows, fields);
check('28 候选值去重', candidates.fldSOC.join('|') === '心脏疾病|胃肠疾病');
check('29 候选值含多选展开', candidates.fldPT.join('|') === '心悸|头痛|恶心|咳嗽');
check('30 候选值保留空字段位', 'fldSER' in candidates && candidates.fldSER.join('|') === '是|否');
check('31 候选值有上限', candidateValues(Array.from({ length: 100 }, (_, i) => row(`r${i}`, { AESOC: [`SOC${i}`] })), fields, 10).fldSOC.length === 10);

const keep = applyFilters(rows, cond('fldSOC', 'in', '心脏疾病,胃肠疾病'), fields);
const counted = aggregate(keep, [{ field: 'AESOC', percent: false }], planColumns(keep));
check('32 缺失组被筛掉后不再出现', counted.map(g => g.value).join('|') === '心脏疾病|胃肠疾病');
check('33 计数只算筛选后的记录', counted.find(g => g.value === '心脏疾病')?.cells[0].count === 2);

console.log(failures ? `\n${failures} 项失败` : '\n筛选全部通过');
process.exitCode = failures ? 1 : 0;
