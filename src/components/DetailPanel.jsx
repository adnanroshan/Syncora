/* Sliding detail panel.
 *
 * Two modes:
 *  - Saved mode (taskId set, no draftTask): fetches full task by ID and
 *    PATCHes every field change.
 *  - Draft mode (draftTask set): edits are kept in memory; a single POST
 *    fires when the user clicks Create.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Icon, StatusGlyph } from './Icons.jsx';
import {
  Avatar, OrgMark, PriorityMark, DueChip,
  fmtFullDate, fmtFullDateTime, labelize, normaliseStatus, statusLabel
} from './Shared.jsx';
import { DueDatePicker } from './DueDatePicker.jsx';
import { AssigneesField } from './AssigneesField.jsx';
import { Subtasks } from './Subtasks.jsx';
import { ActivityDiscussion } from './ActivityDiscussion.jsx';

export function DetailPanel({
  taskId, draftTask, creating,
  onClose, onNavigate, onDiscardDraft, onCommitDraft,
  allTasks, lookups, usersById, currentUser, api, onAfterPatch, onAfterDelete,
  panelMode = 'side', onPanelMode,
}) {
  const isDraft = !!draftTask;
  const [task, setTask]     = useState(null);
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [openPicker, setOpenPicker] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  /* In draft mode, mirror the parent's draftTask into local `task`. */
  useEffect(() => {
    if (!isDraft) return;
    setTask(draftTask);
    setTitleDraft(draftTask?.title || '');
    setEditingTitle(false);
    setError(null);
    setLoad(false);
  }, [isDraft, draftTask]);

  /* In saved mode, fetch the full task whenever the ID changes. */
  useEffect(() => {
    if (isDraft) return;
    if (!taskId) { setTask(null); return; }
    let cancelled = false;
    setLoad(true); setError(null);
    api.getTask(taskId)
      .then(t => { if (!cancelled) { setTask(t); setTitleDraft(t.title || ''); setEditingTitle(false); } })
      .catch(err => { if (!cancelled) setError(prettyErr(err)); })
      .finally(() => { if (!cancelled) setLoad(false); });
    return () => { cancelled = true; };
  }, [taskId, api, isDraft]);

  /* Close the More menu on outside click / Escape. */
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e) => {
      if (!e.target.closest('.detail-menu-wrap')) setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const siblings = allTasks || [];
  const idx  = task && !isDraft ? siblings.findIndex(t => t.taskid === task.taskid) : -1;
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const orgsById       = useMemo(() => indexBy(lookups?.orgs,       o => o.id ?? o.organisationid), [lookups]);
  const productsById   = useMemo(() => indexBy(lookups?.products,   p => p.id ?? p.productid),      [lookups]);
  const modulesById    = useMemo(() => indexBy(lookups?.modules,    m => m.id ?? m.moduleid),       [lookups]);
  const taskgroupsById = useMemo(() => indexBy(lookups?.taskgroups, g => g.id ?? g.taskgroupid),    [lookups]);

  /* Field-change helper. In draft mode it just updates local state. In
   * saved mode it does an optimistic PATCH against the backend. */
  const patch = async (key, value) => patchMany({ [key]: value });

  /* Multi-key variant — used when one user action needs to update two
   * fields atomically (e.g. changing the product also clears the
   * module so we never end up with a mismatched pair on the wire). */
  const patchMany = async (changes) => {
    if (!task) return;
    if (isDraft) {
      setTask(t => ({ ...t, ...changes }));
      return;
    }
    const before = task;
    const optimistic = { ...task, ...changes };
    setTask(optimistic);
    try {
      const saved = await api.patchTask(before, changes);
      setTask(p => ({ ...p, ...saved }));
      onAfterPatch?.({ ...before, ...changes, ...saved });
    } catch (err) {
      setTask(before);
      alert('Could not save: ' + prettyErr(err));
    }
  };

  const removeAssignee = async () => {
    if (!task) return;
    const assigneduserid = task.assignee?.id ?? task.assignee?.usersid ?? task.assigneduserid;
    if (!assigneduserid) return;
    const previous = task;
    setTask({ ...task, assignee: null, usersusername: null });
    try {
      const saved = await api.removeAssignee(task.taskid, assigneduserid);
      setTask(prev => ({ ...prev, ...saved, assignee: null, usersusername: null }));
      onAfterPatch?.({ ...previous, ...saved, assignee: null, usersusername: null });
    } catch (err) {
      setTask(previous);
      alert('Could not remove assignee: ' + prettyErr(err));
    }
  };

  const onSaveTitle = () => {
    setEditingTitle(false);
    if (titleDraft !== task?.title) patch('title', titleDraft);
  };

  const onDelete = async () => {
    if (!task || isDraft) return;
    if (!confirm('Delete this task? This cannot be undone.')) return;
    try {
      await api.deleteTask(task);
      onAfterDelete?.(task);
      onClose();
    } catch (err) {
      alert('Could not delete: ' + prettyErr(err));
    }
  };

  const onCreateClick = async () => {
    if (!isDraft || !task) return;
    if (!task.title || !task.title.trim()) {
      alert('Please enter a title.');
      return;
    }
    await onCommitDraft({ ...task, title: task.title.trim() });
  };

  const handleClose = () => {
    if (isDraft) onDiscardDraft();
    else         onClose();
  };

  /* Modules the user can write against, scoped to the currently-selected
   * product. Deduped by moduleid because the userproductsmodules table
   * could in theory have repeats. */
  const availableModules = useMemo(() => {
    if (!task?.productid) return [];
    const map = new Map();
    (lookups?.userProductsModules || []).forEach(r => {
      if (r.productid !== task.productid) return;
      if (!r.canwrite) return;
      if (r.moduleid == null) return;
      if (map.has(r.moduleid)) return;
      map.set(r.moduleid, { value: r.moduleid, label: r.modulename });
    });
    return Array.from(map.values()).sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  }, [lookups?.userProductsModules, task?.productid]);

  /* "Can the user create any task at all?" — used to gate the Create
   * button in draft mode with a tooltip explaining why it's disabled. */
  const canCreate = useMemo(
    () => (lookups?.userProductsModules || []).some(r => r.canwrite),
    [lookups?.userProductsModules],
  );

  if (!taskId && !isDraft) return null;

  const org   = task ? orgsById[task.organisationid] : null;
  const prod  = task ? productsById[task.productid]   : null;
  const mod   = task ? modulesById[task.moduleid]     : null;
  const group = task ? taskgroupsById[task.taskgroupid] : null;
  const status = task ? normaliseStatus(task.status) : null;
  const assignee = task ? (usersById?.[task.createdbyuserid] || null) : null;

  return (
    <>
      <div className="detail-scrim" onClick={handleClose}/>
      <aside
        className={`detail ${panelMode === 'center' ? 'detail--center' : ''}`}
        role="dialog"
        aria-label={task?.title || (isDraft ? 'New task' : 'Task')}
      >
        <header className="detail-head">
          <div className="detail-head-left">
            <button
              className="iconbtn"
              onClick={handleClose}
              aria-label="Close panel"
              title="Close panel"
            >
              <Icon name="close" size={16}/>
            </button>
            <span className="detail-id">{isDraft ? 'New' : `#${taskId}`}</span>
            <span className="detail-crumb">
              {task?.organisationname || '—'} <Icon name="chevron-r" size={11}/> {task?.productname || '—'}
            </span>
          </div>
          <div className="detail-head-right">
            {isDraft ? (
              <>
                <PanelModeToggle mode={panelMode} onChange={onPanelMode}/>
                <span className="detail-divider"/>
                <button
                  className="btn-primary"
                  onClick={onCreateClick}
                  disabled={creating || !task?.title?.trim() || !canCreate}
                  title={!canCreate ? "You don't have permission to create tasks" : 'Create task'}
                >
                  <Icon name="plus" size={13}/>
                  <span>{creating ? 'Creating…' : 'Create'}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  className="iconbtn"
                  onClick={() => prev && onNavigate(prev.taskid)}
                  disabled={!prev}
                  aria-label="Previous task"
                  title="Previous task"
                >
                  <Icon name="chevron-l" size={15}/>
                </button>
                <button
                  className="iconbtn"
                  onClick={() => next && onNavigate(next.taskid)}
                  disabled={!next}
                  aria-label="Next task"
                  title="Next task"
                >
                  <Icon name="chevron-r" size={15}/>
                </button>
                <span className="detail-divider"/>
                <PanelModeToggle mode={panelMode} onChange={onPanelMode}/>
                <span className="detail-divider"/>
                <div className="detail-menu-wrap" style={{ position: 'relative' }}>
                  <button
                    className="iconbtn"
                    onClick={() => setMenuOpen(v => !v)}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-label="More actions"
                    title="More actions"
                  >
                    <Icon name="more" size={15}/>
                  </button>
                  {menuOpen && (
                    <div className="detail-menu" role="menu">
                      <button
                        className="detail-menu-item detail-menu-item-danger"
                        role="menuitem"
                        onClick={() => { setMenuOpen(false); onDelete(); }}
                      >
                        <Icon name="trash" size={14}/>
                        <span>Delete task</span>
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </header>

        <div className="detail-body">
          <div className="detail-main">
            {loading && !task ? (
              <div className="empty">
                <div className="empty-title">Loading…</div>
              </div>
            ) : error ? (
              <div className="empty">
                <div className="empty-title">Could not load task</div>
                <div className="empty-sub">{error}</div>
              </div>
            ) : task ? (
              <>
                {editingTitle || (isDraft && !task.title) ? (
                  <textarea
                    className="detail-title-input"
                    autoFocus
                    placeholder={isDraft ? 'Task title' : ''}
                    value={titleDraft}
                    onChange={(e) => {
                      setTitleDraft(e.target.value);
                      if (isDraft) setTask(t => ({ ...t, title: e.target.value }));
                    }}
                    onBlur={() => { if (!isDraft) onSaveTitle(); else setEditingTitle(false); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); }
                      if (e.key === 'Escape') {
                        if (!isDraft) { setTitleDraft(task.title); setEditingTitle(false); }
                        else          { e.target.blur(); }
                      }
                    }}
                  />
                ) : (
                  <h1 className="detail-title" onClick={() => setEditingTitle(true)} title="Click to edit">
                    {task.title || (isDraft ? <span className="empty-text">Click to add a title</span> : '(untitled)')}
                  </h1>
                )}

                <DescriptionBlock task={task} onSave={(v) => patch('description', v)} />

                <Subtasks
                  parent={task}
                  api={api}
                  usersById={usersById}
                  onOpen={onNavigate}
                  disabled={isDraft}
                />

                {!isDraft && (
                  <ActivityDiscussion
                    task={task}
                    currentUser={currentUser}
                    usersById={usersById}
                    lookups={lookups}
                    api={api}
                  />
                )}
              </>
            ) : null}
          </div>

          {task && (
            <aside className="detail-side">
              <SideField label="Status">
                <FieldPickerButton
                  open={openPicker === 'status'}
                  onToggle={() => setOpenPicker(openPicker === 'status' ? null : 'status')}
                  current={
                    <>
                      <StatusGlyph status={status} size={13}/>
                      <span>{statusLabel(status)}</span>
                      <Icon name="chevron-d" size={11}/>
                    </>
                  }
                  options={[
                    { value: 'todo',       label: 'To do' },
                    { value: 'inprogress', label: 'In progress' },
                    { value: 'blocked',    label: 'Blocked' },
                    { value: 'done',       label: 'Done' },
                  ]}
                  onPick={(v) => { patch('status', v); setOpenPicker(null); }}
                  render={(opt) => <><StatusGlyph status={opt.value} size={12}/><span>{opt.label}</span></>}
                />
              </SideField>

              <SideField label="Priority">
                <FieldPickerButton
                  open={openPicker === 'priority'}
                  onToggle={() => setOpenPicker(openPicker === 'priority' ? null : 'priority')}
                  current={
                    <>
                      <PriorityMark priority={task.priority}/>
                      <span>{labelize(task.priority || 'none')}</span>
                      <Icon name="chevron-d" size={11}/>
                    </>
                  }
                  options={[
                    { value: 'urgent', label: 'Urgent' },
                    { value: 'high',   label: 'High' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'low',    label: 'Low' },
                  ]}
                  onPick={(v) => { patch('priority', v); setOpenPicker(null); }}
                  render={(opt) => <><PriorityMark priority={opt.value}/><span>{opt.label}</span></>}
                />
              </SideField>

              <SideField label="Assigner">
                <FieldPickerButton
                  open={openPicker === 'assignee'}
                  onToggle={() => setOpenPicker(openPicker === 'assignee' ? null : 'assignee')}
                  current={
                    <>
                      <Avatar user={assignee} size={18}/>
                      <span>{assignee?.name || assignee?.username || 'Unassigned'}</span>
                      <Icon name="chevron-d" size={11}/>
                    </>
                  }
                  options={[{ value: '', label: 'Unassigned' }, ...(lookups?.users || []).map(u => ({ value: u.username, label: u.username }))]}
                  onPick={(v) => {
                    setOpenPicker(null);
                    if (!v) removeAssignee();
                    else patch('usersusername', v);
                  }}
                  render={(opt) => <><Avatar name={opt.value || '·'} size={16}/><span>{opt.label}</span></>}
                />
              </SideField>

              <SideField label="Due date">
                <DueDatePicker
                  value={task.duedate}
                  onChange={(iso) => patch('duedate', iso)}
                />
              </SideField>

              <SideField label="Client">
                <FieldPickerButton
                  open={openPicker === 'organisationid'}
                  onToggle={() => setOpenPicker(openPicker === 'organisationid' ? null : 'organisationid')}
                  current={
                    <>
                      {org ? <OrgMark org={org} size={16}/> : <span className="prod-dot" style={{ background: 'var(--text-faint)' }}/>}
                      <span>{org?.name || task.organisationname || '—'}</span>
                      <Icon name="chevron-d" size={11}/>
                    </>
                  }
                  options={[{ value: '', label: 'No client' }, ...((lookups?.accessibleOrgs) || []).map(o => ({ value: o.id ?? o.organisationid, label: o.name }))]}
                  onPick={(v) => { patch('organisationid', v || null); setOpenPicker(null); }}
                  render={(opt) => <span>{opt.label}</span>}
                />
              </SideField>

              <SideField label="Product">
                <FieldPickerButton
                  open={openPicker === 'productid'}
                  onToggle={() => setOpenPicker(openPicker === 'productid' ? null : 'productid')}
                  current={
                    <>
                      <span className="prod-dot"/>
                      <span>{prod?.name || task.productname || '—'}</span>
                      <Icon name="chevron-d" size={11}/>
                    </>
                  }
                  options={[{ value: '', label: 'No product' }, ...((lookups?.accessibleProducts) || []).map(p => ({ value: p.id ?? p.productid, label: p.name }))]}
                  onPick={(v) => {
                    // Changing product clears module to avoid a mismatched pair.
                    patchMany({ productid: v || null, moduleid: null });
                    setOpenPicker(null);
                  }}
                  render={(opt) => <span>{opt.label}</span>}
                />
              </SideField>

              <SideField label="Module">
                <FieldPickerButton
                  open={openPicker === 'moduleid'}
                  onToggle={() => task.productid && setOpenPicker(openPicker === 'moduleid' ? null : 'moduleid')}
                  disabled={!task.productid}
                  current={
                    <>
                      <Icon name="tag" size={13}/>
                      <span>{mod?.name || task.modulename || (task.productid ? 'Pick a module' : 'Pick a product first')}</span>
                      <Icon name="chevron-d" size={11}/>
                    </>
                  }
                  options={[{ value: '', label: 'No module' }, ...availableModules]}
                  onPick={(v) => { patch('moduleid', v || null); setOpenPicker(null); }}
                  render={(opt) => <span>{opt.label}</span>}
                />
              </SideField>

              <SideField label="Group">
                <FieldPickerButton
                  open={openPicker === 'taskgroupid'}
                  onToggle={() => setOpenPicker(openPicker === 'taskgroupid' ? null : 'taskgroupid')}
                  current={
                    <>
                      <Icon name="tag" size={13}/>
                      <span>{group?.name || task.taskgroupname || '—'}</span>
                      <Icon name="chevron-d" size={11}/>
                    </>
                  }
                  options={(lookups?.taskgroups || []).map(g => ({ value: g.id ?? g.taskgroupid, label: g.name }))}
                  onPick={(v) => { patch('taskgroupid', v || null); setOpenPicker(null); }}
                  render={(opt) => <span>{opt.label}</span>}
                />
              </SideField>

              <SideField label="Assignees">
                <AssigneesField
                  taskId={isDraft ? null : task.taskid}
                  organisationid={task.organisationid}
                  productid={task.productid}
                  moduleid={task.moduleid}
                  users={lookups?.users || []}
                  usersById={usersById}
                  api={api}
                  disabled={isDraft}
                />
              </SideField>

              {!isDraft && (
                <div className="side-meta">
                  <div>Created {fmtFullDate(task.creationdate)}</div>
                  <div>Updated {fmtFullDate(task.lastmodifieddate)}</div>
                </div>
              )}
            </aside>
          )}
        </div>
      </aside>
    </>
  );
}

function DescriptionBlock({ task, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.description || '');
  useEffect(() => { setDraft(task.description || ''); setEditing(false); }, [task.taskid]);

  if (editing) {
    return (
      <div className="detail-desc">
        <textarea
          className="detail-desc-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); if (draft !== (task.description || '')) onSave(draft || null); }}
          placeholder="What needs to be done?"
        />
      </div>
    );
  }
  return (
    <div className="detail-desc" onClick={() => setEditing(true)}>
      {task.description
        ? <p>{task.description}</p>
        : <p className="empty-text">No description. Click to add one.</p>}
    </div>
  );
}

/* ---------- audit footer ---------- */
function Audit({ task, assignee }) {
  if (!assignee && !task.lastmodifieddate) return null;
  const who = assignee?.name || assignee?.username;
  return (
    <div className="audit">
      {who && (
        <div className="audit-row">
          <span className="audit-label">Assigned by</span>
          <span className="audit-value">
            {who}
            {task.creationdate ? ` · ${fmtFullDate(task.creationdate)}` : ''}
          </span>
        </div>
      )}
      {task.lastmodifieddate && (
        <div className="audit-row">
          <span className="audit-label">Last updated at</span>
          <span className="audit-value">{fmtFullDateTime(task.lastmodifieddate)}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- small layout helpers ---------- */
function SideField({ label, children }) {
  return (
    <div className="sidefield">
      <div className="sidefield-label">{label}</div>
      <div className="sidefield-value">{children}</div>
    </div>
  );
}

/* Picker button: closed shows current; open shows option list overlay */
function FieldPickerButton({ open, onToggle, current, options, onPick, render, disabled }) {
  return (
    <div style={{ position: 'relative' }}>
      <button
        className="sidefield-btn"
        onClick={onToggle}
        disabled={disabled}
        style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
      >
        {current}
      </button>
      {open && !disabled && (
        <div className="sidefield-pop">
          {options.map((opt, i) => (
            <button key={i} className="sidefield-popitem" onClick={() => onPick(opt.value)}>
              {render(opt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- panel layout toggle (side rail ⟷ centered modal) ---------- */
function PanelModeToggle({ mode, onChange }) {
  if (!onChange) return null;
  return (
    <div className="panelmode" role="group" aria-label="Panel layout">
      <button
        type="button"
        className={`iconbtn ${mode !== 'center' ? 'is-active' : ''}`}
        onClick={() => onChange('side')}
        aria-pressed={mode !== 'center'}
        title="Side panel"
      >
        <Icon name="panel-side" size={15}/>
      </button>
      <button
        type="button"
        className={`iconbtn ${mode === 'center' ? 'is-active' : ''}`}
        onClick={() => onChange('center')}
        aria-pressed={mode === 'center'}
        title="Center panel"
      >
        <Icon name="panel-center" size={15}/>
      </button>
    </div>
  );
}

/* ---------- utilities ---------- */
function indexBy(arr, fn) {
  const out = {};
  (arr || []).forEach(x => { const k = fn(x); if (k != null) out[k] = x; });
  return out;
}

function prettyErr(err) {
  if (!err) return 'Unknown error';
  if (err.errors?.[0]) return err.errors[0].message || err.errors[0].reason || 'Error';
  return err.message || String(err);
}
