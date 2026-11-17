import { useEffect, useState, type ReactNode } from 'react';
import type { GroupCell, GroupRow, LevelConfig, TableValue } from '../lib/types';

interface Props {
  rows: GroupRow[];
  levels: LevelConfig[];
  /** 表头列，没有表头配置时是一列「全部」 */
  columns: TableValue[];
  /** 三个数字同属一个数据块，钻取都回到这一批例次记录；level/depth 带出去重口径与后续层级排序 */
  onDrill: (cell: GroupCell, path: string, column: TableValue, level: LevelConfig, depth: number) => void;
}

/** 三线表：分组按层级缩进，每列表头给一个「例次 (例数) 百分比」数据块，三个数字都钻取同一批例次记录。 */
export function ThreeLineTable({ rows, levels, columns, onDrill }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const signature = `${levels.map(level => level.field).join('|')}#${columns.map(column => column.key).join('|')}`;

  // 层级或列配置一变，旧的折叠键就不再对应任何分组；用字符串比较，否则每次渲染都会被清空
  useEffect(() => setCollapsed(new Set()), [signature]);

  function renderRows(list: GroupRow[], depth: number, path: string): ReactNode[] {
    return list.flatMap((row, index) => {
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
        ...columns.map((column, columnIndex) => {
          const cell = row.cells[columnIndex];
          const drill = () => onDrill(cell, displayPath, column, levels[depth], depth);
          return (
            <td key={column.key || 'single'} className="num-cell">
              {!cell || !cell.count ? (
                <span className="na">0</span>
              ) : (
                <>
                  <button className="cell-link" onClick={drill}>
                    {cell.count.toLocaleString()}
                  </button>
                  {cell.distinct !== undefined && (
                    <span className="paren">
                      （
                      <button className="cell-link" onClick={drill}>
                        {cell.distinct.toLocaleString()}
                      </button>
                      ）
                    </span>
                  )}
                  {cell.percent !== undefined && <span className="pct">{cell.percent.toFixed(1)}%</span>}
                </>
              )}
            </td>
          );
        }),
      ];

      const nodes: ReactNode[] = [<tr key={key}>{cells}</tr>];
      if (open) nodes.push(...renderRows(row.children, depth + 1, displayPath));
      return nodes;
    });
  }

  if (!rows.length) return <div className="table-empty">没有可汇总的数据，请检查分组字段与数据范围。</div>;

  return (
    <div className="table-scroll">
      <table className="three-line-table">
        <thead>
          <tr>
            {/* 分组变量收在一个单元格里逐行写，整块和右侧列标题上下对齐 */}
            <th className="group-cell levels-head">
              {levels.map((level, depth) => (
                <span key={`${level.field}-${depth}`} className="level-name" style={{ paddingLeft: `${depth * 18}px` }}>
                  {level.field}
                </span>
              ))}
            </th>
            {columns.map(column => (
              <th key={column.key || 'single'} className="num-head">
                {column.label}
                {!!column.total && <span className="head-n">N={column.total.toLocaleString()}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{renderRows(rows, 0, '')}</tbody>
      </table>
    </div>
  );
}
