import type { ChartConfig, DataRange, FieldMeta, StoredLevel, TableEntry } from '../lib/types';
import { rangeKey, rangeLabel } from '../lib/config';
import { FilterEditor } from './FilterEditor';

interface Props {
  chart: ChartConfig;
  tables: TableEntry[];
  ranges: DataRange[];
  /** 数据表字段，按表内列顺序 */
  fields: FieldMeta[];
  /** 表头表字段，同样按表内列顺序 */
  headerFields: FieldMeta[];
  /** 数据表各字段的候选取值 */
  candidates: Record<string, string[]>;
  /** 表头表各字段的候选取值 */
  headerCandidates: Record<string, string[]>;
  busy: boolean;
  error: string;
  onChange: (chart: ChartConfig) => void;
  onSave: () => void;
}

/**
 * 仪表盘配置态面板，放在预览区右侧：
 * 表头配置（列与分母）→ 连接变量 → 数据表配置（数据源与多层分组）。
 */
export function ConfigPanel({
  chart,
  tables,
  ranges,
  fields,
  headerFields,
  candidates,
  headerCandidates,
  busy,
  error,
  onChange,
  onSave,
}: Props) {
  const patch = (next: Partial<ChartConfig>) => onChange({ ...chart, ...next });

  const patchLevel = (index: number, next: Partial<StoredLevel>) =>
    patch({ levels: chart.levels.map((level, i) => (i === index ? { ...level, ...next } : level)) });

  const validCount = chart.levels.filter(level => level.fieldId).length;
  const headerTableId = chart.header?.tableId ?? '';
  const hasHeader = !!headerTableId;

  const setHeaderTable = (tableId: string) => {
    if (!tableId) return patch({ header: undefined, join: undefined });
    const sameTable = tableId === chart.header?.tableId;
    patch({
      // 换表头表字段就变了，列变量与筛选条件一起作废
      header: sameTable
        ? chart.header
        : { tableId, fieldId: undefined, filters: [] },
      // 换表头表只作废表头侧的连接字段，数据表侧还能继续用
      join: chart.join ? { fieldId: chart.join.fieldId, headerFieldId: sameTable ? chart.join.headerFieldId : '' } : undefined,
    });
  };

  const setJoin = (next: Partial<{ fieldId: string; headerFieldId: string }>) =>
    patch({ join: { fieldId: chart.join?.fieldId ?? '', headerFieldId: chart.join?.headerFieldId ?? '', ...next } });

  return (
    <section className="config-panel">
      <div className="config-head">
        <span className="section-label">分层频率表</span>
      </div>

      <div className="config-section">
        <span className="section-label">表头配置</span>
        <label className="field">
          <span>表头表单</span>
          <select value={headerTableId} disabled={busy} onChange={event => setHeaderTable(event.target.value)}>
            <option value="">不配置</option>
            {tables.map(table => (
              <option key={table.id} value={table.id}>
                {table.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>列变量</span>
          <select
            value={chart.header?.fieldId ?? ''}
            disabled={busy || !hasHeader}
            onChange={event => patch({ header: { tableId: headerTableId, fieldId: event.target.value || undefined, filters: chart.header?.filters } })}
          >
            <option value="">不分组，整表记录数作总计</option>
            {headerFields.map(field => (
              <option key={field.id} value={field.id}>
                {field.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field-label">筛选条件</div>
        <FilterEditor
          fields={headerFields}
          conditions={chart.header?.filters ?? []}
          candidates={headerCandidates}
          disabled={busy || !hasHeader}
          onChange={filters => patch({ header: { tableId: headerTableId, fieldId: chart.header?.fieldId, filters } })}
        />
      </div>

      <div className="config-section">
        <span className="section-label">连接变量</span>
        <div className="source-row">
          <label className="field">
            <span>数据表</span>
            <select
              value={chart.join?.fieldId ?? ''}
              disabled={busy || !hasHeader}
              onChange={event => setJoin({ fieldId: event.target.value })}
            >
              <option value="">选择变量</option>
              {fields.map(field => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>表头表单</span>
            <select
              value={chart.join?.headerFieldId ?? ''}
              disabled={busy || !hasHeader}
              onChange={event => setJoin({ headerFieldId: event.target.value })}
            >
              <option value="">选择变量</option>
              {headerFields.map(field => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="config-section">
        <span className="section-label">数据表配置</span>
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
              onChange={event =>
                patch({ dataRange: ranges.find(range => rangeKey(range) === event.target.value) ?? chart.dataRange })
              }
            >
              {(ranges.length ? ranges : [chart.dataRange]).map(range => (
                <option key={rangeKey(range)} value={rangeKey(range)}>
                  {rangeLabel(range)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-label">筛选条件</div>
        <FilterEditor
          fields={fields}
          conditions={chart.filters ?? []}
          candidates={candidates}
          disabled={busy}
          onChange={filters => patch({ filters })}
        />

        {chart.levels.map((level, index) => (
          <div key={index} className="level">
            <div className="level-row">
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
              <button
                className="btn-ghost is-icon"
                disabled={busy}
                onClick={() => patch({ levels: chart.levels.filter((_, i) => i !== index) })}
                aria-label="删除该层"
              >
                ×
              </button>
            </div>
            <div className="level-sub">
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!level.dedupe}
                  disabled={busy}
                  onChange={event => patchLevel(index, { dedupe: event.target.checked })}
                />
                去重
              </label>
              <select
                className={`pick is-optional${level.dedupe && !level.distinctFieldId ? ' is-invalid' : ''}`}
                value={level.distinctFieldId ?? ''}
                disabled={busy || !level.dedupe}
                onChange={event => patchLevel(index, { distinctFieldId: event.target.value || undefined })}
              >
                <option value="">选择变量</option>
                {fields.map(field => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
              <label className="check" title={hasHeader ? '' : '百分比的分母来自表头表单，需要先配置表头'}>
                <input
                  type="checkbox"
                  checked={!!level.percent}
                  disabled={busy || !hasHeader}
                  onChange={event => patchLevel(index, { percent: event.target.checked })}
                />
                百分比
              </label>
            </div>
          </div>
        ))}

        <button
          className="btn-ghost is-add"
          disabled={busy}
          onClick={() => patch({ levels: [...chart.levels, { fieldId: '' }] })}
        >
          添加层级
        </button>

        {!validCount && <p className="hint">例如第一层选 AESOC、第二层选 AEPT，勾选去重后选 SUBJECT 即按受试者计数。</p>}
      </div>

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

/** 换数据表后字段全变，旧的 fieldId 一律作废，否则汇总会静默按不存在的字段计数。 */
function switchTable(chart: ChartConfig, tableId: string): ChartConfig {
  if (tableId === chart.tableId) return chart;
  return {
    ...chart,
    tableId,
    dataRange: { type: 'ALL' },
    levels: [{ fieldId: '' }],
    filters: [],
    join: chart.join ? { fieldId: '', headerFieldId: chart.join.headerFieldId } : undefined,
  };
}
