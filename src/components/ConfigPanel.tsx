import type { ChartConfig, DataRange, FieldMeta, StoredLevel, TableEntry } from '../lib/types';
import { rangeKey, rangeLabel } from '../lib/config';

interface Props {
  chart: ChartConfig;
  tables: TableEntry[];
  ranges: DataRange[];
  /** 当前数据表的字段，切表时会变 */
  fields: FieldMeta[];
  busy: boolean;
  error: string;
  onChange: (chart: ChartConfig) => void;
  onSave: () => void;
}

/** 仪表盘配置态面板：数据源 + 多层分组 + 每层去重字段。 */
export function ConfigPanel({ chart, tables, ranges, fields, busy, error, onChange, onSave }: Props) {
  const patch = (next: Partial<ChartConfig>) => onChange({ ...chart, ...next });

  const patchLevel = (index: number, next: Partial<StoredLevel>) =>
    patch({ levels: chart.levels.map((level, i) => (i === index ? { ...level, ...next } : level)) });

  const validCount = chart.levels.filter(level => level.fieldId).length;

  return (
    <section className="config-panel">
      <div className="config-head">
        <span className="section-label">三线表配置</span>
        <button
          className="btn-ghost"
          disabled={busy}
          onClick={() => patch({ levels: [...chart.levels, { fieldId: '' }] })}
        >
          添加层级
        </button>
      </div>

      <div className="source-row">
        <label className="field">
          <span>数据表</span>
          <select value={chart.tableId} disabled={busy} onChange={event => onChange(switchTable(chart, event.target.value))}>
            {!tables.length && <option value="">没有可用数据表</option>}
            {tables.map(table => (
              <option key={table.id} value={table.id}>
                {table.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>数据范围</span>
          <select
            value={rangeKey(chart.dataRange)}
            disabled={busy}
            onChange={event => patch({ dataRange: ranges.find(range => rangeKey(range) === event.target.value) ?? chart.dataRange })}
          >
            {(ranges.length ? ranges : [chart.dataRange]).map(range => (
              <option key={rangeKey(range)} value={rangeKey(range)}>
                {rangeLabel(range)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {chart.levels.map((level, index) => (
        <div key={index} className="level-row">
          <span className="level-badge">{index + 1}</span>
          <select
            className={`pick${level.fieldId ? '' : ' is-invalid'}`}
            value={level.fieldId}
            disabled={busy}
            onChange={event => patchLevel(index, { fieldId: event.target.value })}
          >
            <option value="">分组字段</option>
            {fields.map(field => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
          </select>
          <select
            className="pick is-optional"
            value={level.distinctFieldId ?? ''}
            disabled={busy}
            onChange={event => patchLevel(index, { distinctFieldId: event.target.value || undefined })}
          >
            <option value="">不去重</option>
            {fields.map(field => (
              <option key={field.id} value={field.id}>
                按 {field.name} 去重
              </option>
            ))}
          </select>
          <button
            className="btn-ghost is-icon"
            disabled={busy}
            onClick={() => patch({ levels: chart.levels.filter((_, i) => i !== index) })}
            aria-label="删除该层"
          >
            ×
          </button>
        </div>
      ))}

      {!validCount && <p className="hint">例如第一层选 AESOC、第二层选 AEPT，去重字段选 SUBJECT 即按受试者计数。</p>}

      {error && <div className="error-banner">{error}</div>}

      <div className="config-foot">
        <button className="btn-primary" disabled={busy || !chart.tableId || !validCount} onClick={onSave}>
          {busy ? '保存中…' : '保存配置'}
        </button>
        <span className="hint">共 {validCount} 层</span>
      </div>
    </section>
  );
}

/** 换表后字段全变，旧的 fieldId 一律作废，否则汇总会静默按不存在的字段计数。 */
function switchTable(chart: ChartConfig, tableId: string): ChartConfig {
  if (tableId === chart.tableId) return chart;
  return { tableId, dataRange: { type: 'ALL' }, levels: [{ fieldId: '' }] };
}
