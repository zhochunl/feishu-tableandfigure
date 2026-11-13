import {
  DATA_SOURCE_SORT_TYPE,
  GroupMode,
  ORDER,
  SourceType,
  type IConfig,
  type IDataRange,
} from '@lark-base-open/js-sdk';
import type { ChartConfig, DataRange, FieldMeta, HeaderConfig, JoinConfig, LevelConfig, StoredLevel } from './types';

/** customConfig 里插件配置的存放键与版本，字段结构变了就加版本号，旧配置按 dataConditions 兜底 */
const CONFIG_KEY = 'aeThreeLine';
const CONFIG_VERSION = 2;

export const ALL_RANGE: DataRange = { type: 'ALL' };

export function defaultChart(tableId: string): ChartConfig {
  return { tableId, dataRange: ALL_RANGE, levels: [{ fieldId: '' }] };
}

/**
 * 写回宿主。dataConditions 让仪表盘知道数据源和分组字段，
 * 去重、表头分列与百分比宿主都算不了（Rollup 没有 COUNT_DISTINCT，条件也只支持单表），
 * 放在 customConfig 里由插件自己算。
 */
export function toSavePayload(chart: ChartConfig): IConfig {
  return {
    dataConditions: [
      {
        tableId: chart.tableId,
        dataRange: toHostRange(chart.dataRange),
        groups: chart.levels
          .filter(level => level.fieldId)
          .map(level => ({
            fieldId: level.fieldId,
            // 多选/人员按值拆开统计，和插件里的展开口径一致
            mode: GroupMode.ENUMERATED,
            sort: { order: ORDER.ASCENDING, sortType: DATA_SOURCE_SORT_TYPE.VIEW },
          })),
        series: 'COUNTA',
      },
    ],
    customConfig: { [CONFIG_KEY]: { version: CONFIG_VERSION, ...chart } },
  };
}

/** 宿主配置 -> 插件配置；优先 customConfig，缺失时从 dataConditions 还原（只是丢失去重与分列口径） */
export function parseConfig(config: IConfig | null | undefined): ChartConfig | null {
  const custom = config?.customConfig?.[CONFIG_KEY] as
    | {
        version?: number;
        tableId?: string;
        dataRange?: IDataRange;
        levels?: StoredLevel[];
        header?: HeaderConfig;
        join?: JoinConfig;
      }
    | undefined;

  if (custom?.tableId && Array.isArray(custom.levels) && (custom.version === CONFIG_VERSION || custom.version === 1)) {
    const chart: ChartConfig = {
      tableId: custom.tableId,
      dataRange: fromHostRange(custom.dataRange),
      levels: normalizeLevels(custom.levels, custom.version),
    };
    const header = normalizeHeader(custom.header);
    const join = normalizeJoin(custom.join);
    if (header) chart.header = header;
    if (join) chart.join = join;
    return chart;
  }

  const condition = config?.dataConditions?.[0];
  if (!condition?.tableId) return null;
  return {
    tableId: condition.tableId,
    dataRange: fromHostRange(condition.dataRange),
    levels: normalizeLevels((condition.groups ?? []).map(group => ({ fieldId: group.fieldId })), CONFIG_VERSION),
  };
}

/**
 * fieldId -> 字段名。字段被删掉就不再参与汇总，宁缺勿错。
 * 返回的层级和有效配置一一对应，三线表的缩进层级以此为准。
 */
export function resolveLevels(chart: ChartConfig, fields: FieldMeta[]): LevelConfig[] {
  const nameOf = new Map(fields.map(field => [field.id, field.name]));
  const levels: LevelConfig[] = [];

  for (const level of chart.levels) {
    const field = level.fieldId ? nameOf.get(level.fieldId) : undefined;
    if (!field) continue;
    // 取消勾选去重时保留 distinctFieldId，只是不再算例数
    const distinctBy = level.dedupe && level.distinctFieldId ? nameOf.get(level.distinctFieldId) : undefined;
    levels.push({ field, distinctBy, percent: !!level.percent });
  }
  return levels;
}

/** 表头配置解析：没配表头表返回 undefined；分组字段被删则退回只出总计列 */
export function resolveHeader(
  chart: ChartConfig,
  headerFields: FieldMeta[],
): { tableId: string; field?: string } | undefined {
  const tableId = chart.header?.tableId;
  if (!tableId) return undefined;
  const field = chart.header?.fieldId ? headerFields.find(item => item.id === chart.header?.fieldId)?.name : undefined;
  return field ? { tableId, field } : { tableId };
}

/** 连接变量的两侧字段名，任一侧被删掉就连不上，返回 undefined 表示无法分列 */
export function resolveJoin(
  chart: ChartConfig,
  fields: FieldMeta[],
  headerFields: FieldMeta[],
): { dataField: string; headerField: string } | undefined {
  if (!chart.join || !chart.header?.tableId) return undefined;
  const dataField = fields.find(field => field.id === chart.join?.fieldId)?.name;
  const headerField = headerFields.find(field => field.id === chart.join?.headerFieldId)?.name;
  return dataField && headerField ? { dataField, headerField } : undefined;
}

/** 这份配置用到的数据表字段，按首次出现顺序去重：分组、勾选的去重、连接变量，钻取列表直接用 */
export function levelIds(chart: ChartConfig): string[] {
  return [
    ...new Set(
      [
        ...chart.levels.flatMap(level => [level.fieldId, level.dedupe ? level.distinctFieldId ?? '' : '']),
        chart.join?.fieldId ?? '',
      ].filter(Boolean),
    ),
  ];
}

/** 数据范围的下拉标识：同一视图带不同筛选条件也算不同范围，用序列化结果区分 */
export function rangeKey(range: DataRange): string {
  return JSON.stringify(range);
}

export function rangeLabel(range: DataRange): string {
  if (range.type === 'ALL') return '全部数据';
  const name = range.viewName ?? range.viewId ?? '视图';
  return range.filterInfo ? `${name}（视图筛选）` : name;
}

function normalizeLevels(levels: StoredLevel[], version: number | undefined): StoredLevel[] {
  return levels
    .filter((level): level is StoredLevel => !!level && typeof level.fieldId === 'string' && !!level.fieldId)
    .map(level => ({
      fieldId: level.fieldId,
      // v1 没有去重开关，配了去重字段就等于勾选了去重
      dedupe: version === 1 ? !!level.distinctFieldId : !!level.dedupe,
      distinctFieldId: level.distinctFieldId || undefined,
      percent: !!level.percent,
    }));
}

function normalizeHeader(header: HeaderConfig | undefined): HeaderConfig | undefined {
  if (!header || typeof header.tableId !== 'string' || !header.tableId) return undefined;
  return header.fieldId ? { tableId: header.tableId, fieldId: header.fieldId } : { tableId: header.tableId };
}

function normalizeJoin(join: JoinConfig | undefined): JoinConfig | undefined {
  if (!join || typeof join.fieldId !== 'string' || typeof join.headerFieldId !== 'string') return undefined;
  return join.fieldId && join.headerFieldId ? join : undefined;
}

function toHostRange(range: DataRange): IDataRange {
  if (range.type === 'VIEW' && range.viewId) {
    return {
      type: SourceType.VIEW,
      viewId: range.viewId,
      viewName: range.viewName ?? '',
      filterInfo: range.filterInfo as IDataRange['filterInfo'],
    };
  }
  return { type: SourceType.ALL };
}

function fromHostRange(range: IDataRange | undefined): DataRange {
  if (range?.type === SourceType.VIEW && 'viewId' in range && range.viewId) {
    return { type: 'VIEW', viewId: range.viewId, viewName: range.viewName, filterInfo: range.filterInfo };
  }
  return ALL_RANGE;
}
