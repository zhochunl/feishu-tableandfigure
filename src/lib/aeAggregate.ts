import { cellDisplay } from './cellText';
import { MISSING_LABEL, type DataRow, type GroupCell, type GroupRow, type LevelConfig, type TableValue } from './types';

/** 没有分列时唯一列的 key */
const SINGLE_KEY = '';
/** 最右边固定那一列总计的 key，不会和表头取值撞上 */
const TOTAL_KEY = '__total__';

/** 表头表算出来的列、每列分母，以及数据表记录落在哪些列 */
export interface ColumnPlan {
  columns: TableValue[];
  /** recordId -> 列 key 列表；连不到表头表的记录不在任何列里 */
  keysByRecord: Map<string, string[]>;
  /** 连不到表头列的记录数，界面不再提示，只留给回归断言核对 */
  unmatched: number;
}

export interface HeaderSource {
  rows: DataRow[];
  /** 表头分组变量，不选就整表记录数作一个总计列 */
  field?: string;
  /** 两表共同变量，分列时必须有 */
  join?: { dataField: string; headerField: string };
}

/**
 * 表头表 -> 列与分母。
 * 不配表头时只出一列且没有分母（total 为 0，百分比不显示）；
 * 配了分组变量但没配连接变量时无法把记录分到列上，退回一个总计列。
 */
export function planColumns(rows: DataRow[], header?: HeaderSource): ColumnPlan {
  const single = (label: string, total: number): ColumnPlan => ({
    columns: [{ key: SINGLE_KEY, label, total }],
    keysByRecord: new Map(rows.map(row => [row.recordId, [SINGLE_KEY]])),
    unmatched: 0,
  });

  if (!header) return single('总计', 0);
  const { rows: headerRows, field, join } = header;
  if (!field || !join) return single('总计', headerRows.length);

  const totals = new Map<string, number>();
  const columnOf = new Map<string, Set<string>>();

  for (const row of headerRows) {
    const values = row.cells[field] ?? [];
    const keys = values.length ? values : [MISSING_LABEL];
    for (const key of keys) totals.set(key, (totals.get(key) ?? 0) + 1);
    for (const value of row.cells[join.headerField] ?? []) {
      let set = columnOf.get(value);
      if (!set) columnOf.set(value, (set = new Set()));
      for (const key of keys) set.add(key);
    }
  }

  // 最右边固定一列总计：筛选后的明细全算进去，分母是表头表的全部记录
  const keysByRecord = new Map<string, string[]>();
  let unmatched = 0;
  for (const row of rows) {
    const found = new Set<string>();
    for (const value of row.cells[join.dataField] ?? []) columnOf.get(value)?.forEach(key => found.add(key));
    if (!found.size) unmatched++;
    found.add(TOTAL_KEY);
    keysByRecord.set(row.recordId, [...found]);
  }

  return {
    // 列顺序跟表头表里变量出现的顺序，不按人数排序，和表内顺序保持一致的直觉
    columns: [...[...totals].map(([label, total]) => ({ key: label, label, total })), {
      key: TOTAL_KEY,
      label: '总计',
      total: headerRows.length,
    }],
    keysByRecord,
    unmatched,
  };
}

/**
 * 按层级依次分组，每层每列各算一个数据块。
 * - 分组字段是多选时，一条记录同时计入它的每个取值，所以各组之和可以大于总数，这是 AE 汇总的常规口径。
 * - 例数直接在自己桶内的记录上算唯一值，不拿子层结果往上加，否则同一个受试者出现在多个子组会被重复计数。
 * - 百分比分子是例数（该层勾了去重）否则例次，分母是该列 total；total 为 0 时不出百分比。
 * - 排序按各列例次之和降序、组名升序，缺失组固定沉底。
 */
export function aggregate(rows: DataRow[], levels: LevelConfig[], plan: ColumnPlan): GroupRow[] {
  if (!levels.length) return [];
  const columns = plan.columns.map(column => column.key);
  const buckets = columns.map(() => new Map<string, DataRow>());

  for (const row of rows) {
    for (const key of plan.keysByRecord.get(row.recordId) ?? []) {
      const index = columns.indexOf(key);
      if (index >= 0) buckets[index].set(row.recordId, row);
    }
  }

  return buildLevel(
    buckets.map(bucket => [...bucket.values()]),
    levels,
    0,
    plan.columns,
  );
}

/** perColumn 与 plan.columns 一一对应的记录集合 */
function buildLevel(perColumn: DataRow[][], levels: LevelConfig[], depth: number, columns: TableValue[]): GroupRow[] {
  const level = levels[depth];
  const buckets = columns.map(() => new Map<string, Map<string, DataRow>>());
  const seen = new Set<string>();

  perColumn.forEach((rowsOfColumn, columnIndex) => {
    for (const row of rowsOfColumn) {
      const values = row.cells[level.field] ?? [];
      for (const key of values.length ? values : [MISSING_LABEL]) {
        let bucket = buckets[columnIndex].get(key);
        if (!bucket) {
          buckets[columnIndex].set(key, (bucket = new Map()));
          seen.add(key);
        }
        bucket.set(row.recordId, row);
      }
    }
  });

  const groups: GroupRow[] = [...seen].map(value => {
    const columnRows = buckets.map(bucket => [...(bucket.get(value)?.values() ?? [])]);
    const cells = columnRows.map((items, index) => toCell(items, level, columns[index]));
    return {
      field: level.field,
      value,
      cells,
      children: depth + 1 < levels.length ? buildLevel(columnRows, levels, depth + 1, columns) : [],
    };
  });

  groups.sort((a, b) => {
    if (a.value === MISSING_LABEL) return b.value === MISSING_LABEL ? 0 : 1;
    if (b.value === MISSING_LABEL) return -1;
    return sumCount(b) - sumCount(a) || a.value.localeCompare(b.value);
  });
  return groups;
}

function toCell(items: DataRow[], level: LevelConfig, column: TableValue): GroupCell {
  const distinct = level.distinctBy ? distinctCount(items, level.distinctBy) : undefined;
  const numerator = distinct ?? items.length;
  return {
    count: items.length,
    distinct,
    percent: level.percent && column.total > 0 ? (numerator / column.total) * 100 : undefined,
    recordIds: items.map(item => item.recordId),
  };
}

function sumCount(group: GroupRow): number {
  return group.cells.reduce((total, cell) => total + cell.count, 0);
}

/** 唯一计数：去重字段为空的记录不计入，因为无法归属到具体对象。 */
function distinctCount(items: DataRow[], by: string): number {
  const keys = new Set<string>();
  for (const item of items) {
    const key = cellDisplay(item.cells[by] ?? []);
    if (key) keys.add(key);
  }
  return keys.size;
}
