import { useState } from 'react';
import { FILTER_OPERATORS, operatorsFor, splitList } from '../lib/filters';
import type { FieldMeta, FilterCondition, FilterOperator } from '../lib/types';

interface Props {
  fields: FieldMeta[];
  conditions: FilterCondition[];
  /** fieldId -> 该字段在（未筛选）记录里出现过的取值，下拉里全列出来 */
  candidates: Record<string, string[]>;
  disabled: boolean;
  onChange: (conditions: FilterCondition[]) => void;
}

const MULTI: FilterOperator[] = ['in', 'notIn'];

/** 一组筛选条件，多条之间是「且」；用来把源表取子集后再计数 */
export function FilterEditor({ fields, conditions, candidates, disabled, onChange }: Props) {
  // 一次只开一个候选值下拉
  const [openIndex, setOpenIndex] = useState(-1);

  const patch = (index: number, next: Partial<FilterCondition>) =>
    onChange(conditions.map((item, i) => (i === index ? { ...item, ...next } : item)));

  const metaOf = (fieldId: string) => fields.find(field => field.id === fieldId);

  const setField = (index: number, fieldId: string) => {
    const allowed = operatorsFor(metaOf(fieldId)).map(spec => spec.value);
    const current = conditions[index].operator;
    // 换字段后旧操作符可能不再支持（文本列的大小比较），退回等于；值也一并清掉
    patch(index, { fieldId, operator: allowed.includes(current) ? current : 'eq', value: '' });
  };

  return (
    <div className="filters">
      {conditions.map((condition, index) => {
        const allowed = operatorsFor(metaOf(condition.fieldId)).map(spec => spec.value);
        const spec = FILTER_OPERATORS.find(item => item.value === condition.operator);
        const list = condition.fieldId ? candidates[condition.fieldId] ?? [] : [];
        const multi = MULTI.includes(condition.operator);
        const selected = splitList(condition.value ?? '');
        const on = (value: string) =>
          multi
            ? selected.some(item => item.toLowerCase() === value.toLowerCase())
            : (condition.value ?? '').trim().toLowerCase() === value.toLowerCase();

        const pick = (value: string) => {
          if (!multi) {
            patch(index, { value });
            setOpenIndex(-1);
            return;
          }
          // 属于/不属于点一下加一个、再点取消，值始终是逗号分隔的列表
          const hit = (item: string) => item.toLowerCase() === value.toLowerCase();
          patch(index, { value: (selected.some(hit) ? selected.filter(item => !hit(item)) : [...selected, value]).join(',') });
        };
        return (
          <div key={index} className="filter">
            <div className="filter-row">
              <select
                className={`pick${condition.fieldId ? '' : ' is-invalid'}`}
                value={condition.fieldId}
                disabled={disabled}
                onChange={event => setField(index, event.target.value)}
              >
                <option value="">选择变量</option>
                {fields.map(field => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
              <button
                className="btn-ghost is-icon"
                disabled={disabled}
                onClick={() => onChange(conditions.filter((_, i) => i !== index))}
                aria-label="删除该条件"
              >
                ×
              </button>
            </div>
            <div className="filter-sub">
              <select
                className="pick"
                value={condition.operator}
                disabled={disabled}
                title="大于、小于、大于等于、小于等于只支持数值列和日期列"
                onChange={event => patch(index, { operator: event.target.value as FilterOperator })}
              >
                {FILTER_OPERATORS.map(item => (
                  <option key={item.value} value={item.value} disabled={!disabled && !allowed.includes(item.value)}>
                    {item.label}
                  </option>
                ))}
              </select>
              <div className="value-box">
                <input
                  className="value-typed"
                  value={condition.value ?? ''}
                  disabled={disabled}
                  placeholder={spec?.hint ?? '选或输入'}
                  onChange={event => patch(index, { value: event.target.value })}
                />
                <button
                  className="value-caret"
                  disabled={disabled || !list.length}
                  aria-label="该变量的取值"
                  onClick={() => setOpenIndex(openIndex === index ? -1 : index)}
                >
                  ▾
                </button>
                {openIndex === index && (
                  <>
                    <div className="value-backdrop" onClick={() => setOpenIndex(-1)} />
                    <div className="value-menu">
                      {list.map(value => (
                        <button
                          key={value}
                          className={`value-item${on(value) ? ' is-on' : ''}`}
                          onClick={() => pick(value)}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <button
        className="btn-ghost is-add"
        disabled={disabled || !fields.length}
        onClick={() => onChange([...conditions, { fieldId: '', operator: 'eq', value: '' }])}
      >
        添加筛选条件
      </button>
    </div>
  );
}
