import { useEffect, useState, type ReactNode } from 'react';
import type { GroupRow } from '../lib/types';

interface Props {
  groups: GroupRow[];
  /** 表头用的层级字段名 */
  headers: string[];
  /** 配了去重的层级数，决定要不要出「例数」列 */
  distinctLevels: number;
  onDrill: (group: GroupRow, path: string) => void;
}

/** 三线表：单列分组按层级缩进，右侧例次 / 例数列，数字可点击钻取。 */
export function ThreeLineTable({ groups, headers, distinctLevels, onDrill }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const signature = headers.join('|');

  // 层级配置一变，旧的折叠键就不再对应任何分组；用字符串比较，否则每次渲染都会被清空
  useEffect(() => setCollapsed(new Set()), [signature]);

  function renderRows(rows: GroupRow[], depth: number, path: string): ReactNode[] {
    return rows.flatMap((row, index) => {
      const displayPath = path ? `${path} ＞ ${row.value}` : row.value;
      const key = `${displayPath}#${index}`;
      const expandable = row.children.length > 0;
      const open = expandable && !collapsed.has(key);

      const toggle = () =>
        setCollapsed(prev => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });

      const cells: ReactNode[] = [
        <td key="g" className="group-cell" style={{ paddingLeft: `${8 + depth * 18}px` }}>
          {expandable ? (
            <button className={`expand-btn${open ? '' : ' is-collapsed'}`} onClick={toggle} aria-label={open ? '收起' : '展开'}>
              ▶
            </button>
          ) : (
            <span className="expand-sp" />
          )}
          {row.value}
        </td>,
        <td key="c" className="num-cell">
          <button className="cell-link" onClick={() => onDrill(row, displayPath)}>
            {row.count.toLocaleString()}
          </button>
        </td>,
      ];

      if (distinctLevels > 0) {
        cells.push(
          <td key="d" className="num-cell">
            {row.distinct === undefined ? (
              <span className="na">—</span>
            ) : (
              <button className="cell-link" onClick={() => onDrill(row, displayPath)}>
                {row.distinct.toLocaleString()}
              </button>
            )}
          </td>,
        );
      }

      const nodes: ReactNode[] = [<tr key={key}>{cells}</tr>];
      if (open) nodes.push(...renderRows(row.children, depth + 1, displayPath));
      return nodes;
    });
  }

  if (!groups.length) return <div className="table-empty">没有可汇总的数据，请检查分组字段与数据范围。</div>;

  return (
    <div className="table-scroll">
      <table className="three-line-table">
        <thead>
          <tr>
            <th>{headers.filter(Boolean).join(' ＞ ') || '分组'}</th>
            <th className="num-head">例次</th>
            {distinctLevels > 0 && <th className="num-head">例数</th>}
          </tr>
        </thead>
        <tbody>{renderRows(groups, 0, '')}</tbody>
      </table>
    </div>
  );
}
