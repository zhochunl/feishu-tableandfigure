import { renderToStaticMarkup } from 'react-dom/server';
import { ConfigPanel } from '../src/components/ConfigPanel';
import { DrillDownModal } from '../src/components/DrillDownModal';
import { ThreeLineTable } from '../src/components/ThreeLineTable';
import { aggregate, planColumns } from '../src/lib/aeAggregate';
import { normalizeCell } from '../src/lib/cellText';
import type { ChartConfig, DataRow, FieldMeta, LevelConfig } from '../src/lib/types';

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

// 表头表把明细分成 A组 / B组 两列
const dmRows = [
  row('d1', { SUBJECT: '001', TRT01P: 'A组' }),
  row('d2', { SUBJECT: '002', TRT01P: 'A组' }),
  row('d3', { SUBJECT: '003', TRT01P: 'B组' }),
];

const levels: LevelConfig[] = [
  { field: 'AESOC', distinctBy: 'SUBJECT', percent: true },
  { field: 'AEPT', distinctBy: 'SUBJECT', percent: true },
];

const split = planColumns(rows, { rows: dmRows, field: 'TRT01P', join: { dataField: 'SUBJECT', headerField: 'SUBJECT' } });
const flat = planColumns(rows);

console.log('--- 三线表渲染 ---');
const html = renderToStaticMarkup(<ThreeLineTable rows={aggregate(rows, levels, split)} levels={levels} columns={split.columns} onDrill={() => {}} />);
check('表头层级用 ＞ 连接', html.includes('AESOC ＞ AEPT'));
check('列变量各出一个表头', html.includes('>A组<') && html.includes('>B组<'));
check('老版「例次/例数」两个表头不再出现', !html.includes('>例次<') && !html.includes('>例数<'));
check('例次降序：心脏疾病(3) 在 胃肠疾病(1) 前', html.indexOf('心脏疾病') < html.indexOf('胃肠疾病'));
check('例数写在括号里', html.includes('class="paren"'));
check('百分比写在括号后', html.includes('class="pct"') && html.includes('100.0%'));
check('缺失子组显示为“缺失”而不是空白', html.includes('缺失'));
check('数字渲染成可点击按钮', (html.match(/class="cell-link"/g) ?? []).length >= 8, `实际 ${(html.match(/class="cell-link"/g) ?? []).length}`);
check('例次为 0 的列只剩一个 0', /class="na">0</.test(html));
check('有子层的行带折叠按钮', html.includes('expand-btn'));
check('无子层的行用占位对齐', html.includes('expand-sp'));
check('子层缩进比父层深', /padding-left:26px/.test(html) && /padding-left:8px/.test(html), html.match(/padding-left:\d+px/g)?.join(','));

const noHeader = renderToStaticMarkup(<ThreeLineTable rows={aggregate(rows, levels, flat)} levels={levels} columns={flat.columns} onDrill={() => {}} />);
check('不配表头只有一列「全部」', noHeader.includes('>全部<'));
check('没有分母就不出百分比', !noHeader.includes('class="pct"'));

const noPercent = renderToStaticMarkup(
  <ThreeLineTable
    rows={aggregate(rows, [{ field: 'AESOC', distinctBy: 'SUBJECT', percent: false }], split)}
    levels={[{ field: 'AESOC', distinctBy: 'SUBJECT', percent: false }]}
    columns={split.columns}
    onDrill={() => {}}
  />,
);
check('不勾百分比时即使有分母也不显示', !noPercent.includes('class="pct"'));
check('未配去重时不出括号例数', !renderToStaticMarkup(
  <ThreeLineTable rows={aggregate(rows, [{ field: 'AESOC', percent: false }], flat)} levels={[{ field: 'AESOC', percent: false }]} columns={flat.columns} onDrill={() => {}} />,
).includes('class="paren"'));
check('空数据时给引导文案', renderToStaticMarkup(<ThreeLineTable rows={[]} levels={[]} columns={flat.columns} onDrill={() => {}} />).includes('没有可汇总的数据'));

console.log('\n--- 钻取弹窗 ---');
const fields: FieldMeta[] = [
  { id: 'fldSUBJ', name: 'SUBJECT', type: 1 },
  { id: 'fldSOC', name: 'AESOC', type: 3 },
  { id: 'fldPT', name: 'AEPT', type: 3 },
];
const soc = aggregate(rows, levels, split)[0];
const palpitation = soc.children.find(c => c.value === '心悸')!;
const cellA = palpitation.cells[0];
const modal = renderToStaticMarkup(
  <DrillDownModal
    path="心脏疾病 ＞ 心悸"
    columnLabel="A组"
    rows={cellA.recordIds.map(id => rows.find(r => r.recordId === id)!)}
    columns={fields}
    tableId="tblAE"
    dedupe={{ field: 'SUBJECT', count: cellA.distinct ?? 0 }}
    total={split.columns[0].total}
    onClose={() => {}}
  />,
);
check('标题带层级路径与列名', modal.includes('心脏疾病 ＞ 心悸') && modal.includes('A组'));
check('汇总行说明例次/去重/该列合计', modal.includes('例次 2 条') && modal.includes('按 SUBJECT 去重 1 人') && modal.includes('该列合计 2'), modal.match(/modal-count[^<]*<\/span>/)?.[0]);
check('表头是字段名而不是 fieldId', modal.includes('>SUBJECT<') && !modal.includes('fldSUBJ'));
check('值是文本而不是 [object Object]', modal.includes('心悸') && !modal.includes('[object Object]'));
check('整行可点，不再排「操作」列', !modal.includes('>操作<') && !/<td><button/.test(modal));
check('弹窗是标准 dialog 语义', modal.includes('role="dialog"'));
check('不出现加载中文案（数据已在本地）', !modal.includes('加载中'));

const noDedupe = renderToStaticMarkup(
  <DrillDownModal path="X" columnLabel="" rows={rows} columns={fields} tableId="t" onClose={() => {}} />,
);
check('没勾去重时不提去重人数', !noDedupe.includes('去重') && noDedupe.includes('例次 4 条'));

const big = Array.from({ length: 260 }, (_, i) => row(`b${i}`, { SUBJECT: `S${i}`, AESOC: 'X', AEPT: 'Y' }));
const bigModal = renderToStaticMarkup(
  <DrillDownModal path="X" columnLabel="" rows={big} columns={[fields[0]]} tableId="t" onClose={() => {}} />,
);
check('超过 200 条只渲染前 200 并提示', bigModal.includes('列表只显示前 200 条') && (bigModal.match(/<tr>/g) ?? []).length <= 202);

console.log('\n--- 配置面板 ---');
const panelFields: FieldMeta[] = [
  { id: 'fldSUBJ', name: 'SUBJECT', type: 1 },
  { id: 'fldSOC', name: 'AESOC', type: 3 },
  { id: 'fldPT', name: 'AEPT', type: 3 },
];
const panelHeaderFields: FieldMeta[] = [
  { id: 'hSUBJ', name: 'SUBJECT', type: 1 },
  { id: 'hARM', name: 'TRT01P', type: 3 },
];
const panelTables = [
  { id: 'tblAE', name: 'AE' },
  { id: 'tblDM', name: 'DM' },
];

function panel(chart: ChartConfig) {
  return renderToStaticMarkup(
    <ConfigPanel
      chart={chart}
      tables={panelTables}
      ranges={[{ type: 'ALL' }]}
      fields={panelFields}
      headerFields={panelHeaderFields}
      busy={false}
      error=""
      onChange={() => {}}
      onSave={() => {}}
    />,
  );
}

const baseChart: ChartConfig = { tableId: 'tblAE', dataRange: { type: 'ALL' }, levels: [{ fieldId: 'fldSOC', dedupe: true, distinctFieldId: 'fldSUBJ' }] };
const headerChart: ChartConfig = {
  ...baseChart,
  levels: [{ fieldId: 'fldSOC', dedupe: true, distinctFieldId: 'fldSUBJ', percent: true }],
  header: { tableId: 'tblDM', fieldId: 'hARM' },
  join: { fieldId: 'fldSUBJ', headerFieldId: 'hSUBJ' },
};
const panelHtml = panel(baseChart);
const headerPanel = panel(headerChart);
check('自上而下三块：表头配置、连接变量、数据表配置', panelHtml.indexOf('表头配置') < panelHtml.indexOf('连接变量') && panelHtml.indexOf('连接变量') < panelHtml.indexOf('数据表配置'));
check('分组下拉按传入的字段顺序', (panelHtml.match(/>(SUBJECT|AESOC|AEPT)</g) ?? []).slice(0, 3), ['>SUBJECT<', '>AESOC<', '>AEPT<']);
check('去重下拉只列变量名', !panelHtml.includes('唯一计数字段') && !panelHtml.includes('（去重'));
check('勾选去重后去重下拉可用', !/class="pick is-optional[^"]*"[^>]*disabled/.test(panelHtml));
check('未勾去重时去重下拉禁用', /class="pick is-optional[^"]*"[^>]*disabled/.test(panel({ tableId: 'tblAE', dataRange: { type: 'ALL' }, levels: [{ fieldId: 'fldSOC', distinctFieldId: 'fldSUBJ' }] })));
check('没配表头时百分比勾选禁用并说明原因', /disabled=""[^>]*>百分比/.test(panelHtml) && panelHtml.includes('需要先配置表头'));
check('配了表头后百分比勾选可用', /checked=""[^>]*>百分比/.test(headerPanel) && !/disabled=""[^>]*>百分比/.test(headerPanel));
check('表头表单下拉列出其它表', panelHtml.includes('>DM<'));
check('没配表头时列变量与连接变量禁用', (panelHtml.match(/disabled/g) ?? []).length >= 4, `实际 ${(panelHtml.match(/disabled/g) ?? []).length}`);
check('配了表头后列出表头的列变量', headerPanel.includes('>TRT01P<'));
const emptyLevels = panel({ tableId: 'tblAE', dataRange: { type: 'ALL' }, levels: [{ fieldId: '' }] });
check('没配层级时保存禁用', /class="btn-primary"[^>]*disabled/.test(emptyLevels));

console.log(`\n${failures ? `FAIL ${failures} 项` : '全部通过'}`);
process.exitCode = failures ? 1 : 0;
