import React from 'react';
import { Icon, StatusGlyph } from '../components/Icons.jsx';
import { Avatar, OrgMark, PriorityMark, DueChip, normaliseStatus } from '../components/Shared.jsx';
import { STATUSES, sortTasks, shortId } from './_shared.jsx';

export function BoardView({ tasks, orgsById, onOpen, selectedId, sortBy, onChangeStatus }) {
  return (
    <div className="boardview">
      {STATUSES.map(s => {
        const items = sortTasks(tasks.filter(t => normaliseStatus(t.status) === s.key), sortBy);
        return (
          <div key={s.key} className={`bcol bcol--${s.key}`}>
            <header className="bcol-head">
              <StatusGlyph status={s.key} size={14}/>
              <span className="bcol-label">{s.label}</span>
              <span className="bcol-count">{items.length}</span>
              <span style={{ flex: 1 }}/>
              <button className="bcol-add" aria-label="Add to column"><Icon name="plus" size={12}/></button>
              <button className="bcol-more" aria-label="More"><Icon name="more" size={13}/></button>
            </header>
            <div className="bcol-list">
              {items.map(t => (
                <Card key={t.taskid} t={t} orgsById={orgsById} onOpen={onOpen} isSelected={selectedId === t.taskid} onChangeStatus={onChangeStatus}/>
              ))}
              <button className="bcol-newbtn"><Icon name="plus" size={12}/> New</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Card({ t, orgsById, onOpen, isSelected }) {
  const org = orgsById?.[t.organisationid];
  return (
    <div className={`card ${isSelected ? 'is-selected' : ''}`} onClick={() => onOpen(t.taskid)} tabIndex={0}>
      <div className="card-top">
        <span className="row-id">{shortId(t)}</span>
        <PriorityMark priority={t.priority}/>
      </div>
      <div className="card-title">{t.title || '(untitled)'}</div>
      <div className="card-tags">
        {t.modulename && <span className="tag">{t.modulename}</span>}
        {t.taskgroupname && <span className="tag tag--ghost">{t.taskgroupname}</span>}
      </div>
      <div className="card-foot">
        <span className="card-org">{org ? <OrgMark org={org} size={15}/> : null}<span>{org?.short || (org?.name?.slice(0,2)?.toUpperCase() ?? '')}</span></span>
        <DueChip iso={t.duedate} compact/>
        <Avatar user={t.assignee} name={t.usersusername} size={18}/>
      </div>
    </div>
  );
}
