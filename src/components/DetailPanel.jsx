/* Sliding detail panel.
 *
 * Two modes:
 *  - Saved mode (taskId set, no draftTask): fetches full task by ID and
 *    PATCHes every field change.
 *  - Draft mode (draftTask set): edits are kept in memory; a single POST
 *    fires when the user clicks Create.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, StatusGlyph } from './Icons.jsx';
import {
  Avatar, OrgMark, PriorityMark, DueChip,
  fmtFullDate, fmtFullDateTime, labelize, normaliseStatus, statusLabel
} from './Shared.jsx';
import { DueDatePicker } from './DueDatePicker.jsx';
import { AssigneesField } from './AssigneesField.jsx';
import { WatchersField } from './WatchersField.jsx';
import { Subtasks } from './Subtasks.jsx';
import { ActivityDiscussion } from './ActivityDiscussion.jsx';
import { TaskAttachments } from './TaskAttachments.jsx';
import { Lightbox } from './Lightbox.jsx';
import { usePref } from '../preferences.js';
import { classify, downloadAttachment } from '../attachments.js';

function genUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
import {
  ACT, NOTIF, logActivity, notifyUsers, notifyTaskAudience,
  addManagersAsWatchers,
} from '../notify.js';
import { qk } from '../queryKeys.js';
import { useActivity, useAttachments, useVerifications } from '../hooks/queries.js';

const EMPTY_ATTS = [];

export function DetailPanel({
  taskId, draftTask, creating,
  onClose, onNavigate, onDiscardDraft, onCommitDraft,
  allTasks, lookups, usersById, currentUser, api, onAfterPatch, onAfterDelete,
  panelMode = 'side', onPanelMode, focusMessageId,
}) {
  const isDraft = !!draftTask;
  const [task, setTask]     = useState(null);
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [openPicker, setOpenPicker] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  /* ---- attachments (query cache + in-flight upload overlay) ---- */
  const queryClient = useQueryClient();
  const [lightbox, setLightbox] = useState(null);          // { index } | null
  const [attView, setAttView] = usePref('attachmentsView', 'grid');
  const [jumpRequest, setJumpRequest] = useState(null);    // { messageid, nonce }
  const [pendingUploads, setPendingUploads] = useState([]); // uploading/failed optimistic rows
  const resolver = api.fetchAttachmentBlobUrl;

  const attachmentsQ = useAttachments(taskId, {
    enabled: !isDraft && taskId != null,
    paused: pendingUploads.length > 0,
  });
  const serverAtts = attachmentsQ.data || EMPTY_ATTS;

  /* Merge server rows with in-flight uploads (deduped by attachmentid — the
   * client-generated UUID is reused as the persisted id, so a row that lands
   * in the polled cache supersedes its pending entry). */
  const attachments = useMemo(() => {
    const serverIds = new Set(serverAtts.map(a => a.attachmentid));
    return [...serverAtts, ...pendingUploads.filter(p => !serverIds.has(p.attachmentid))];
  }, [serverAtts, pendingUploads]);

  /* Reset in-flight uploads when switching tasks. */
  useEffect(() => { setPendingUploads([]); }, [taskId]);

  /* Deep-link from a notification/toast: route the requested message
   * through the same jump mechanism the attachment badges use. */
  useEffect(() => {
    if (focusMessageId != null) setJumpRequest({ messageid: focusMessageId, nonce: Date.now() });
  }, [focusMessageId, taskId]);

  /* All task images (task- AND message-sourced), oldest→newest, for the
   * lightbox to walk as one list. Failed optimistic rows are excluded. */
  const taskImages = useMemo(
    () => attachments
      .filter(a => a.status !== 'failed' && classify(a.filename, a.mimetype).isImage)
      .sort((a, b) => new Date(a.creationdate) - new Date(b.creationdate)),
    [attachments],
  );

  const openImage = (a) => {
    const idx = taskImages.findIndex(x => x.attachmentid === a.attachmentid);
    setLightbox({ index: Math.max(0, idx) });
  };

  /* Optimistic upload. One multipart POST per file; the optimistic card and
   * the persisted row share a client-generated UUID, so no temp-id swap. */
  const addFiles = async (files, messageid = null) => {
    if (!task || isDraft) return;
    const uploaderId = currentUser?.userid;
    const tid = task.taskid;
    const jobs = [...files].map((file) => {
      const id = genUuid();
      const optimistic = {
        attachmentid: id, taskid: tid, messageid: messageid ?? null,
        userid: uploaderId, username: currentUser?.username,
        filename: file.name, filesize: file.size, mimetype: file.type,
        url: file.type?.startsWith('image/') ? URL.createObjectURL(file) : null,
        creationdate: new Date().toISOString(),
        status: 'uploading', progress: 0, _file: file,
      };
      return { id, file, optimistic };
    });
    setPendingUploads(prev => [...prev, ...jobs.map(j => j.optimistic)]);

    await Promise.all(jobs.map(async ({ id, file, optimistic }) => {
      try {
        const saved = await api.createAttachment({
          taskid: tid, messageid: messageid ?? null, uploadedbyuserid: uploaderId,
          file, attachmentid: id,
          onProgress: (p) => setPendingUploads(prev => prev.map(a => a.attachmentid === id ? { ...a, progress: p } : a)),
        });
        queryClient.setQueryData(qk.attachments(tid), (prev = []) =>
          prev.some(a => a.attachmentid === id) ? prev : [...prev, { ...saved, url: optimistic.url || saved.url }]);
        setPendingUploads(prev => prev.filter(a => a.attachmentid !== id));
      } catch {
        setPendingUploads(prev => prev.map(a => a.attachmentid === id ? { ...a, status: 'failed' } : a));
      }
    }));
  };

  const retryAtt = (a) => {
    if (!a?._file) return;
    setPendingUploads(prev => prev.filter(x => x.attachmentid !== a.attachmentid));
    addFiles([a._file], a.messageid ?? null);
  };

  const deleteAtt = async (a) => {
    // In-flight / failed rows were never persisted — drop them locally.
    if (a.status === 'uploading' || a.status === 'failed') {
      setPendingUploads(prev => prev.filter(x => x.attachmentid !== a.attachmentid));
      return;
    }
    const key = qk.attachments(task.taskid);
    const snapshot = queryClient.getQueryData(key);
    queryClient.setQueryData(key, (list = []) => list.filter(x => x.attachmentid !== a.attachmentid));
    try {
      await api.deleteAttachment(a.attachmentid);
    } catch (err) {
      if (snapshot) queryClient.setQueryData(key, snapshot);
      alert('Could not delete attachment: ' + prettyErr(err));
    }
  };

  const onDownload = (a) => downloadAttachment(a, resolver);
  const onCopyLink = (a) => {
    const href = api.attachmentHref(a);
    if (href && navigator.clipboard) navigator.clipboard.writeText(href).catch(() => {});
  };

  /* In draft mode, mirror the parent's draftTask into local `task`. */
  useEffect(() => {
    if (!isDraft) return;
    setTask(draftTask);
    setTitleDraft(draftTask?.title || '');
    setEditingTitle(false);
    setError(null);
    setLoad(false);
  }, [isDraft, draftTask]);

  /* In saved mode, fetch the full task whenever the ID changes. The query
   * cache seeds the panel instantly on reopen; a background fetch then
   * refreshes both local state and the cache. */
  useEffect(() => {
    if (isDraft) return;
    if (!taskId) { setTask(null); return; }
    let cancelled = false;
    const cached = queryClient.getQueryData(qk.task(taskId));
    if (cached) { setTask(cached); setTitleDraft(cached.title || ''); setEditingTitle(false); }
    setLoad(!cached); setError(null);
    api.getTask(taskId)
      .then(t => {
        queryClient.setQueryData(qk.task(taskId), t);
        if (!cancelled) { setTask(t); setTitleDraft(t.title || ''); setEditingTitle(false); }
      })
      .catch(err => { if (!cancelled && !cached) setError(prettyErr(err)); })
      .finally(() => { if (!cancelled) setLoad(false); });
    return () => { cancelled = true; };
  }, [taskId, api, isDraft, queryClient]);

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
  const usersByUsername = useMemo(() => {
    const o = {};
    (lookups?.users || []).forEach(u => { if (u?.username) o[u.username] = u; });
    return o;
  }, [lookups?.users]);

  /* Activity rows for this task — drive the completion / verification
   * banner. Polled (10s, visibility-gated) so other users' completions
   * and verifications appear live; invalidated after local writes. */
  const activityQ = useActivity(taskId, { enabled: !isDraft && taskId != null });
  const events = activityQ.data || EMPTY_ATTS;
  const bumpEvents = () => queryClient.invalidateQueries({ queryKey: qk.activity(taskId) });

  /* Completion comes straight off the task row (tasks.completedbyuserid /
   * completeddate); verifications from the taskverifications table. Both
   * fall back to the legacy activity-derived values for rows that predate
   * the schema migration (or while the tasksfresh view lacks the columns). */
  const verificationsQ = useVerifications(taskId, { enabled: !isDraft && taskId != null });

  const completion = useMemo(() => {
    if (task?.completeddate) {
      return { userid: task.completedbyuserid, creationdate: task.completeddate };
    }
    return events.find(e => e.activitytype === ACT.Completed) || null;
  }, [task?.completeddate, task?.completedbyuserid, events]);

  const verifications = useMemo(() => {
    if (verificationsQ.data && !verificationsQ.isError) {
      return verificationsQ.data.map(r => ({ userid: r.userid, creationdate: r.verifieddate }));
    }
    // Legacy fallback: distinct 'Verified' activity rows since the last completion.
    const out = [];
    const seen = new Set();
    for (const e of events) {
      if (e.activitytype === ACT.Completed) break;
      if (e.activitytype === ACT.Verified && e.userid != null && !seen.has(e.userid)) {
        seen.add(e.userid);
        out.push(e);
      }
    }
    return out;
  }, [verificationsQ.data, verificationsQ.isError, events]);

  /* Field-change helper. In draft mode it just updates local state. In
   * saved mode it does an optimistic PATCH against the backend.
   * Returns true when the change stuck (drives activity side-effects). */
  const patch = async (key, value) => patchMany({ [key]: value });

  /* Multi-key variant — used when one user action needs to update two
   * fields atomically (e.g. changing the product also clears the
   * module so we never end up with a mismatched pair on the wire). */
  const patchMany = async (changes) => {
    if (!task) return false;
    if (isDraft) {
      setTask(t => ({ ...t, ...changes }));
      return true;
    }
    const before = task;
    const optimistic = { ...task, ...changes };
    setTask(optimistic);
    try {
      const saved = await api.patchTask(before, changes);
      setTask(p => ({ ...p, ...saved }));
      onAfterPatch?.({ ...before, ...changes, ...saved });
      return true;
    } catch (err) {
      setTask(before);
      alert('Could not save: ' + prettyErr(err));
      return false;
    }
  };

  const meId = currentUser?.userid;
  const meName = currentUser?.name || currentUser?.username || 'Someone';

  /* Status changes carry workflow side-effects: activity rows for the
   * audit trail, completion stamping, and notification fan-out. */
  const changeStatus = async (v) => {
    if (!task) return;
    const prevRaw = task.status;
    const prevNorm = normaliseStatus(prevRaw);
    if (v === prevNorm) return;
    const wasComplete = prevNorm === 'done' || prevNorm === 'verified';
    // Completion stamps live on the task row itself — write them in the
    // same PATCH as the status so the two can never disagree.
    const changes =
      v === 'done'   ? { status: v, completedbyuserid: meId, completeddate: new Date().toISOString() }
      : wasComplete  ? { status: v, completedbyuserid: null, completeddate: null }
      : { status: v };
    const ok = await patchMany(changes);
    if (!ok || isDraft) return;
    logActivity({
      taskid: task.taskid, userid: meId, activitytype: ACT.StatusChanged,
      fieldname: 'status', oldvalue: prevRaw, newvalue: v,
    });
    if (v === 'done') {
      await logActivity({
        taskid: task.taskid, userid: meId, activitytype: ACT.Completed,
        description: `Completed by ${meName}`,
      });
      notifyTaskAudience(task, {
        actorId: meId, notificationtype: NOTIF.TaskCompleted,
        title: `Task completed: ${task.title}`,
        body: `Completed by ${meName} — awaiting verification`,
      });
    } else if (wasComplete) {
      // Reopening starts a fresh verification cycle.
      api.clearVerifications(task.taskid)
        .then(() => queryClient.invalidateQueries({ queryKey: qk.verifications(task.taskid) }))
        .catch(() => {});
      await logActivity({
        taskid: task.taskid, userid: meId, activitytype: ACT.Reopened,
        description: `Reopened by ${meName}`,
      });
    }
    bumpEvents();
  };

  /* Verification — multiple people can verify a completed task; each
   * gets a 'Verified' activity row, and the first one moves the task's
   * status from done → verified. */
  const verifyTask = async () => {
    if (!task || meId == null) return;
    if (verifications.some(e => e.userid === meId)) return;
    try {
      await api.addVerification({ taskid: task.taskid, userid: meId });
    } catch (err) {
      alert('Could not verify: ' + prettyErr(err));
      return;
    }
    queryClient.invalidateQueries({ queryKey: qk.verifications(task.taskid) });
    logActivity({
      taskid: task.taskid, userid: meId, activitytype: ACT.Verified,
      description: `Verified by ${meName}`,
    });
    if (normaliseStatus(task.status) !== 'verified') await patch('status', 'verified');
    notifyTaskAudience(task, {
      actorId: meId, notificationtype: NOTIF.TaskVerified,
      title: `Task verified: ${task.title}`,
      body: `Verified by ${meName}`,
    });
    bumpEvents();
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
    const fromPerms = Array.from(map.values());
    if (fromPerms.length) {
      return fromPerms.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
    }
    // Fallback to the global modules for this product when the per-user
    // permission list is empty/unavailable.
    return (lookups?.modules || [])
      .filter(m => (m.productid ?? m.productId) === task.productid)
      .map(m => ({ value: m.moduleid ?? m.id, label: m.name ?? m.modulename }))
      .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  }, [lookups?.userProductsModules, lookups?.modules, task?.productid]);

  /* "Can the user create any task at all?" — used to gate the Create
   * button in draft mode with a tooltip explaining why it's disabled. */
  const canCreate = useMemo(
    () => (lookups?.userProductsModules || []).some(r => r.canwrite)
      || (lookups?.accessibleProducts?.length || 0) > 0,
    [lookups?.userProductsModules, lookups?.accessibleProducts],
  );

  if (!taskId && !isDraft) return null;

  const org   = task ? orgsById[task.organisationid] : null;
  const prod  = task ? productsById[task.productid]   : null;
  const mod   = task ? modulesById[task.moduleid]     : null;
  const group = task ? taskgroupsById[task.taskgroupid] : null;
  const status = task ? normaliseStatus(task.status) : null;
  // The single "Assignee" field is the task's denormalized assignee
  // (`usersusername`) — display and edit must read/write the SAME field.
  const assignee = task?.usersusername
    ? (usersByUsername[task.usersusername] || { username: task.usersusername })
    : null;

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

                {!isDraft && (status === 'done' || status === 'verified') && (
                  <div className={`complete-banner ${status === 'verified' ? 'is-verified' : ''}`}>
                    <StatusGlyph status={status} size={18}/>
                    <div className="complete-info">
                      <div className="complete-line">
                        {completion
                          ? <>Completed by <b>{usersById?.[completion.userid]?.name || usersById?.[completion.userid]?.username || `user ${completion.userid}`}</b> · {fmtFullDateTime(completion.creationdate)}</>
                          : 'Completed'}
                      </div>
                      <div className="complete-verifs">
                        {verifications.length === 0
                          ? 'Awaiting verification'
                          : <>Verified by <b>{verifications.map(v => usersById?.[v.userid]?.name || usersById?.[v.userid]?.username || `user ${v.userid}`).join(', ')}</b> ({verifications.length})</>}
                      </div>
                    </div>
                    {meId != null && !verifications.some(v => v.userid === meId) && (
                      <button className="btn-primary complete-verify-btn" onClick={verifyTask} title="Confirm this task is done correctly">
                        <Icon name="check-all" size={13}/>
                        <span>Verify</span>
                      </button>
                    )}
                  </div>
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
                  <TaskAttachments
                    atts={attachments}
                    currentUser={currentUser}
                    usersById={usersById}
                    view={attView}
                    setView={setAttView}
                    onAdd={(files) => addFiles(files, null)}
                    onDelete={deleteAtt}
                    onRetry={retryAtt}
                    onOpenImage={openImage}
                    onJumpMessage={(mid) => setJumpRequest({ messageid: mid, nonce: Date.now() })}
                    onDownload={onDownload}
                    onCopyLink={onCopyLink}
                    resolver={resolver}
                  />
                )}

                {!isDraft && (
                  <ActivityDiscussion
                    task={task}
                    currentUser={currentUser}
                    usersById={usersById}
                    lookups={lookups}
                    api={api}
                    attachments={attachments}
                    onOpenImage={openImage}
                    resolver={resolver}
                    onAttachFiles={addFiles}
                    jumpRequest={jumpRequest}
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
                  onPick={(v) => { changeStatus(v); setOpenPicker(null); }}
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
                  onPick={async (v) => {
                    setOpenPicker(null);
                    const old = task.priority;
                    const ok = await patch('priority', v);
                    if (ok && !isDraft && v !== old) {
                      logActivity({ taskid: task.taskid, userid: meId, activitytype: ACT.PriorityChanged, fieldname: 'priority', oldvalue: old, newvalue: v });
                      bumpEvents();
                    }
                  }}
                  render={(opt) => <><PriorityMark priority={opt.value}/><span>{opt.label}</span></>}
                />
              </SideField>

              <SideField label="Assignee">
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
                    patch('usersusername', v || null);
                  }}
                  render={(opt) => <><Avatar name={opt.value || '·'} size={16}/><span>{opt.label}</span></>}
                />
              </SideField>

              <SideField label="Due date">
                <DueDatePicker
                  value={task.duedate}
                  onChange={async (iso) => {
                    const old = task.duedate;
                    const ok = await patch('duedate', iso);
                    if (ok && !isDraft && iso !== old) {
                      logActivity({ taskid: task.taskid, userid: meId, activitytype: ACT.DueDateChanged, fieldname: 'duedate', oldvalue: old, newvalue: iso });
                      bumpEvents();
                    }
                  }}
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
                  onAssigned={(userid) => {
                    const uname = usersById?.[userid]?.username || `user ${userid}`;
                    logActivity({ taskid: task.taskid, userid: meId, activitytype: ACT.AssigneeAdded, newvalue: String(userid), description: `${uname} assigned by ${meName}` });
                    notifyUsers([userid], {
                      actorId: meId, notificationtype: NOTIF.TaskAssigned,
                      title: `You were assigned: ${task.title}`,
                      body: `Assigned by ${meName}`,
                      taskid: task.taskid,
                    });
                    // Managers of both the assigner and the assignee watch the task.
                    addManagersAsWatchers(task.taskid, [userid, meId]);
                    bumpEvents();
                  }}
                  onUnassigned={(userid) => {
                    const uname = usersById?.[userid]?.username || `user ${userid}`;
                    logActivity({ taskid: task.taskid, userid: meId, activitytype: ACT.AssigneeRemoved, oldvalue: String(userid), description: `${uname} unassigned by ${meName}` });
                    bumpEvents();
                  }}
                />
              </SideField>

              <SideField label="Watchers">
                <WatchersField
                  taskId={isDraft ? null : task.taskid}
                  users={lookups?.users || []}
                  usersById={usersById}
                  api={api}
                  disabled={isDraft}
                  onWatcherAdded={(userid) => {
                    const uname = usersById?.[userid]?.username || `user ${userid}`;
                    logActivity({ taskid: task.taskid, userid: meId, activitytype: ACT.WatcherAdded, newvalue: String(userid), description: `${uname} added as watcher by ${meName}` });
                    notifyUsers([userid], {
                      actorId: meId, notificationtype: NOTIF.WatcherAdded,
                      title: `You're watching: ${task.title}`,
                      body: `Added by ${meName}`,
                      taskid: task.taskid,
                    });
                    bumpEvents();
                  }}
                  onWatcherRemoved={(userid) => {
                    const uname = usersById?.[userid]?.username || `user ${userid}`;
                    logActivity({ taskid: task.taskid, userid: meId, activitytype: ACT.WatcherRemoved, oldvalue: String(userid), description: `${uname} removed from watchers by ${meName}` });
                    bumpEvents();
                  }}
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

      {lightbox && taskImages.length > 0 && (
        <Lightbox
          images={taskImages}
          index={Math.min(lightbox.index, taskImages.length - 1)}
          onClose={() => setLightbox(null)}
          onIndex={(i) => setLightbox({ index: i })}
          resolver={resolver}
          usersById={usersById}
        />
      )}
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
