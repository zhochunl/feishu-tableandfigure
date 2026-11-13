import { useState } from 'react';
import { showRecord } from '../lib/bitable';
import { cellDisplay } from '../lib/cellText';
import type { DataRow, FieldMeta } from '../lib/types';

const RENDER_LIMIT = 200;

interface Props {
  /** 面包屑，如「心脏疾病 ＞ 心悸」 */
  path: string;
  /** 组内记录，直接来自插件已读取的数据，不再回宿主取 */
  rows: DataRow[];
  /** 弹窗展示的字段，表头用名字、记录卡片用 id */
  columns: FieldMeta[];
  tableId: string;
  onClose: () => void;
}

export function DrillDownModal({ path, rows, columns, tableId, onClose }: Props) {
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <b>{path}</b>
            <span className="modal-count">{rows.length.toLocaleString()} 条记录</span>
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
                <th className="op-head">操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row, index) => (
                <tr key={row.recordId}>
                  <td className="idx-cell">{index + 1}</td>
                  {columns.map(column => (
                    <td key={column.id}>{cellDisplay(row.cells[column.name] ?? []) || <span className="na">—</span>}</td>
                  ))}
                  <td>
                    <button className="btn-link" onClick={() => openRecord(row.recordId)}>
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown.length && (
            <p className="modal-more">列表只显示前 {RENDER_LIMIT} 条，完整记录请在多维表格中筛选查看。</p>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
