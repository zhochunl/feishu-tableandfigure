/** 运行时的汇总层级配置，字段名已在配置解析阶段由 fieldId 翻译过来 */
export interface LevelConfig {
  /** 分组字段名，如 AESOC / AEPT */
  field: string;
  /** 去重字段名，如 SUBJECT；不配置则只计例次 */
  distinctBy?: string;
}

/** 落盘到仪表盘配置的层级。用 fieldId，字段改名后配置不失效 */
export interface StoredLevel {
  fieldId: string;
  distinctFieldId?: string;
}

/** 数据范围：整表或某个视图，与宿主 IDataRange 同构 */
export interface DataRange {
  type: 'ALL' | 'VIEW';
  viewId?: string;
  viewName?: string;
  /** 视图自带的筛选条件，原样透传给宿主 */
  filterInfo?: unknown;
}

/** 三线表插件自己的完整配置 */
export interface ChartConfig {
  tableId: string;
  dataRange: DataRange;
  levels: StoredLevel[];
}

/** 数据表下拉项 */
export interface TableEntry {
  id: string;
  name: string;
}

/** 字段元信息，一次 getFieldMetaList 拿全 */export interface FieldMeta {
  id: string;
  name: string;
  /** FieldType 枚举值 */
  type: number;
}

/**
 * 一行记录，单元格在读取阶段就归一化成文本数组。
 * 单选/文本是 1 个元素，多选是多个，空数组代表缺失。
 */
export interface DataRow {
  recordId: string;
  /** 字段名 -> 归一化值 */
  cells: Record<string, string[]>;
}

/** 三线表的一个分组节点 */
export interface GroupRow {
  /** 产生该分组的字段名 */
  field: string;
  /** 组名，缺失值统一显示 MISSING_LABEL */
  value: string;
  /** 发生例次 */
  count: number;
  /** 配置了 distinctBy 时的唯一计数 */
  distinct?: number;
  /** 组内记录，钻取用 */
  recordIds: string[];
  children: GroupRow[];
}

export const MISSING_LABEL = '缺失';
