import { useState } from 'react';
import { showRecord } from '../lib/bitable';
import { cellDisplay } from '../lib/cellText';
import type { DataRow, FieldMeta } from '../lib/types';

const RENDER_LIMIT = 200;

interface Props {
  /** 面包屑，如「心脏疾病 ＞ 心悸」 */
  path: string;
  /** 表头列名，多列时要标明是哪一列 */
  columnLabel: string;
  /** 该组该列的例次记录，不做去重 */
  rows: DataRow[];
  /** 弹窗展示的字段，含分组、勾选的去重与连接变量；表头用名字、记录卡片用 id */
  columns: FieldMeta[];
  tableId: string;
  /** 勾了去重时给出变量名与去重后人数 */
  dedupe?: { field: string; count: number };
  /** 该列分母，说明百分比口径用 */
  total?: number;
  onClose: () => void;
}

export function DrillDownModal({ path, columnLabel, rows, columns, tableId, dedupe, total, onClose }: Props) {
  const [failed, setFailed] = useState(false);

  // 用宿主原生的记录详情卡片，和飞书自带图表点开一条记录的表现一致
  async function openRecord(recordId: string) {
    try {
      await showRecord(tableId, recordId, columns.map(column => column.id));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  const shown = rows.slice(0, RENDER_LIMIT);
  const summary = [
    `例次 ${rows.length.toLocaleString()} 条`,
    dedupe ? `按 ${dedupe.field} 去重 ${dedupe.count.toLocaleString()} 人` : '',
    total ? `该列合计 ${total.toLocaleString()}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" role="dialog" aria-label="数据详情" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <b>{columnLabel ? `${path} · ${columnLabel}` : path}</b>
            <span className="modal-count">{summary}</span>
          </div>
          <button className="btn-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="modal-body">
          {failed && <div className="error-banner">打开记录失败，请确认对当前数据表有读取权限。</div>}
          <table className="detail-table">
            <thead>
              <tr>
                <th className="idx-head">#</th>
                {columns.map(column => (
                  <th key={column.id}>{column.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, index) => (
                <tr key={row.recordId} onClick={() => openRecord(row.recordId)}>
                  <td className="idx-cell">{index + 1}</td>
                  {columns.map(column => (
                    <td key={column.id}>{cellDisplay(row.cells[column.name] ?? []) || <span className="na">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown.length && (
            <p className="modal-more">列表只显示前 {RENDER_LIMIT} 条，完整记录请在多维表格中筛选查看。</p>
          )}
        </div>
      </div>
    </div>
  );
}
