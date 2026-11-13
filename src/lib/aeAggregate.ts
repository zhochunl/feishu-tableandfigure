import { cellDisplay } from './cellText';
import { MISSING_LABEL, type DataRow, type GroupRow, type LevelConfig } from './types';

/**
 * 按层级依次分组。
 * - 分组字段是多选时，一条记录同时计入它的每个取值，所以各组之和可以大于总数，这是 AE 汇总的常规口径。
 * - 配置了 distinctBy 时，该层唯一数直接对自己桶内的记录算，不拿子层结果往上加，
 *   否则同一个受试者出现在多个子组会被重复计数。
 * - 排序按例次降序、组名升序，缺失组固定沉底。
 */
export function aggregate(rows: DataRow[], levels: LevelConfig[]): GroupRow[] {
  if (!levels.length) return [];
  return buildLevel(rows, levels, 0);
}

function buildLevel(rows: DataRow[], levels: LevelConfig[], depth: number): GroupRow[] {
  const level = levels[depth];
  const buckets = new Map<string, Map<string, DataRow>>();

  for (const row of rows) {
    const values = row.cells[level.field] ?? [];
    const keys = values.length ? values : [MISSING_LABEL];
    for (const key of keys) {
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = new Map()));
      bucket.set(row.recordId, row);
    }
  }

  const groups: GroupRow[] = [];
  for (const [value, bucket] of buckets) {
    const items = [...bucket.values()];
    groups.push({
      field: level.field,
      value,
      count: items.length,
      distinct: level.distinctBy ? distinctCount(items, level.distinctBy) : undefined,
      recordIds: items.map(item => item.recordId),
      children: depth + 1 < levels.length ? buildLevel(items, levels, depth + 1) : [],
    });
  }

  groups.sort((a, b) => {
    if (a.value === MISSING_LABEL) return b.value === MISSING_LABEL ? 0 : 1;
    if (b.value === MISSING_LABEL) return -1;
    return b.count - a.count || a.value.localeCompare(b.value);
  });
  return groups;
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
