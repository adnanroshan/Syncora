/* Syncora — notification fan-out + activity logging.
 *
 * The backend has no triggers for notifications or taskactivity, so the
 * SPA is responsible for both (confirmed against the DB schema):
 *
 *   - notifications: one row per recipient per event
 *   - taskactivity:  one row per mutation
 *   - taskwatchers:  managers of assigners/assignees are auto-added
 *     (the DB trigger on taskassignees adds the assignee's SUBORDINATES,
 *     not their manager — see fn_taskassignees_add_watchers — so the
 *     manager side is handled here, client-side)
 *
 * Every helper is best-effort: a failed side-effect must never block or
 * roll back the primary mutation, so errors are swallowed.
 */

import * as api from './api.js';

/* ------------------------------------------------------------ *
 * Audience: creator + assignees + watchers of a task             *
 * ------------------------------------------------------------ */
export async function getTaskAudience(task) {
  const ids = new Set();
  if (task?.createdbyuserid != null) ids.add(task.createdbyuserid);
  const [assignees, watchers] = await Promise.all([
    api.listAssignees(task?.taskid).catch(() => []),
    api.listWatchers(task?.taskid).catch(() => []),
  ]);
  assignees.forEach(a => a?.assigneduserid != null && ids.add(a.assigneduserid));
  watchers.forEach(w => w?.userid != null && ids.add(w.userid));
  return ids;
}

/* ------------------------------------------------------------ *
 * Fan-out: one notification row per recipient, excluding actor   *
 * ------------------------------------------------------------ */
export async function notifyUsers(userids, { actorId = null, notificationtype, title, body = null, taskid = null, messageid = null }) {
  const targets = Array.from(new Set(userids)).filter(id => id != null && id !== actorId);
  await Promise.all(targets.map(userid =>
    api.createNotification({ userid, notificationtype, title, body, taskid, messageid }).catch(() => {})
  ));
  return targets.length;
}

/** Convenience: resolve the audience of a task and notify them. */
export async function notifyTaskAudience(task, event) {
  try {
    const audience = await getTaskAudience(task);
    return await notifyUsers(audience, { ...event, taskid: task?.taskid ?? event.taskid });
  } catch { return 0; }
}

/* ------------------------------------------------------------ *
 * Managers as watchers                                           *
 * ------------------------------------------------------------ */
/** Add the manager(s) of the given users as watchers on a task.
 *  Used when a task is created (creator's manager) and when someone is
 *  assigned (assigner's + assignee's managers). Returns the manager ids. */
export async function addManagersAsWatchers(taskid, userids) {
  try {
    const rows = await api.listManagersOf(userids);
    const managers = Array.from(new Set(rows.map(r => r.managerid).filter(id => id != null)));
    await Promise.all(managers.map(userid =>
      api.addWatcher({ taskid, userid }).catch(() => {})
    ));
    return managers;
  } catch { return []; }
}

/* ------------------------------------------------------------ *
 * Activity log                                                   *
 * ------------------------------------------------------------ */
export async function logActivity(entry) {
  try { return await api.createActivity(entry); }
  catch { return null; }
}

/* Activity types written by the SPA (taskactivity.activitytype): */
export const ACT = Object.freeze({
  Created:        'Created',
  StatusChanged:  'Status Changed',
  Completed:      'Completed',
  Verified:       'Verified',
  Reopened:       'Reopened',
  AssigneeAdded:  'Assignee Added',
  AssigneeRemoved:'Assignee Removed',
  WatcherAdded:   'Watcher Added',
  WatcherRemoved: 'Watcher Removed',
  DueDateChanged: 'Due Date Changed',
  PriorityChanged:'Priority Changed',
});

/* Notification types written by the SPA (notifications.notificationtype): */
export const NOTIF = Object.freeze({
  TaskCreated:   'Task Created',
  TaskAssigned:  'Task Assigned',
  WatcherAdded:  'Watcher Added',
  TaskCompleted: 'Task Completed',
  TaskVerified:  'Task Verified',
  Message:       'Message',
  Mention:       'Mention',
});

export function snippet(text, max = 140) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
