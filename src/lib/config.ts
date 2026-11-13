import {
  DATA_SOURCE_SORT_TYPE,
  GroupMode,
  ORDER,
  SourceType,
  type IConfig,
  type IDataRange,
} from '@lark-base-open/js-sdk';
import type { ChartConfig, DataRange, FieldMeta, LevelConfig, StoredLevel } from './types';

/** customConfig 里 our 配置的存放键与版本，字段结构变了就加版本号，旧配置按 dataConditions 兜底 */
const CONFIG_KEY = 'aeThreeLine';
const CONFIG_VERSION = 1;

export const ALL_RANGE: DataRange = { type: 'ALL' };

export function defaultChart(tableId: string): ChartConfig {
  return { tableId, dataRange: ALL_RANGE, levels: [{ fieldId: '' }] };
}

/**
 * 写回宿主。dataConditions 让仪表盘知道数据源和分组字段，
 * 去重口径宿主算不了（Rollup 没有 COUNT_DISTINCT），放在 customConfig 里由插件自己算。
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

/** 宿主配置 -> 插件配置；优先 customConfig，缺失时从 dataConditions 还原（只是丢失去重口径） */
export function parseConfig(config: IConfig | null | undefined): ChartConfig | null {
  const custom = config?.customConfig?.[CONFIG_KEY] as
    | { version?: number; tableId?: string; dataRange?: IDataRange; levels?: StoredLevel[] }
    | undefined;

  if (custom?.version === CONFIG_VERSION && custom.tableId && Array.isArray(custom.levels)) {
    return {
      tableId: custom.tableId,
      dataRange: fromHostRange(custom.dataRange),
      levels: normalizeLevels(custom.levels),
    };
  }

  const condition = config?.dataConditions?.[0];
  if (!condition?.tableId) return null;
  return {
    tableId: condition.tableId,
    dataRange: fromHostRange(condition.dataRange),
    levels: normalizeLevels((condition.groups ?? []).map(group => ({ fieldId: group.fieldId }))),
  };
}

/**
 * fieldId -> 字段名。字段被删掉就不再参与汇总，宁缺勿错。
 * 返回的层级和入参一一对应，三线表的缩进层级以此为准。
 */
export function resolveLevels(chart: ChartConfig, fields: FieldMeta[]): LevelConfig[] {
  const nameOf = new Map(fields.map(field => [field.id, field.name]));
  const levels: LevelConfig[] = [];

  for (const level of chart.levels) {
    const field = level.fieldId ? nameOf.get(level.fieldId) : undefined;
    if (!field) continue;
    const distinctBy = level.distinctFieldId ? nameOf.get(level.distinctFieldId) : undefined;
    levels.push(distinctBy ? { field, distinctBy } : { field });
  }
  return levels;
}

/** 这份配置用到的字段（分组 + 去重），去重后按首次出现顺序，钻取列表直接用 */
export function levelIds(chart: ChartConfig): string[] {
  return [...new Set(chart.levels.flatMap(level => [level.fieldId, level.distinctFieldId ?? '']).filter(Boolean))];
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

function normalizeLevels(levels: StoredLevel[]): StoredLevel[] {
  return levels
    .filter((level): level is StoredLevel => !!level && typeof level.fieldId === 'string' && !!level.fieldId)
    .map(level => ({
      fieldId: level.fieldId,
      distinctFieldId: level.distinctFieldId || undefined,
    }));
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
