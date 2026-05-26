/* Subtasks block — stored as a JSON array on the task itself.
 *
 * Each subtask: { id: string, title: string, done: boolean, assigneeId: number | null }
 *
 * Per-subtask assignees are constrained to the parent task's assignees:
 * we fetch them here via api.listAssignees(taskId) so we don't have to
 * lift state out of AssigneesField.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Icon } from './Icons.jsx';
import { Avatar } from './Shared.jsx';

export function Subtasks({ value, onChange, disabled, taskId, api, usersById = {} }) {
  const list  = Array.isArray(value) ? value : [];
  const done  = list.filter(s => s.done).length;
  const total = list.length;
  const pct   = total ? (done / total) * 100 : 0;

  /* Parent-task assignees — the *only* candidates for subtask assignment. */
  const [parentAssignees, setParentAssignees] = useState([]);
  useEffect(() => {
    if (disabled || taskId == null || !api) { setParentAssignees([]); return; }
    let cancelled = false;
    api.listAssignees(taskId)
      .then(rows => { if (!cancelled) setParentAssignees(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setParentAssignees([]); });
    return () => { cancelled = true; };
  }, [api, taskId, disabled]);

  const candidates = useMemo(() => {
    return parentAssignees
      .map(a => usersById[a.assigneduserid] || {
        userid:   a.assigneduserid,
        username: a.assignedusername,
        name:     a.assignedusername,
      });
  }, [parentAssignees, usersById]);

  const [adding,    setAdding]    = useState(false);
  const [newTitle,  setNewTitle]  = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const newInputRef = useRef(null);

  const update = (next) => onChange(next);
  const toggle = (id)        => update(list.map(s => s.id === id ? { ...s, done: !s.done } : s));
  const remove = (id)        => update(list.filter(s => s.id !== id));
  const rename = (id, t)     => update(list.map(s => s.id === id ? { ...s, title: t } : s));
  const assign = (id, uid)   => update(list.map(s => s.id === id ? { ...s, assigneeId: uid } : s));

  const newId = () =>
    (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const add = (title) => {
    const t = (title || '').trim();
    if (!t) return false;
    update([...list, { id: newId(), title: t, done: false, assigneeId: null }]);
    return true;
  };

  const startEdit  = (s) => { setEditingId(s.id); setEditDraft(s.title); };
  const commitEdit = (s) => {
    const t = editDraft.trim();
    if (t && t !== s.title) rename(s.id, t);
    setEditingId(null);
  };

  if (disabled && total === 0) {
    return (
      <section className="detail-section">
        <div className="detail-section-head"><span>Subtasks</span></div>
        <p className="empty-text" style={{ fontSize: 12.5, margin: 0 }}>
          Create the task first, then add subtasks.
        </p>
      </section>
    );
  }

  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <span>Subtasks</span>
        {total > 0 && (
          <div className="subt-progress">
            <span className="ds-count">{done}/{total}</span>
            <div className="subt-bar"><div className="subt-bar-fill" style={{ width: `${pct}%` }}/></div>
          </div>
        )}
      </div>

      <ul className="subtasks">
        {list.map(s => (
          <li key={s.id} className={s.done ? 'is-done' : ''}>
            <button
              className="subtask-check"
              onClick={() => toggle(s.id)}
              aria-label={s.done ? 'Mark incomplete' : 'Mark complete'}
              title={s.done ? 'Mark incomplete' : 'Mark complete'}
            >
              {s.done && <Icon name="check" size={10}/>}
            </button>

            {editingId === s.id ? (
              <input
                className="subtask-input"
                autoFocus
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onBlur={() => commitEdit(s)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')  { e.preventDefault(); e.target.blur(); }
                  if (e.key === 'Escape') { setEditDraft(s.title); setEditingId(null); }
                }}
              />
            ) : (
              <span
                className="subtask-title"
                onClick={() => startEdit(s)}
                title="Click to edit"
              >
                {s.title}
              </span>
            )}

            <SubtaskAssigneePicker
              value={s.assigneeId}
              candidates={candidates}
              usersById={usersById}
              onPick={(uid) => assign(s.id, uid)}
            />

            <button
              className="subtask-del"
              onClick={() => remove(s.id)}
              aria-label="Delete subtask"
              title="Delete subtask"
            >
              <Icon name="close" size={12}/>
            </button>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="subtask-addrow">
          <span className="subtask-check" aria-hidden="true"/>
          <input
            ref={newInputRef}
            className="subtask-input"
            autoFocus
            placeholder="Subtask title…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onBlur={() => {
              setTimeout(() => {
                if (newTitle.trim()) add(newTitle);
                setNewTitle('');
                setAdding(false);
              }, 0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (add(newTitle)) {
                  setNewTitle('');
                  requestAnimationFrame(() => newInputRef.current?.focus());
                }
              }
              if (e.key === 'Escape') {
                setNewTitle('');
                setAdding(false);
              }
            }}
          />
          <span className="subtask-hint">↵ add · esc close</span>
        </div>
      ) : (
        <button className="subtask-addbtn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={12}/>
          <span>Add subtask</span>
        </button>
      )}
    </section>
  );
}

/* ----------------------- Assignee picker ----------------------- *
 * Scoped strictly to the parent task's assignees. Always includes
 * the currently-set assignee even if they've since been removed
 * from the parent (marked "orphan") so the user can reassign or
 * clear without confusion.
 * --------------------------------------------------------------- */
function SubtaskAssigneePicker({ value, candidates, usersById, onPick }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = value != null ? (usersById[value] || null) : null;
  const orphan  = current && !candidates.some(u => u.userid === current.userid);

  return (
    <div className="subt-assg" ref={rootRef}>
      <button
        type="button"
        className={`subt-assg-trigger ${current ? '' : 'is-empty'}`}
        onClick={() => setOpen(o => !o)}
        title={current
          ? `Assigned: ${current.name || current.username}`
          : 'Assign someone from the task’s assignees'}
      >
        {current ? (
          <Avatar user={current} size={18}/>
        ) : (
          <span className="subt-assg-empty-avatar" aria-hidden="true">
            <Icon name="plus" size={11}/>
          </span>
        )}
      </button>
      {open && (
        <div className="subt-assg-pop" role="menu">
          <button
            type="button"
            className={`subt-assg-popitem ${value == null ? 'is-current' : ''}`}
            onClick={() => { onPick(null); setOpen(false); }}
          >
            <span className="subt-assg-empty-avatar"><Icon name="plus" size={11}/></span>
            <span>Unassigned</span>
          </button>
          {orphan && (
            <button
              type="button"
              className="subt-assg-popitem is-current"
              onClick={() => setOpen(false)}
              title="This user is no longer an assignee on the parent task."
            >
              <Avatar user={current} size={18}/>
              <span>{current.name || current.username}</span>
              <span className="subt-assg-popitem-meta">orphan</span>
            </button>
          )}
          {candidates.length === 0 && !orphan && (
            <div className="subt-assg-empty">
              Add assignees to the task first, then pick from them here.
            </div>
          )}
          {candidates.map(u => (
            <button
              key={u.userid}
              type="button"
              className={`subt-assg-popitem ${value === u.userid ? 'is-current' : ''}`}
              onClick={() => { onPick(u.userid); setOpen(false); }}
            >
              <Avatar user={u} size={18}/>
              <span>{u.name || u.username}</span>
              {u.username && <span className="subt-assg-popitem-meta">@{u.username}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
