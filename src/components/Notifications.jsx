/* Notifications bell — lives in the TopBar.
 *
 * Loads /v2/notifications?filter=(userid=<me>) once the logged-in user's
 * id is known, refreshes when the dropdown opens and on a 60s poll.
 * Clicking a notification marks it read (PATCH isread/readdate) and, when
 * it points at a task, opens that task's detail panel.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as api from '../api.js';
import { qk } from '../queryKeys.js';
import { useNotifications } from '../hooks/queries.js';
import { Icon } from './Icons.jsx';

export function NotificationsBell({ userid, onOpenTask, onIncoming }) {
  const [open, setOpen]   = useState(false);
  const rootRef = useRef(null);
  const queryClient = useQueryClient();
  // High-water mark for live toasts: null until the first load completes
  // so a fresh session doesn't toast the whole backlog.
  const lastSeenRef = useRef(null);

  /* One shared query app-wide: cache + 20s visibility-gated poll. */
  const notifQ = useNotifications(userid);
  const items = notifQ.data || [];

  /* Detect newly-arrived unread rows → surface as live toasts. */
  useEffect(() => {
    if (!notifQ.data) return;
    const rows = notifQ.data;
    const maxId = rows.reduce((m, r) => Math.max(m, r.notificationid || 0), 0);
    if (lastSeenRef.current == null) {
      lastSeenRef.current = maxId;
    } else if (maxId > lastSeenRef.current) {
      const fresh = rows.filter(r => r.notificationid > lastSeenRef.current && !r.isread);
      lastSeenRef.current = maxId;
      if (fresh.length) onIncoming?.(fresh);
    }
  }, [notifQ.data, onIncoming]);

  /* Re-validate on open so the panel is always current. */
  useEffect(() => {
    if (open) queryClient.invalidateQueries({ queryKey: qk.notifications(userid) });
  }, [open, queryClient, userid]);

  /* Close on outside click + Escape. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey  = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unread = items.filter(n => !n.isread).length;

  const markRead = async (n) => {
    if (n.isread) return;
    queryClient.setQueryData(qk.notifications(userid), (prev = []) =>
      prev.map(x => x.notificationid === n.notificationid ? { ...x, isread: true } : x));
    try { await api.markNotificationRead(n); } catch { /* keep optimistic state */ }
  };

  const onItemClick = async (n) => {
    markRead(n);
    if (n.taskid != null && onOpenTask) {
      setOpen(false);
      onOpenTask(n.taskid, n.messageid ?? null);
    }
  };

  const markAllRead = () => items.filter(n => !n.isread).forEach(markRead);

  return (
    <div className="notif" ref={rootRef}>
      <button
        className="iconbtn"
        aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name="bell" size={15}/>
        {unread > 0 && <span className="notif-dot"/>}
      </button>

      {open && (
        <div className="notif-pop" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <span className="notif-title">Notifications</span>
            {unread > 0 && (
              <button className="notif-markall" onClick={markAllRead}>
                <Icon name="check-all" size={12}/>
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="notif-empty">You're all caught up.</div>
          ) : (
            <ul className="notif-list">
              {items.map(n => (
                <li key={n.notificationid}>
                  <button
                    className={`notif-item ${n.isread ? '' : 'is-unread'}`}
                    onClick={() => onItemClick(n)}
                    title={n.taskid != null ? 'Open task' : undefined}
                  >
                    <span className="notif-item-dot" aria-hidden="true"/>
                    <span className="notif-item-body">
                      <span className="notif-item-title">{n.title || n.notificationtype || 'Notification'}</span>
                      {n.body && <span className="notif-item-text">{n.body}</span>}
                      <span className="notif-item-meta">
                        {n.notificationtype && <span className="notif-item-type">{n.notificationtype}</span>}
                        {(n.taskTitle || n.messagetaskTitle) && (
                          <span className="notif-item-task">{n.taskTitle || n.messagetaskTitle}</span>
                        )}
                        <span className="notif-item-when">{relTime(n.creationdate)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ *
 * Live toasts — popups for notifications that arrive while the   *
 * app is open. Clicking one opens the task (and focuses the      *
 * message when the notification points at one).                  *
 * ------------------------------------------------------------ */
const TOAST_TTL_MS = 8000;

export function ToastHost({ toasts, onDismiss, onOpen }) {
  /* Auto-dismiss each toast after its TTL. */
  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map(t =>
      setTimeout(() => onDismiss(t.notificationid), TOAST_TTL_MS)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, onDismiss]);

  if (!toasts.length) return null;
  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map(t => (
        <div key={t.notificationid} className="toast" role="status">
          <button
            className="toast-body"
            onClick={() => onOpen(t)}
            title={t.taskid != null ? 'Open task' : undefined}
          >
            <span className="toast-icon"><Icon name={t.messageid != null ? 'chat' : 'bell'} size={14}/></span>
            <span className="toast-text">
              <span className="toast-title">{t.title || t.notificationtype}</span>
              {t.body && <span className="toast-sub">{t.body}</span>}
            </span>
          </button>
          <button className="toast-close" onClick={() => onDismiss(t.notificationid)} aria-label="Dismiss">
            <Icon name="close" size={12}/>
          </button>
        </div>
      ))}
    </div>
  );
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
