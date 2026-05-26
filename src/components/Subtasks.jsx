/* Subtasks block — each subtask is a real task linked by parenttaskid.
 *
 * Toggle done   → PATCH /v2/tasks/<child>   { status: 'done'|'todo' }
 * Rename        → PATCH /v2/tasks/<child>   { title }
 * Delete        → DELETE /v2/tasks/<child>
 * Add           → POST /v2/tasks            { title, parenttaskid, …inherited scope }
 * Assignee pick → POST /v2/taskassignees    (and removeAssignee for the previous one)
 *
 * The per-row avatar picker is scoped to the parent task's assignees.
 * Each child task's own assignees are fetched in parallel on load so we
 * can highlight the currently-primary user without a second click.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Icon } from './Icons.jsx';
import { Avatar } from './Shared.jsx';

export function Subtasks({ parent, api, usersById = {}, onOpen, disabled }) {
  const parentId = parent?.taskid;

  const [items, setItems] = useState([]);
  const [assigneesByChild, setAssigneesByChild] = useState({});
  const [parentAssignees, setParentAssignees] = useState([]);
  const [loading, setLoading] = useState(false);

  const done  = items.filter(s => s.status === 'done').length;
  const total = items.length;
  const pct   = total ? (done / total) * 100 : 0;

  /* Load children + each child's assignees in parallel. */
  const refresh = useCallback(async () => {
    if (disabled || parentId == null) { setItems([]); setAssigneesByChild({}); return; }
    setLoading(true);
    try {
      const rows = await api.listSubtasks(parentId);
      setItems(rows);
      const lists = await Promise.all(rows.map(r => api.listAssignees(r.taskid).catch(() => [])));
      const map = {};
      rows.forEach((r, i) => { map[r.taskid] = lists[i] || []; });
      setAssigneesByChild(map);
    } finally {
      setLoading(false);
    }
  }, [api, parentId, disabled]);

  useEffect(() => { refresh(); }, [refresh]);

  /* Parent's assignees — the candidate pool for the per-row picker. */
  useEffect(() => {
    if (disabled || parentId == null) { setParentAssignees([]); return; }
    let cancelled = false;
    api.listAssignees(parentId)
      .then(rows => { if (!cancelled) setParentAssignees(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setParentAssignees([]); });
    return () => { cancelled = true; };
  }, [api, parentId, disabled]);

  const candidates = useMemo(
    () => parentAssignees.map(a => usersById[a.assigneduserid] || {
      userid:   a.assigneduserid,
      username: a.assignedusername,
      name:     a.assignedusername,
    }),
    [parentAssignees, usersById],
  );

  /* --- mutations (optimistic where it's safe) --- */
  const toggleDone = async (child) => {
    const next = child.status === 'done' ? 'todo' : 'done';
    setItems(prev => prev.map(c => c.taskid === child.taskid ? { ...c, status: next } : c));
    try { await api.patchTask(child, { status: next }); }
    catch (err) {
      setItems(prev => prev.map(c => c.taskid === child.taskid ? { ...c, status: child.status } : c));
      alert('Could not update subtask: ' + prettyErr(err));
    }
  };

  const renameChild = async (child, title) => {
    if (!title || title === child.title) return;
    setItems(prev => prev.map(c => c.taskid === child.taskid ? { ...c, title } : c));
    try { await api.patchTask(child, { title }); }
    catch (err) {
      setItems(prev => prev.map(c => c.taskid === child.taskid ? { ...c, title: child.title } : c));
      alert('Could not rename subtask: ' + prettyErr(err));
    }
  };

  const deleteChild = async (child) => {
    const before = items;
    setItems(prev => prev.filter(c => c.taskid !== child.taskid));
    try { await api.deleteTask(child); }
    catch (err) {
      setItems(before);
      alert('Could not delete subtask: ' + prettyErr(err));
    }
  };

  const addChild = async (title) => {
    const t = (title || '').trim();
    if (!t) return false;
    try {
      const created = await api.createTask({
        title:          t,
        parenttaskid:   parentId,
        organisationid: parent.organisationid,
        productid:      parent.productid,
        moduleid:       parent.moduleid,
        taskgroupid:    parent.taskgroupid,
        status:         'todo',
        priority:       parent.priority || 'medium',
      });
      setItems(prev => [...prev, created]);
      setAssigneesByChild(prev => ({ ...prev, [created.taskid]: [] }));
      return true;
    } catch (err) {
      alert('Could not add subtask: ' + prettyErr(err));
      return false;
    }
  };

  const reassign = async (child, userid) => {
    const current = assigneesByChild[child.taskid] || [];
    for (const a of current) {
      try { await api.removeAssignee(child.taskid, a.assigneduserid); } catch { /* ignore */ }
    }
    if (userid != null) {
      try { await api.addAssignee({ taskid: child.taskid, assigneduserid: userid, isprimary: true }); }
      catch (err) { alert('Could not assign: ' + prettyErr(err)); }
    }
    try {
      const fresh = await api.listAssignees(child.taskid);
      setAssigneesByChild(prev => ({ ...prev, [child.taskid]: fresh }));
    } catch { /* ignore */ }
  };

  /* --- inline add + rename UI state --- */
  const [adding,    setAdding]    = useState(false);
  const [newTitle,  setNewTitle]  = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const newInputRef = useRef(null);

  const startEdit  = (s) => { setEditingId(s.taskid); setEditDraft(s.title || ''); };
  const commitEdit = (s) => {
    const t = editDraft.trim();
    if (t && t !== s.title) renameChild(s, t);
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
        {items.map(s => {
          const isDone = s.status === 'done';
          const rows = assigneesByChild[s.taskid] || [];
          const primary = rows.find(r => r.isprimary) || rows[0] || null;
          return (
            <li key={s.taskid} className={isDone ? 'is-done' : ''}>
              <button
                className="subtask-check"
                onClick={() => toggleDone(s)}
                aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
                title={isDone ? 'Mark incomplete' : 'Mark complete'}
              >
                {isDone && <Icon name="check" size={10}/>}
              </button>

              {editingId === s.taskid ? (
                <input
                  className="subtask-input"
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={() => commitEdit(s)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')  { e.preventDefault(); e.target.blur(); }
                    if (e.key === 'Escape') { setEditDraft(s.title || ''); setEditingId(null); }
                  }}
                />
              ) : (
                <span
                  className="subtask-title"
                  onClick={() => startEdit(s)}
                  onDoubleClick={() => onOpen?.(s.taskid)}
                  title="Click to edit · double-click to open"
                >
                  {s.title || '(untitled)'}
                </span>
              )}

              <SubtaskAssigneePicker
                value={primary?.assigneduserid ?? null}
                candidates={candidates}
                usersById={usersById}
                onPick={(uid) => reassign(s, uid)}
              />

              <button
                className="subtask-del"
                onClick={() => deleteChild(s)}
                aria-label="Delete subtask"
                title="Delete subtask"
              >
                <Icon name="close" size={12}/>
              </button>
            </li>
          );
        })}
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
              setTimeout(async () => {
                if (newTitle.trim()) await addChild(newTitle);
                setNewTitle('');
                setAdding(false);
              }, 0);
            }}
            onKeyDown={async (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (await addChild(newTitle)) {
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
        <button className="subtask-addbtn" onClick={() => setAdding(true)} disabled={disabled}>
          <Icon name="plus" size={12}/>
          <span>Add subtask</span>
        </button>
      )}
    </section>
  );
}

/* ----------------------- Assignee picker ----------------------- */
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

function prettyErr(err) {
  if (!err) return 'Unknown error';
  if (err.errors?.[0]) return err.errors[0].message || err.errors[0].reason || 'Error';
  return err.message || String(err);
}
