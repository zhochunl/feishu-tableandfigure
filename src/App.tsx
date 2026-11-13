import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardState, dashboard } from '@lark-base-open/js-sdk';
import { ConfigPanel } from './components/ConfigPanel';
import { DrillDownModal } from './components/DrillDownModal';
import { ThreeLineTable } from './components/ThreeLineTable';
import { aggregate, attachHeaderFields, planColumns } from './lib/aeAggregate';
import { applyFilters, candidateValues } from './lib/filters';
import { listRanges, listTables, loadChart, loadFields, loadRows, markRendered, saveChart } from './lib/bitable';
import {
  defaultChart,
  levelIds,
  parseConfig,
  rangeKey,
  resolveHeader,
  resolveJoin,
  resolveLevels,
} from './lib/config';
import type {
  ChartConfig,
  DataRange,
  DataRow,
  FieldMeta,
  GroupCell,
  LevelConfig,
  TableEntry,
  TableValue,
} from './lib/types';

type Phase = 'loading' | 'ready' | 'unconfigured' | 'error';

interface Drill {
  cell: GroupCell;
  path: string;
  column: TableValue;
  level: LevelConfig;
}

export default function App() {
  const state = dashboard.state;
  const isConfig = state === DashboardState.Create || state === DashboardState.Config;

  const [chart, setChart] = useState<ChartConfig | null>(null);
  const [tables, setTables] = useState<TableEntry[]>([]);
  const [ranges, setRanges] = useState<DataRange[]>([]);
  const [fields, setFields] = useState<FieldMeta[]>([]);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [headerFields, setHeaderFields] = useState<FieldMeta[]>([]);
  const [headerRows, setHeaderRows] = useState<DataRow[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [drill, setDrill] = useState<Drill | null>(null);

  // 启动：先取已保存的配置；配置态还要拿到表列表，展示态没配置就是真没配置
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [stored, list] = await Promise.all([loadChart(), listTables()]);
        if (cancelled) return;
        setTables(list);
        if (isConfig) {
          setChart(stored ?? defaultChart(list[0]?.id ?? ''));
          setPhase('ready');
        } else if (stored) {
          setChart(stored);
        } else {
          setPhase('unconfigured');
          await markRendered();
        }
      } catch (reason) {
        if (cancelled) return;
        setError(`读取配置失败：${message(reason)}`);
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isConfig]);

  // 数据源变化才重新拉字段和记录；只改层级配置时用内存里的行即时汇总，不再回宿主
  const sourceKey = chart ? `${chart.tableId}|${rangeKey(chart.dataRange)}` : '';
  useEffect(() => {
    if (!chart || !chart.tableId) return;
    let cancelled = false;
    const { tableId, dataRange } = chart;
    setRows([]);
    setFields([]);
    setError('');
    setPhase('loading');
    // 换数据源时钻取弹窗里的记录已经不属于这批数据，直接关掉
    setDrill(null);
    (async () => {
      try {
        const viewId = dataRange.type === 'VIEW' ? dataRange.viewId : undefined;
        // 字段按表内列顺序返回，配置下拉才不会乱序
        const [nextFields, nextRanges] = await Promise.all([loadFields(tableId, viewId), listRanges(tableId)]);
        if (cancelled) return;
        setFields(nextFields);
        setRanges(nextRanges);
        const loaded = await loadRows(tableId, nextFields, { range: dataRange });
        if (cancelled) return;
        setRows(loaded);
        setPhase('ready');
      } catch (reason) {
        if (cancelled) return;
        setError(`读取数据失败：${message(reason)}`);
        setPhase('error');
      } finally {
        await markRendered();
      }
    })();
    return () => {
      cancelled = true;
    };
    // sourceKey 已唯一确定 tableId + dataRange，这里不能再依赖 chart 对象引用
  }, [sourceKey]);

  // 表头表只提供列和分母，换它不必重读明细数据
  const headerKey = chart?.header?.tableId ?? '';
  useEffect(() => {
    if (!headerKey) {
      setHeaderFields([]);
      setHeaderRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const nextFields = await loadFields(headerKey);
        if (cancelled) return;
        setHeaderFields(nextFields);
        const loaded = await loadRows(headerKey, nextFields);
        if (cancelled) return;
        setHeaderRows(loaded);
      } catch (reason) {
        if (cancelled) return;
        setError(`读取表头表失败：${message(reason)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [headerKey]);

  // 展示态：仪表盘里改了配置要立刻跟着变
  useEffect(() => {
    if (isConfig) return;
    return dashboard.onConfigChange(({ data }) => {
      const next = parseConfig(data);
      if (!next) return;
      setPhase('loading');
      setChart(next);
    });
  }, [isConfig]);

  const levels = useMemo(() => (chart ? resolveLevels(chart, fields) : []), [chart, fields]);

  // 表头专有变量先按连接变量补到明细行上，之后两张表的筛选条件都在这批补过的记录上算
  const joinPair = useMemo(
    () => (chart ? resolveJoin(chart, fields, headerFields) : undefined),
    [chart, fields, headerFields],
  );
  const joinedRows = useMemo(
    () => (joinPair ? attachHeaderFields(rows, headerRows, joinPair, fields) : rows),
    [joinPair, rows, headerRows, fields],
  );

  // 数据段筛选条件的可选变量：明细表自己的 + 按连接变量补进来的表头专有变量
  const filterFields = useMemo(() => {
    if (!joinPair) return fields;
    return [...fields, ...headerFields.filter(header => !fields.some(field => field.name === header.name))];
  }, [joinPair, fields, headerFields]);

  // 筛选条件只在这批记录上取子集，不回宿主重读
  const dataRows = useMemo(() => {
    const picked = applyFilters(joinedRows, chart?.filters ?? [], filterFields);
    // 没连上表头表时明细上没有那些变量，硬套会把记录全筛没
    return joinPair ? applyFilters(picked, chart?.header?.filters ?? [], headerFields) : picked;
  }, [joinedRows, chart, filterFields, headerFields, joinPair]);
  const sourceRows = useMemo(
    () => (chart?.header ? applyFilters(headerRows, chart.header.filters ?? [], headerFields) : headerRows),
    [headerRows, chart, headerFields],
  );

  const plan = useMemo(() => {
    if (!chart) return planColumns([]);
    const header = resolveHeader(chart, headerFields);
    if (!header) return planColumns(dataRows);
    return planColumns(dataRows, { rows: sourceRows, field: header.field, join: joinPair });
  }, [chart, dataRows, sourceRows, headerFields, joinPair]);

  const groups = useMemo(() => aggregate(dataRows, levels, plan), [dataRows, levels, plan]);
  const rowsById = useMemo(() => new Map(dataRows.map(row => [row.recordId, row])), [dataRows]);

  const drillColumns = useMemo(() => {
    const ids = chart ? levelIds(chart) : [];
    const picked = ids.map(id => fields.find(field => field.id === id)).filter((field): field is FieldMeta => !!field);
    return picked.length ? picked : fields.slice(0, 6);
  }, [chart, fields]);

  // 候选取值取未筛选的记录，否则配上一条后剩下的选项就消失了
  const candidates = useMemo(() => candidateValues(joinedRows, filterFields), [joinedRows, filterFields]);
  const headerCandidates = useMemo(() => candidateValues(headerRows, headerFields), [headerRows, headerFields]);

  const save = useCallback(async () => {
    if (!chart) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveChart(chart);
    } catch (reason) {
      setSaveError(`保存失败：${message(reason)}`);
    } finally {
      setSaving(false);
    }
  }, [chart]);

  const drillRows = useMemo(() => {
    if (!drill) return [];
    return drill.cell.recordIds.map(id => rowsById.get(id)).filter((row): row is DataRow => !!row);
  }, [drill, rowsById]);

  return (
    <div className={`app${isConfig ? ' is-config' : ''}`}>
      <section className="panel table-panel">
        {error && <div className="error-banner">{error}</div>}
        {phase === 'loading' && <div className="table-empty">正在读取数据…</div>}
        {phase === 'unconfigured' && (
          <div className="table-empty">还没有配置数据源，请在右侧配置面板里选择数据表与汇总层级。</div>
        )}
        {(phase === 'ready' || phase === 'error') && (
          <ThreeLineTable
            rows={groups}
            levels={levels}
            columns={plan.columns}
            onDrill={(cell, path, column, level) => setDrill({ cell, path, column, level })}
          />
        )}
      </section>

      {isConfig && chart && (
        <ConfigPanel
          chart={chart}
          tables={tables}
          ranges={ranges}
          fields={fields}
          filterFields={filterFields}
          headerFields={headerFields}
          candidates={candidates}
          headerCandidates={headerCandidates}
          busy={saving}
          error={saveError}
          onChange={setChart}
          onSave={save}
        />
      )}

      {drill && chart && (
        <DrillDownModal
          path={drill.path}
          columnLabel={drill.column.label}
          rows={drillRows}
          columns={drillColumns}
          tableId={chart.tableId}
          dedupe={drill.level.distinctBy ? { field: drill.level.distinctBy, count: drill.cell.distinct ?? 0 } : undefined}
          total={drill.column.total}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
