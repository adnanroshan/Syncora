import React, { useState, useEffect } from 'react';
import { Icon } from './Icons.jsx';
import { labelize } from './Shared.jsx';

export function ViewTabs({ view, onChange, counts, sortBy, onSort, groupBy, onGroup, filters, onFilter, assigneeOptions }) {
  const tabs = [
    { id: 'list',     icon: 'list',     label: 'List'     },
    { id: 'board',    icon: 'board',    label: 'Board'    },
    { id: 'calendar', icon: 'calendar', label: 'Calendar' },
    { id: 'grouped',  icon: 'group',    label: 'Grouped'  },
  ];

  const [openChip, setOpenChip] = useState(null);

  useEffect(() => {
    if (!openChip) return;
    const onClick = (e) => { if (!e.target.closest('.fchip-wrap')) setOpenChip(null); };
    const onKey   = (e) => { if (e.key === 'Escape') setOpenChip(null); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
  }, [openChip]);

  const pick = (patch) => { onFilter(patch); setOpenChip(null); };

  return (
    <div className="viewtabs">
      <div className="viewtabs-left">
        {tabs.map(t => (
          <button key={t.id}
            className={`vtab ${view === t.id ? 'is-active' : ''}`}
            onClick={() => onChange(t.id)}>
            <Icon name={t.icon} size={13} />
            <span>{t.label}</span>
            {counts && counts[t.id] != null && <span className="vtab-count">{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      <div className="viewtabs-right">
        <FilterChip
          label="Status" value={filters.status}
          open={openChip === 'status'} onToggle={() => setOpenChip(openChip === 'status' ? null : 'status')}
          options={[
            { value: null,         label: 'Any' },
            { value: 'todo',       label: 'To do' },
            { value: 'inprogress', label: 'In progress' },
            { value: 'blocked',    label: 'Blocked' },
            { value: 'done',       label: 'Done' },
            { value: 'verified',   label: 'Verified' },
          ]}
          onPick={(v) => pick({ status: v })}
        />
        <FilterChip
          label="Priority" value={filters.priority}
          open={openChip === 'priority'} onToggle={() => setOpenChip(openChip === 'priority' ? null : 'priority')}
          options={[
            { value: null,     label: 'Any' },
            { value: 'urgent', label: 'Urgent' },
            { value: 'high',   label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low',    label: 'Low' },
          ]}
          onPick={(v) => pick({ priority: v })}
        />
        <FilterChip
          label="Assigner" value={filters.assignee}
          open={openChip === 'assignee'} onToggle={() => setOpenChip(openChip === 'assignee' ? null : 'assignee')}
          options={[
            { value: null, label: 'Any' },
            ...(assigneeOptions || []),
          ]}
          onPick={(v) => pick({ assignee: v })}
          formatValue={(v) => (assigneeOptions || []).find(o => o.value === v)?.label || String(v)}
        />
        <span className="vt-divider"/>
        {view === 'grouped' && (
          <GroupChip
            value={groupBy}
            open={openChip === 'group'}
            onToggle={() => setOpenChip(openChip === 'group' ? null : 'group')}
            onPick={(v) => { onGroup(v); setOpenChip(null); }}
          />
        )}
        <button className="vt-btn" onClick={() => onSort(sortBy === 'due' ? 'priority' : 'due')}>
          <Icon name="sort" size={13} />
          Sort by {sortBy}
        </button>
      </div>
    </div>
  );
}

export const GROUP_OPTIONS = [
  { value: 'taskgroup', label: 'Task group' },
  { value: 'org',       label: 'Client'     },
  { value: 'product',   label: 'Product'    },
  { value: 'module',    label: 'Module'     },
];

/* Like FilterChip, but it's a view setting — always has a value, no clear. */
function GroupChip({ value, open, onToggle, onPick }) {
  const current = GROUP_OPTIONS.find(o => o.value === value) || GROUP_OPTIONS[1];
  return (
    <span className="fchip-wrap">
      <button className={`fchip ${open ? 'is-open' : ''}`} onClick={onToggle}>
        <Icon name="group" size={12}/>
        <span className="fchip-label">Group by</span>
        <span className="fchip-value">{current.label}</span>
        <Icon name="chevron-d" size={10}/>
      </button>
      {open && (
        <div className="fchip-pop" role="listbox">
          {GROUP_OPTIONS.map(opt => (
            <button key={opt.value}
              role="option" aria-selected={value === opt.value}
              className={`fchip-popitem ${value === opt.value ? 'is-selected' : ''}`}
              onClick={() => onPick(opt.value)}>
              <span>{opt.label}</span>
              {value === opt.value && <Icon name="check" size={12}/>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function FilterChip({ label, value, open, onToggle, onPick, options, formatValue }) {
  const display = value == null ? 'any' : (formatValue ? formatValue(value) : labelize(value));
  return (
    <span className="fchip-wrap">
      <button className={`fchip ${value != null ? 'is-active' : ''} ${open ? 'is-open' : ''}`} onClick={onToggle}>
        <span className="fchip-label">{label}</span>
        <span className="fchip-value">{display}</span>
        {value != null
          ? <span className="fchip-clear" onClick={(e) => { e.stopPropagation(); onPick(null); }} aria-label="Clear filter"><Icon name="close" size={11}/></span>
          : <Icon name="chevron-d" size={10}/>}
      </button>
      {open && (
        <div className="fchip-pop" role="listbox">
          {options.map((opt, i) => (
            <button key={String(opt.value) + i}
              role="option" aria-selected={value === opt.value}
              className={`fchip-popitem ${value === opt.value ? 'is-selected' : ''}`}
              onClick={() => onPick(opt.value)}>
              <span>{opt.label}</span>
              {value === opt.value && <Icon name="check" size={12}/>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
