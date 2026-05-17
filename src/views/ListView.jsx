import React from 'react';
import { Icon, StatusGlyph } from '../components/Icons.jsx';
import { normaliseStatus } from '../components/Shared.jsx';
import { STATUSES, sortTasks, Row, Empty } from './_shared.jsx';

export function ListView({ tasks, orgsById, onOpen, selectedId, sortBy }) {
  const sorted = sortTasks(tasks, sortBy);
  const groups = STATUSES
    .map(s => ({ ...s, items: sorted.filter(t => normaliseStatus(t.status) === s.key) }))
    .filter(g => g.items.length);

  if (!groups.length) return <Empty/>;

  return (
    <div className="listview">
      {groups.map(g => (
        <section key={g.key} className="list-group">
          <header className="list-group-head">
            <Icon name="chevron-d" size={11}/>
            <StatusGlyph status={g.key} size={13}/>
            <span className="lgh-label">{g.label}</span>
            <span className="lgh-count">{g.items.length}</span>
            <button className="lgh-add" aria-label="Add"><Icon name="plus" size={12}/></button>
          </header>
          <div className="list-rows">
            {g.items.map(t => (
              <Row key={t.taskid} t={t} orgsById={orgsById} onOpen={onOpen} isSelected={selectedId === t.taskid}/>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
