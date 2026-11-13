import { renderToStaticMarkup } from 'react-dom/server';
import { DrillDownModal } from '../src/components/DrillDownModal';
import { ThreeLineTable } from '../src/components/ThreeLineTable';
import { aggregate } from '../src/lib/aeAggregate';
import { normalizeCell } from '../src/lib/cellText';
import type { DataRow, FieldMeta } from '../src/lib/types';

let failures = 0;
function check(label: string, ok: boolean, extra = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` ${extra}`}`);
}

function row(recordId: string, raw: Record<string, unknown>, types: Record<string, number> = {}): DataRow {
  const cells: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(raw)) cells[name] = normalizeCell(value, types[name] ?? 1);
  return { recordId, cells };
}

const rows = [
  row('r1', { AESOC: '心脏疾病', AEPT: '心悸', SUBJECT: '001' }),
  row('r2', { AESOC: '心脏疾病', AEPT: '心悸', SUBJECT: '001' }),
  row('r3', { AESOC: '心脏疾病', AEPT: undefined, SUBJECT: '002' }),
  row('r4', { AESOC: '胃肠疾病', AEPT: '恶心', SUBJECT: '003' }),
];

const levels = [
  { field: 'AESOC', distinctBy: 'SUBJECT' },
  { field: 'AEPT', distinctBy: 'SUBJECT' },
];
const groups = aggregate(rows, levels);

console.log('--- 三线表渲染 ---');
const html = renderToStaticMarkup(
  <ThreeLineTable groups={groups} headers={['AESOC', 'AEPT']} distinctLevels={2} onDrill={() => {}} />,
);
check('表头层级用 ＞ 连接', html.includes('AESOC ＞ AEPT'));
check('出现例次与例数两列', html.includes('>例次<') && html.includes('>例数<'));
check('例次降序：心脏疾病(3) 在 胃肠疾病(1) 前', html.indexOf('心脏疾病') < html.indexOf('胃肠疾病'));
check('缺失子组显示为“缺失”而不是空白', html.includes('缺失'));
check('数字渲染成可点击按钮', (html.match(/class="cell-link"/g) ?? []).length >= 6, `实际 ${(html.match(/class="cell-link"/g) ?? []).length}`);
check('有子层的行带折叠按钮', html.includes('expand-btn'));
check('无子层的行用占位对齐', html.includes('expand-sp'));
check('子层缩进比父层深', /padding-left:26px/.test(html) && /padding-left:8px/.test(html), html.match(/padding-left:\d+px/g)?.join(','));

const noDistinct = renderToStaticMarkup(
  <ThreeLineTable groups={aggregate(rows, [{ field: 'AESOC' }])} headers={['AESOC']} distinctLevels={0} onDrill={() => {}} />,
);
check('未配去重时不出例数列', !noDistinct.includes('>例数<'));
check('空数据时给引导文案', renderToStaticMarkup(<ThreeLineTable groups={[]} headers={[]} distinctLevels={0} onDrill={() => {}} />).includes('没有可汇总的数据'));

console.log('\n--- 钻取弹窗 ---');
const fields: FieldMeta[] = [
  { id: 'fldSUBJ', name: 'SUBJECT', type: 1 },
  { id: 'fldSOC', name: 'AESOC', type: 3 },
  { id: 'fldPT', name: 'AEPT', type: 3 },
];
const target = groups[0].children.find(c => c.value === '心悸')!;
const modal = renderToStaticMarkup(
  <DrillDownModal
    path="心脏疾病 ＞ 心悸"
    rows={target.recordIds.map(id => rows.find(r => r.recordId === id)!)}
    columns={fields}
    tableId="tblAE"
    onClose={() => {}}
  />,
);
check('标题带层级路径', modal.includes('心脏疾病 ＞ 心悸'));
check('显示记录条数', modal.includes('2 条记录'));
check('表头是字段名而不是 fieldId', modal.includes('>SUBJECT<') && !modal.includes('fldSUBJ'));
check('值是文本而不是 [object Object]', modal.includes('心悸') && !modal.includes('[object Object]'));
check('每行有原生记录卡片入口', (modal.match(/详情/g) ?? []).length === 2);
check('不出现加载中文案（数据已在本地）', !modal.includes('加载中'));

const big = Array.from({ length: 260 }, (_, i) => row(`b${i}`, { SUBJECT: `S${i}`, AESOC: 'X', AEPT: 'Y' }));
const bigModal = renderToStaticMarkup(
  <DrillDownModal path="X" rows={big} columns={[fields[0]]} tableId="t" onClose={() => {}} />,
);
check('超过 200 条只渲染前 200 并提示', bigModal.includes('列表只显示前 200 条') && (bigModal.match(/<tr>/g) ?? []).length <= 202);

console.log(`\n${failures ? `FAIL ${failures} 项` : '全部通过'}`);
process.exitCode = failures ? 1 : 0;
