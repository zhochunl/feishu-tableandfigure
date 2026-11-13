import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardState, dashboard } from '@lark-base-open/js-sdk';
import { ConfigPanel } from './components/ConfigPanel';
import { DrillDownModal } from './components/DrillDownModal';
import { ThreeLineTable } from './components/ThreeLineTable';
import { aggregate } from './lib/aeAggregate';
import { listRanges, listTables, loadChart, loadFields, loadRows, markRendered, saveChart } from './lib/bitable';
import { defaultChart, levelIds, parseConfig, rangeKey, rangeLabel, resolveLevels } from './lib/config';
import type { ChartConfig, DataRange, DataRow, FieldMeta, GroupRow, TableEntry } from './lib/types';

type Phase = 'loading' | 'ready' | 'unconfigured' | 'error';

export default function App() {
  const state = dashboard.state;
  const isConfig = state === DashboardState.Create || state === DashboardState.Config;

  const [chart, setChart] = useState<ChartConfig | null>(null);
  const [tables, setTables] = useState<TableEntry[]>([]);
  const [ranges, setRanges] = useState<DataRange[]>([]);
  const [fields, setFields] = useState<FieldMeta[]>([]);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [drill, setDrill] = useState<{ group: GroupRow; path: string } | null>(null);

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
        const [nextFields, nextRanges] = await Promise.all([loadFields(tableId), listRanges(tableId)]);
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
  const groups = useMemo(() => aggregate(rows, levels), [rows, levels]);
  const rowsById = useMemo(() => new Map(rows.map(row => [row.recordId, row])), [rows]);

  const drillColumns = useMemo(() => {
    const ids = chart ? levelIds(chart) : [];
    const picked = ids.map(id => fields.find(field => field.id === id)).filter((field): field is FieldMeta => !!field);
    return picked.length ? picked : fields.slice(0, 6);
  }, [chart, fields]);

  const tableName = useMemo(
    () => tables.find(table => table.id === chart?.tableId)?.name ?? chart?.tableId ?? '',
    [tables, chart],
  );

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
    return drill.group.recordIds.map(id => rowsById.get(id)).filter((row): row is DataRow => !!row);
  }, [drill, rowsById]);

  return (
    <div className={`app${isConfig ? ' is-config' : ''}`}>
      <section className="panel table-panel">
        <div className="table-caption">
          <b>{levels.map(level => level.field).join(' ＞ ') || 'AE 多级汇总三线表'}</b>
          {chart && (
            <span className="caption-sub">
              {tableName} · {rangeLabel(chart.dataRange)} · {rows.length.toLocaleString()} 行
            </span>
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}
        {phase === 'loading' && <div className="table-empty">正在读取数据…</div>}
        {phase === 'unconfigured' && (
          <div className="table-empty">还没有配置数据源，请在仪表盘图表的配置面板里选择数据表与汇总层级。</div>
        )}
        {(phase === 'ready' || phase === 'error') && (
          <ThreeLineTable
            groups={groups}
            headers={levels.map(level => level.field)}
            distinctLevels={levels.filter(level => level.distinctBy).length}
            onDrill={(group, path) => setDrill({ group, path })}
          />
        )}
      </section>

      {isConfig && chart && (
        <ConfigPanel
          chart={chart}
          tables={tables}
          ranges={ranges}
          fields={fields}
          busy={saving}
          error={saveError}
          onChange={setChart}
          onSave={save}
        />
      )}

      {drill && chart && (
        <DrillDownModal
          path={drill.path}
          rows={drillRows}
          columns={drillColumns}
          tableId={chart.tableId}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
