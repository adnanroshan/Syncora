/* Activity tab — typed-event timeline.
 * Each event row is dispatched on (activitytype + fieldname) to a
 * renderer that emits { tone, icon, line }.
 */

import React, { useMemo, useState } from 'react';
import { Icon } from './Icons.jsx';
import { Avatar } from './Shared.jsx';

const STATUS_LABEL = { todo: 'To do', inprogress: 'In progress', done: 'Done', blocked: 'Blocked' };
const PRIO_LABEL   = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'No priority' };
const PRIO_COLOR   = {
  urgent: 'var(--priority-urgent)', high: 'var(--priority-high)',
  medium: 'var(--priority-medium)', low: 'var(--priority-low)', none: 'var(--priority-none)',
};

function fmtShortDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)        return 'just now';
  if (diff < 3600)      return Math.round(diff / 60) + 'm ago';
  if (diff < 86400)     return Math.round(diff / 3600) + 'h ago';
  if (diff < 86400 * 7) return Math.round(diff / 86400) + 'd ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function absTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
function dayKey(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function StatusChip({ value, old }) {
  const v = (value || 'todo').toLowerCase();
  return (
    <span className={`act-val act-val--status-${v} ${old ? 'act-val--old' : ''}`}>
      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor', opacity: 0.7 }}/>
      {STATUS_LABEL[v] || value}
    </span>
  );
}
function PrioChip({ value, old }) {
  const v = (value || 'none').toLowerCase();
  return (
    <span className={`act-val act-val--prio-${v} ${old ? 'act-val--old' : ''}`}>
      <span className="act-prio-dot" style={{ background: PRIO_COLOR[v] }}/>
      {PRIO_LABEL[v] || value}
    </span>
  );
}
function DateChip({ value, old }) {
  return <span className={`act-val ${old ? 'act-val--old' : ''}`}>{fmtShortDate(value)}</span>;
}
function Quote({ text }) {
  if (!text) return <span className="act-val act-val--old">empty</span>;
  return <span className="act-quote" title={text}>“{text}”</span>;
}

function renderActivity(a, usersById) {
  const user = usersById[a.userid] || { username: a.userUsername, name: a.userUsername };
  const name  = <b>{user.name || user.username}</b>;
  const type  = (a.activitytype || '').toLowerCase();
  const field = (a.fieldname || '').toLowerCase();

  if (type.includes('created') && !type.includes('subtask')) {
    return { tone: 'success', icon: 'sparkle', line: <>{name}<span> created this task</span></> };
  }
  if (type.includes('status') || field === 'status') {
    return {
      tone: 'info', icon: 'circle-half',
      line: (<>{name}<span> changed status</span>
        {a.oldvalue && <><span> from</span> <StatusChip value={a.oldvalue} old/></>}
        <span> to</span> <StatusChip value={a.newvalue}/></>),
    };
  }
  if (type.includes('priority') || field === 'priority') {
    return {
      tone: 'warn', icon: 'flag',
      line: (<>{name}<span> changed priority</span>
        {a.oldvalue && <><span> from</span> <PrioChip value={a.oldvalue} old/></>}
        <span> to</span> <PrioChip value={a.newvalue}/></>),
    };
  }
  if (type.includes('due date') || field === 'duedate') {
    const cleared = !a.newvalue;
    const wasNone = !a.oldvalue;
    const verb = cleared ? 'cleared the due date'
              : wasNone ? 'set the due date'
              : type.includes('extended') ? 'extended the due date'
              : 'moved the due date';
    return {
      tone: 'warn', icon: 'calendar',
      line: (<>{name}<span> {verb}</span>
        {!cleared && !wasNone && <><span> from</span> <DateChip value={a.oldvalue} old/> <span className="act-arrow">→</span> <DateChip value={a.newvalue}/></>}
        {wasNone && !cleared && <><span> to</span> <DateChip value={a.newvalue}/></>}</>),
    };
  }
  if (type.includes('assignee') || field === 'assigneduserid' || field === 'usersusername') {
    const target = usersById[a.newvalue] || usersById[a.oldvalue]
                || { username: a.newvalue || a.oldvalue, name: a.newvalue || a.oldvalue };
    const removing = type.includes('removed') || (!a.newvalue && a.oldvalue);
    return {
      tone: removing ? 'danger' : 'accent',
      icon: removing ? 'user-minus' : 'user-plus',
      line: (<>{name}<span> {removing ? 'removed' : 'added'}</span>{' '}
        <Avatar user={target} name={target.username} size={14}/>{' '}
        <b style={{ fontWeight: 500 }}>{target.name || target.username}</b>
        <span> {removing ? 'from assignees' : 'as assignee'}</span></>),
    };
  }
  if (type.includes('title') || field === 'title') {
    return {
      tone: 'muted', icon: 'edit',
      line: (<>{name}<span> renamed</span> <Quote text={a.oldvalue}/> <span className="act-arrow">→</span> <Quote text={a.newvalue}/></>),
    };
  }
  if (type.includes('description') || field === 'description') {
    return { tone: 'muted', icon: 'edit', line: <>{name}<span> updated the description</span></> };
  }
  if (field === 'moduleid' || field === 'modulename' || type.includes('module')) {
    return { tone: 'muted', icon: 'cube', line: <>{name}<span> moved this to module </span><span className="act-val">{a.newvalue || '—'}</span></> };
  }
  if (field === 'taskgroupid' || field === 'taskgroupname' || type.includes('group')) {
    return { tone: 'muted', icon: 'group', line: <>{name}<span> moved this to group </span><span className="act-val">{a.newvalue || '—'}</span></> };
  }
  if (type.includes('subtask')) {
    if (type.includes('completed') || type.includes('done'))
      return { tone: 'success', icon: 'check', line: <>{name}<span> completed subtask </span><Quote text={a.newvalue || a.description}/></> };
    if (type.includes('added') || type.includes('created'))
      return { tone: 'accent', icon: 'subtask', line: <>{name}<span> added subtask </span><Quote text={a.newvalue || a.description}/></> };
    return { tone: 'muted', icon: 'subtask', line: <>{name}<span> {a.description || 'updated a subtask'}</span></> };
  }
  if (type.includes('attach') || field.includes('attach')) {
    return { tone: 'muted', icon: 'paperclip', line: <>{name}<span> attached </span><span className="act-val">{a.newvalue || 'a file'}</span></> };
  }
  if (type.includes('watcher')) {
    const target = usersById[a.newvalue] || usersById[a.oldvalue] || null;
    const removing = type.includes('removed');
    return {
      tone: removing ? 'muted' : 'accent',
      icon: 'bell',
      line: (<>{name}<span> {removing ? 'removed' : 'added'}</span>{' '}
        {target && <><Avatar user={target} name={target.username} size={14}/>{' '}
        <b style={{ fontWeight: 500 }}>{target.name || target.username}</b></>}
        <span> {removing ? 'from watchers' : 'as watcher'}</span></>),
    };
  }
  if (type.includes('verif')) {
    return { tone: 'success', icon: 'check-all', line: <>{name}<span> verified this task</span></> };
  }
  if (type.includes('complet')) {
    return { tone: 'success', icon: 'check', line: <>{name}<span> completed this task</span></> };
  }
  if (type.includes('reopen')) {
    return { tone: 'warn', icon: 'history', line: <>{name}<span> reopened this task</span></> };
  }
  if (type.includes('created')) {
    return { tone: 'accent', icon: 'sparkle', line: <>{name}<span> created this task</span></> };
  }
  return {
    tone: 'muted', icon: 'edit',
    line: (<>{name}<span> changed </span>
      <span className="act-val">{a.fieldname || 'field'}</span>
      {a.oldvalue && <><span> from</span> <Quote text={a.oldvalue}/></>}
      {a.newvalue && <><span> to</span> <Quote text={a.newvalue}/></>}</>),
  };
}

export function ActivityFeed({ items, usersById }) {
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => (items || []).slice().sort((a, b) => new Date(b.creationdate) - new Date(a.creationdate)),
    [items],
  );

  const COLLAPSED_LIMIT = 8;
  const shown = expanded ? sorted : sorted.slice(0, COLLAPSED_LIMIT);

  const grouped = useMemo(() => {
    const out = []; let prev = null;
    for (const a of shown) {
      const k = dayKey(a.creationdate);
      if (k !== prev) { out.push({ kind: 'day', key: k }); prev = k; }
      out.push({ kind: 'item', activity: a });
    }
    return out;
  }, [shown]);

  if (sorted.length === 0) {
    return (
      <div className="act-empty">
        <Icon name="history" size={20}/>
        <div>No activity yet — system events will show up here.</div>
      </div>
    );
  }

  return (
    <>
      <ul className="activity">
        {grouped.map((g, i) => {
          if (g.kind === 'day') {
            return <li key={`d-${i}`} className="act-day" style={{ display: 'flex', gridTemplateColumns: 'none' }}>{g.key}</li>;
          }
          const a = g.activity;
          const r = renderActivity(a, usersById || {});
          return (
            <li key={a.activityid}>
              <span className={`act-glyph act-glyph--${r.tone}`}>
                <Icon name={r.icon} size={11}/>
              </span>
              <div className="act-body">
                <div className="act-line">
                  {r.line}
                  <span className="act-when" title={absTime(a.creationdate)}>{relTime(a.creationdate)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {sorted.length > COLLAPSED_LIMIT && (
        <button className="act-more" onClick={() => setExpanded(e => !e)}>
          {expanded ? 'Show recent only' : `Show ${sorted.length - COLLAPSED_LIMIT} earlier ${sorted.length - COLLAPSED_LIMIT === 1 ? 'event' : 'events'}`}
        </button>
      )}
    </>
  );
}
