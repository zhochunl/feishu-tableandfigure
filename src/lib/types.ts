/** 运行时的汇总层级配置，字段名已在配置解析阶段由 fieldId 翻译过来 */
export interface LevelConfig {
  /** 分组字段名，如 AESOC / AEPT */
  field: string;
  /** 勾选去重后的唯一计数字段名，如 SUBJECT */
  distinctBy?: string;
  /** 勾选百分比：分子为有去重时的例数、否则例次，分母是该列 total */
  percent: boolean;
}

/** 落盘到仪表盘配置的层级。用 fieldId，字段改名后配置不失效 */
export interface StoredLevel {
  fieldId: string;
  /** 是否启用去重计数，关掉时 distinctFieldId 不参与汇总 */
  dedupe?: boolean;
  distinctFieldId?: string;
  /** 是否显示百分比，没有表头配置时无分母，不生效 */
  percent?: boolean;
}

/**
 * 表头配置：另一张表（如 DM）提供列与分母。
 * 不选分组变量时整表记录数作为一个总计列，选了就每个取值一列。
 */
export interface HeaderConfig {
  tableId: string;
  fieldId?: string;
}

/** 两表共同变量，按名字连接：数据表的值去表头表找所属列 */
export interface JoinConfig {
  /** 数据表侧字段 id */
  fieldId: string;
  /** 表头表侧字段 id */
  headerFieldId: string;
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
  header?: HeaderConfig;
  join?: JoinConfig;
}

/** 数据表下拉项 */
export interface TableEntry {
  id: string;
  name: string;
}

/** 字段元信息，顺序按数据表列顺序 */
export interface FieldMeta {
  id: string;
  name: string;
  /** FieldType 枚举值 */
  type: number;
}

/**
 * 一行记录，单元格在读取阶段就归一化成文本。
 * 单选/文本是 1 个元素，多选是多个，空数组代表缺失。
 */
export interface DataRow {
  recordId: string;
  /** 字段名 -> 归一化值 */
  cells: Record<string, string[]>;
}

/** 三线表的一列：key 为 ''（没有表头配置）或表头分组取值 */
export interface TableValue {
  key: string;
  label: string;
  /** 该列的分母，来自表头表；没有表头配置时为 0，百分比不显示 */
  total: number;
}

/** 一个分组在某列上的数据块：例次、可选例数、可选百分比 */
export interface GroupCell {
  count: number;
  distinct?: number;
  percent?: number;
  /** 该组该列的原始记录，例次级别，不做去重 */
  recordIds: string[];
}

/** 三线表的一个分组节点 */
export interface GroupRow {
  /** 产生该分组的字段名 */
  field: string;
  /** 组名，缺失值统一显示 MISSING_LABEL */
  value: string;
  /** 与列顺序一一对应 */
  cells: GroupCell[];
  children: GroupRow[];
}

export const MISSING_LABEL = '缺失';
