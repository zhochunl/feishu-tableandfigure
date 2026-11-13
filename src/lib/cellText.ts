import { FieldType } from '@lark-base-open/js-sdk';

const DATE_TYPES = new Set<number>([FieldType.DateTime, FieldType.CreatedTime, FieldType.ModifiedTime]);

/** 单元格里出现的对象形态：单选/多选/人员/链接/附件/群/地址/自动编号/文本片段 */
interface CellObject {
  text?: string;
  name?: string;
  enName?: string;
  link?: string;
  address?: string;
  fullAddress?: string;
  value?: unknown;
  id?: string;
  type?: string;
}

/** 取一个单元格对象的可读文本，取不到返回空串，绝不落到 [object Object]。 */
function objectText(item: CellObject): string {
  if (typeof item.text === 'string') return item.text;
  if (typeof item.name === 'string') return item.name;
  if (typeof item.address === 'string') return item.address || item.fullAddress || '';
  // 自动编号这类自算字段包在 { value, status } 里
  if ('value' in item && (typeof item.value === 'string' || typeof item.value === 'number')) {
    return String(item.value);
  }
  return '';
}

function formatDate(stamp: number): string {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hasTime = date.getHours() || date.getMinutes() || date.getSeconds();
  return hasTime ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

/**
 * 把 IOpenCellValue 归一化成文本数组。
 * 多选、人员、公式数组结果会展开成多个值，供分组逐个归属。
 */
export function normalizeCell(value: unknown, type: number): string[] {
  if (value === null || value === undefined) return [];

  if (DATE_TYPES.has(type) && typeof value === 'number') {
    const text = formatDate(value);
    return text ? [text] : [];
  }

  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) out.push(...normalizeCell(item, type));
    return out;
  }

  if (typeof value === 'boolean') return [value ? '是' : '否'];
  if (typeof value === 'number') return [String(value)];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];

  if (typeof value === 'object') {
    const text = objectText(value as CellObject);
    return text ? [text] : [];
  }

  return [];
}

/** 单元格展示文本 */
export function cellDisplay(values: string[]): string {
  return values.join('、');
}
