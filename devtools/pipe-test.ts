import { openedRecords, setTable, setTableList } from './sdk-stub';
import { listTables, loadFields, loadRows, rowDisplay, showRecord } from '../src/lib/bitable';
import { aggregate } from '../src/lib/aeAggregate';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `  实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expected)}`}`);
}

const fieldMetas = [
  { id: 'fldSUBJ', name: 'SUBJECT', type: 1 },
  { id: 'fldSOC', name: 'AESOC', type: 3 },
  { id: 'fldPT', name: 'AEPT', type: 3 },
  { id: 'fldDATE', name: 'AESTDT', type: 5 },
];

// 真实形态：fields 以 fieldId 为 key，单选是 {id,text}，日期是毫秒戳
const rawRecords = [
  { recordId: 'r1', fields: { fldSUBJ: '001', fldSOC: { id: 'o1', text: '心脏疾病' }, fldPT: { id: 'p1', text: '心悸' }, fldDATE: Date.UTC(2026, 0, 5) } },
  { recordId: 'r2', fields: { fldSUBJ: '001', fldSOC: { id: 'o1', text: '心脏疾病' }, fldPT: { id: 'p2', text: '心动过速' }, fldDATE: Date.UTC(2026, 0, 6) } },
  { recordId: 'r3', fields: { fldSUBJ: '002', fldSOC: { id: 'o2', text: '胃肠疾病' }, fldPT: { id: 'p3', text: '恶心' }, fldDATE: Date.UTC(2026, 0, 7) } },
];

const pageSizes: number[] = [];
const pageParams: any[] = [];
setTable({
  id: 'tblAE',
  getFieldMetaList: async () => fieldMetas,
  getViewMetaList: async () => [{ id: 'viw1', name: '全部记录', type: 1 }],
  getRecords: async (param: any) => {
    pageSizes.push(param.pageSize);
    pageParams.push(param);
    // 模拟宿主只接受 <=500 的单页
    if (param.pageSize > 500) throw new Error('single record operation exceeds records limit');
    const start = param.pageToken ? Number(param.pageToken) : 0;
    const slice = rawRecords.slice(start, start + param.pageSize);
    const next = start + slice.length;
    return { records: slice, total: rawRecords.length, hasMore: next < rawRecords.length, pageToken: next };
  },
});
setTableList([{ id: 'tblAE', name: 'AE', isSync: false }]);

console.log('--- 表与字段 ---');
check('1 数据表列表', await listTables(), [{ id: 'tblAE', name: 'AE' }]);
check('2 字段元信息一次拿全', await loadFields('tblAE'), fieldMetas);

console.log('\n--- 读取全表并归一化 ---');
const progress: Array<[number, number]> = [];
const rows = await loadRows('tblAE', fieldMetas, { onProgress: (loaded, total) => progress.push([loaded, total]) });
check('3 行数', rows.length, 3);
check('3b 不再出现 fieldId，业务字段按字段名可读', Object.keys(rows[0].cells).sort(), ['AEPT', 'AESOC', 'AESTDT', 'SUBJECT']);
check('4 单选取到 text', rows[0].cells.AESOC, ['心脏疾病']);
check('4b 日期格式化', rows[0].cells.AESTDT.length, 1);
check('4c 日期不是毫秒戳原值', /^\d{4}-\d{2}-\d{2}/.test(rows[0].cells.AESTDT[0]), true);
check('5 单页超限自动降档', pageSizes[0] === 1000 && pageSizes.includes(500), true);
check('5b 进度回调带总数', progress.at(-1), [3, 3]);

console.log('\n--- 汇总（fieldId→字段名修复后应能正常分组）---');
const groups = aggregate(rows, [{ field: 'AESOC', distinctBy: 'SUBJECT' }, { field: 'AEPT', distinctBy: 'SUBJECT' }]);
check('6 组名不是空串也不是 [object Object]', groups.map(g => g.value), ['心脏疾病', '胃肠疾病']);
check('7 心脏疾病 例次/唯一人数', [groups[0].count, groups[0].distinct], [2, 1]);
check('8 子层 AEPT', groups[0].children.map(c => [c.value, c.count]).sort(), [['心悸', 1], ['心动过速', 1]].sort());

console.log('\n--- 钻取：零额外请求 ---');
check('9 读表阶段之后的 SDK 往返没有增加', pageSizes.length, 2);
const shown = rowDisplay(rows[0], fieldMetas);
check('10 弹窗表头用字段名', shown.map(s => s.name), ['SUBJECT', 'AESOC', 'AEPT', 'AESTDT']);
check('11 弹窗值可读', shown.map(s => s.text)[1], '心脏疾病');
await showRecord('tblAE', 'r1', ['fldSOC', 'fldPT']);
check('12 钻取走宿主原生记录卡片', openedRecords().at(-1), { tableId: 'tblAE', recordId: 'r1', fieldIdList: ['fldSOC', 'fldPT'] });

console.log('\n--- 数据范围透传 ---');
await loadRows('tblAE', fieldMetas, { range: { type: 'VIEW', viewId: 'viwGr', viewName: '严重不良事件' } });
check('12b 视图范围把 viewId 交给宿主', pageParams.at(-1)?.viewId, 'viwGr');
await loadRows('tblAE', fieldMetas, { range: { type: 'ALL' } });
check('12c 全部数据不带 viewId', pageParams.at(-1)?.viewId, undefined);

console.log('\n--- 大数据量：5 万行分页 ---');
const many = Array.from({ length: 50_001 }, (_, i) => ({ recordId: `m${i}`, fields: { fldSUBJ: `S${i % 300}`, fldSOC: { id: 'o1', text: 'SOC' }, fldPT: null, fldDATE: null } }));
let cursor = 0;
setTable({
  id: 'tblBig',
  getFieldMetaList: async () => fieldMetas,
  getRecords: async (param: any) => {
    const slice = many.slice(cursor, cursor + param.pageSize);
    cursor += slice.length;
    return { records: slice, total: many.length, hasMore: cursor < many.length, pageToken: undefined };
  },
});
const bigRows = await loadRows('tblBig', fieldMetas);
check('13 读全 5 万行', bigRows.length, 50_001);
check('14 去重人数正确', aggregate(bigRows, [{ field: 'AESOC', distinctBy: 'SUBJECT' }])[0].distinct, 300);

console.log(`\n${failures ? `FAIL ${failures} 项` : '全部通过'}`);
process.exitCode = failures ? 1 : 0;
