/* Shared view helpers: status enum, sort, row template. */

import React from 'react';
import { Icon, StatusGlyph } from '../components/Icons.jsx';
import { Avatar, OrgMark, PriorityMark, DueChip, normaliseStatus } from '../components/Shared.jsx';

export const STATUSES = [
  { key: 'todo',       label: 'To do',       sort: 0 },
  { key: 'inprogress', label: 'In progress', sort: 1 },
  { key: 'blocked',    label: 'Blocked',     sort: 2 },
  { key: 'done',       label: 'Done',        sort: 3 },
];

export const PRIO_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };

export function sortTasks(tasks, by) {
  const arr = [...tasks];
  if (by === 'priority') {
    arr.sort((a, b) => (PRIO_RANK[a.priority] ?? 99) - (PRIO_RANK[b.priority] ?? 99));
  } else if (by === 'due') {
    arr.sort((a, b) => {
      if (!a.duedate && !b.duedate) return 0;
      if (!a.duedate) return 1;
      if (!b.duedate) return -1;
      return new Date(a.duedate) - new Date(b.duedate);
    });
  } else if (by === 'modified') {
    arr.sort((a, b) => new Date(b.lastmodifieddate) - new Date(a.lastmodifieddate));
  }
  return arr;
}

export function shortId(t) {
  // Pretty ticket ID — "SY-184" style. Falls back to plain id if not numeric.
  const n = parseInt(t.taskid, 10);
  if (isNaN(n)) return `SY-${t.taskid}`;
  return `SY-${n}`;
}

export function Row({ t, orgsById, onOpen, isSelected }) {
  const status = normaliseStatus(t.status);
  const org = orgsById?.[t.organisationid];
  return (
    <div className={`row ${isSelected ? 'is-selected' : ''} ${status === 'done' ? 'is-done' : ''}`}
         onClick={() => onOpen(t.taskid)} tabIndex={0}>
      <span className="row-id">{shortId(t)}</span>
      <PriorityMark priority={t.priority}/>
      <StatusGlyph status={status} size={14}/>
      <span className="row-title">{t.title || '(untitled)'}</span>
      <span className="row-meta">
        {t.modulename && <span className="tag tag--mod">{t.modulename}</span>}
      </span>
      <span className="row-org">
        {org ? <OrgMark org={org} size={16}/> : null}
        <span className="row-org-name">{org?.name || t.organisationname}</span>
      </span>
      <DueChip iso={t.duedate} compact/>
      <Avatar user={t.assignee} size={20}/>
    </div>
  );
}

export function Empty({ title = 'Nothing matches', sub = 'Try clearing a filter, or create a new task.' }) {
  return (
    <div className="empty">
      <div className="empty-glyph"><Icon name="inbox" size={28}/></div>
      <div className="empty-title">{title}</div>
      <div className="empty-sub">{sub}</div>
    </div>
  );
}
