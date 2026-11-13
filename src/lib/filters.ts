import { FieldType } from '@lark-base-open/js-sdk';
import type { DataRow, FieldMeta, FilterCondition, FilterOperator } from './types';

export interface OperatorSpec {
  value: FilterOperator;
  label: string;
  /** 值输入框的提示文案 */
  hint?: string;
}

/** 比较、相等、集合三类，八个操作符都要右值 */
export const FILTER_OPERATORS: OperatorSpec[] = [
  { value: 'gt', label: '大于' },
  { value: 'eq', label: '等于' },
  { value: 'lt', label: '小于' },
  { value: 'gte', label: '大于等于' },
  { value: 'ne', label: '不等于' },
  { value: 'lte', label: '小于等于' },
  { value: 'in', label: '属于', hint: '多个值用逗号分隔' },
  { value: 'notIn', label: '不属于', hint: '多个值用逗号分隔' },
];

/** 大小比较只对数值列和日期列开放，其它列配了也一条都不会命中，索性不给选 */
const COMPARISON = new Set<FilterOperator>(['gt', 'lt', 'gte', 'lte']);
const NUMBER_TYPES = new Set<number>([FieldType.Number, FieldType.Progress, FieldType.Currency, FieldType.Rating]);
const DATE_TYPES = new Set<number>([FieldType.DateTime, FieldType.CreatedTime, FieldType.ModifiedTime]);

export function isComparable(field: FieldMeta | undefined): boolean {
  return !!field && (NUMBER_TYPES.has(field.type) || DATE_TYPES.has(field.type));
}

export function operatorsFor(field: FieldMeta | undefined): OperatorSpec[] {
  return FILTER_OPERATORS.filter(spec => !COMPARISON.has(spec.value) || isComparable(field));
}

function specOf(operator: FilterOperator): OperatorSpec | undefined {
  return FILTER_OPERATORS.find(spec => spec.value === operator);
}

/** 解析后的条件：fieldId 翻成字段名，字段被删、类型不支持比较、没填值都整条作废 */
export interface ResolvedFilter {
  field: string;
  operator: FilterOperator;
  value: string;
}

export function resolveFilters(conditions: FilterCondition[], fields: FieldMeta[]): ResolvedFilter[] {
  const out: ResolvedFilter[] = [];
  for (const condition of conditions) {
    const meta = condition.fieldId ? fields.find(field => field.id === condition.fieldId) : undefined;
    const spec = specOf(condition.operator);
    if (!meta || !spec) continue;
    if (COMPARISON.has(spec.value) && !isComparable(meta)) continue;
    const value = (condition.value ?? '').trim();
    if (!value) continue;
    out.push({ field: meta.name, operator: spec.value, value });
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function sameText(cell: string, want: string): boolean {
  return cell.trim().toLowerCase() === want.trim().toLowerCase();
}

/** 属于/不属于的多个值，中英文逗号、顿号都算分隔符 */
export function splitList(value: string): string[] {
  return value
    .split(/[,，、]/)
    .map(item => item.trim())
    .filter(Boolean);
}

/** 数值优先，其次按补零日期文本比较；比不了返回 undefined */
function compare(a: string, b: string): number | undefined {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (DATE_RE.test(a) && DATE_RE.test(b)) return a < b ? -1 : a > b ? 1 : 0;
  return undefined;
}

function matches(values: string[], filter: ResolvedFilter): boolean {
  switch (filter.operator) {
    case 'eq':
      return values.some(v => sameText(v, filter.value));
    case 'ne':
      return !values.some(v => sameText(v, filter.value));
    case 'in': {
      const list = splitList(filter.value);
      return values.some(v => list.some(item => sameText(v, item)));
    }
    case 'notIn': {
      const list = splitList(filter.value);
      return !values.some(v => list.some(item => sameText(v, item)));
    }
    case 'gt':
      return values.some(v => (compare(v, filter.value) ?? Number.NEGATIVE_INFINITY) > 0);
    case 'gte':
      return values.some(v => (compare(v, filter.value) ?? Number.NEGATIVE_INFINITY) >= 0);
    case 'lt':
      return values.some(v => (compare(v, filter.value) ?? Number.POSITIVE_INFINITY) < 0);
    case 'lte':
      return values.some(v => (compare(v, filter.value) ?? Number.POSITIVE_INFINITY) <= 0);
  }
}

/** 多条条件之间取「且」；没有可用条件时原样返回，不做多余拷贝 */
export function applyFilters(rows: DataRow[], conditions: FilterCondition[], fields: FieldMeta[]): DataRow[] {
  const filters = resolveFilters(conditions, fields);
  if (!filters.length) return rows;
  return rows.filter(row => filters.every(filter => matches(row.cells[filter.field] ?? [], filter)));
}

/** 下拉里的候选值：取未筛选记录里的不同取值，避免配了一条后选项消失 */
export function candidateValues(rows: DataRow[], fields: FieldMeta[], limit = 200): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const field of fields) {
    const seen = new Set<string>();
    for (const row of rows) {
      for (const value of row.cells[field.name] ?? []) {
        if (!seen.has(value)) seen.add(value);
        if (seen.size >= limit) break;
      }
      if (seen.size >= limit) break;
    }
    out[field.id] = [...seen];
  }
  return out;
}
