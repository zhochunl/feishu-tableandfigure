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

/**
 * 去重键用的字段类型分组，只影响「例数」的判断，不影响展示文本。
 * - 文本类：一个单元格里的多个片段只是同一段文字的格式切分（加粗、换行、@人），
 *   拼回整段才算同一个值，否则同一内容会被拆成几个不同的人；
 * - 集合类：单元格天然是多值集合，顺序不同不该算成两个对象，排序后再连接。
 * 公式、查找引用可能出文本也可能出多值，形态不确定，一律按普通多值处理。
 */
const TEXT_LIKE_TYPES = new Set<number>([FieldType.Text, FieldType.Phone, FieldType.Url, FieldType.Email]);
const SET_LIKE_TYPES = new Set<number>([
  FieldType.MultiSelect,
  FieldType.User,
  FieldType.GroupChat,
  FieldType.Attachment,
  FieldType.SingleLink,
  FieldType.DuplexLink,
]);

/** 去重键里分隔多个值的控制字符，选一个单元格文本里不会出现的 */
const KEY_SEP = '\u0001';
/** 零宽字符：从网页或其它表格粘贴进来的值常带这些，肉眼看不见却会让键对不上 */
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/g;

function normalizeForKey(value: string): string {
  return value.replace(ZERO_WIDTH, '').trim();
}

/**
 * 唯一计数用的键，和展示用的 cellDisplay 分开：
 * 空白只去首尾、不折叠中间，避免把「S 001」和「S001」当成同一个人；
 * 文本类按片段顺次拼回整段，集合类排序后连接，其余按单值连接。
 * 空单元格返回空串，调用方据此把该条记录排除在例数之外。
 */
export function dedupeKey(values: string[], type?: number): string {
  const parts = values.map(normalizeForKey).filter(Boolean);
  if (!parts.length) return '';
  if (type !== undefined && TEXT_LIKE_TYPES.has(type)) return parts.join('');
  if (type !== undefined && SET_LIKE_TYPES.has(type)) return [...parts].sort().join(KEY_SEP);
  return parts.join(KEY_SEP);
}
