import { bitable, dashboard, ui, ViewType, type ITable } from '@lark-base-open/js-sdk';
import { cellDisplay, normalizeCell } from './cellText';
import { ALL_RANGE, parseConfig, toSavePayload } from './config';
import type { ChartConfig, DataRange, DataRow, FieldMeta, TableEntry } from './types';

/** 读取分页大小：被宿主拒绝时沿这个阶梯往下退。 */
const READ_SIZES = [1000, 500, 200, 100];

export async function listTables(): Promise<TableEntry[]> {
  const metas = await bitable.base.getTableMetaList();
  return metas.map(meta => ({ id: meta.id, name: meta.name }));
}

/**
 * 字段元信息一次拿全，避免逐字段 getName/getType 往返。
 * 顺序取视图的 getFieldMetaList（SDK 注明有序），table 那份只用来补全视图里没列出的字段；
 * 直接用 table 那份会拿到乱序，下拉框里的变量顺序就和表里对不上了。
 */
export async function loadFields(tableId: string, viewId?: string): Promise<FieldMeta[]> {
  const table = await bitable.base.getTableById(tableId);
  const metas = (await table.getFieldMetaList()).filter(meta => typeof meta.name === 'string' && meta.name);
  const byId = new Map(metas.map(meta => [meta.id, meta]));
  const ordered: FieldMeta[] = [];

  for (const id of await viewFieldOrder(table, viewId)) {
    const meta = byId.get(id);
    if (meta) {
      ordered.push(meta);
      byId.delete(id);
    }
  }
  return [...ordered, ...byId.values()].map(meta => ({ id: meta.id, name: meta.name, type: meta.type }));
}

/** 视图给不出顺序时返回空数组，调用方退回宿主给的顺序。 */
async function viewFieldOrder(table: ITable, viewId?: string): Promise<string[]> {
  try {
    let target = viewId;
    if (!target) {
      const views = await table.getViewMetaList();
      target = views.find(view => view.type === ViewType.Grid)?.id ?? views[0]?.id;
    }
    if (!target) return [];
    return (await (await table.getViewById(target)).getFieldMetaList()).map(meta => meta.id);
  } catch {
    return [];
  }
}

/**
 * 可选数据范围。宿主给不出来的时候退回视图列表，
 * 至少保证「全部数据 + 各视图」还能选。
 */
export async function listRanges(tableId: string): Promise<DataRange[]> {
  try {
    const ranges = await dashboard.getTableDataRange(tableId);
    return ranges.map(range => ({
      type: range.type === 'VIEW' ? 'VIEW' : 'ALL',
      viewId: 'viewId' in range ? range.viewId : undefined,
      viewName: 'viewName' in range ? range.viewName : undefined,
      filterInfo: range.filterInfo,
    }));
  } catch {
    const table = await bitable.base.getTableById(tableId);
    const views = await table.getViewMetaList();
    return [
      ALL_RANGE,
      ...views.map(view => ({ type: 'VIEW' as const, viewId: view.id, viewName: view.name })),
    ];
  }
}

/** 仪表盘配置态保存：dataConditions + customConfig 一次写回。 */
export async function saveChart(chart: ChartConfig): Promise<void> {
  await dashboard.saveConfig(toSavePayload(chart));
}

/** 展示态/配置态读取已保存的配置，读不到就是还没配过。 */
export async function loadChart(): Promise<ChartConfig | null> {
  try {
    return parseConfig(await dashboard.getConfig());
  } catch {
    return null;
  }
}

export async function markRendered(): Promise<void> {
  try {
    await dashboard.setRendered();
  } catch {
    // 独立页面打开时没有宿主，渲染状态同步失败不影响本地预览
  }
}

export interface LoadOptions {
  /** 数据范围，VIEW 时带视图 id 让宿主自己筛 */
  range?: DataRange;
  onProgress?: (loaded: number, total: number) => void;
  shouldAbort?: () => boolean;
}

/**
 * 分页读全表，在读取阶段就把单元格归一化成文本，
 * 因此下游不再出现 fieldId，也不会出现 [object Object]。
 * 钻取要的是记录本身，所以必须本地留一份，不能只信宿主算好的聚合值。
 */
export async function loadRows(tableId: string, fields: FieldMeta[], options: LoadOptions = {}): Promise<DataRow[]> {
  const { range = ALL_RANGE, onProgress, shouldAbort } = options;
  const table = await bitable.base.getTableById(tableId);
  const viewId = range.type === 'VIEW' ? range.viewId : undefined;
  const rows: DataRow[] = [];
  let sizeIndex = 0;
  let pageToken: string | undefined;

  for (;;) {
    if (shouldAbort?.()) throw new AbortError();

    let page;
    try {
      page = await table.getRecords({ pageSize: READ_SIZES[sizeIndex], pageToken, viewId });
    } catch (err) {
      // 只有单页条数被拒时才降档重试，其它错误原样抛出
      if (sizeIndex >= READ_SIZES.length - 1 || !isPageSizeError(err)) throw err;
      sizeIndex++;
      continue;
    }

    for (const record of page.records) rows.push(toRow(record.recordId, record.fields, fields));
    onProgress?.(rows.length, page.total ?? rows.length);

    if (!page.hasMore || !page.records.length) return rows;
    pageToken = page.pageToken;
  }
}

function toRow(recordId: string, raw: Record<string, unknown>, fields: FieldMeta[]): DataRow {
  const cells: Record<string, string[]> = {};
  for (const field of fields) cells[field.name] = normalizeCell(raw[field.id], field.type);
  return { recordId, cells };
}

/** 宿主原生的记录详情卡片，和飞书自带图表点击后的表现一致。 */
export async function showRecord(tableId: string, recordId: string, fieldIdList?: string[]): Promise<void> {
  await ui.showRecordDetailDialog({ tableId, recordId, fieldIdList });
}

/** 弹窗里展示某一行，表头用字段名而不是 fieldId。 */
export function rowDisplay(row: DataRow, fields: FieldMeta[]): Array<{ name: string; text: string }> {
  return fields.map(field => ({ name: field.name, text: cellDisplay(row.cells[field.name] ?? []) }));
}

function isPageSizeError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /exceed|limit|too many|上限|超出|条数|page/i.test(message);
}

export class AbortError extends Error {
  constructor() {
    super('已中止读取');
    this.name = 'AbortError';
  }
}
