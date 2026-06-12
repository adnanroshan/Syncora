/* Notifications bell — lives in the TopBar.
 *
 * Loads /v2/notifications?filter=(userid=<me>) once the logged-in user's
 * id is known, refreshes when the dropdown opens and on a 60s poll.
 * Clicking a notification marks it read (PATCH isread/readdate) and, when
 * it points at a task, opens that task's detail panel.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as api from '../api.js';
import { Icon } from './Icons.jsx';

const POLL_MS = 60 * 1000;

export function NotificationsBell({ userid, onOpenTask }) {
  const [open, setOpen]   = useState(false);
  const [items, setItems] = useState([]);
  const rootRef = useRef(null);
  // Bumped on every refresh AND on optimistic updates, so an in-flight
  // fetch that resolves late can't clobber newer state with stale rows.
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (userid == null) { setItems([]); return; }
    const seq = ++seqRef.current;
    try {
      const rows = await api.listNotifications(userid);
      if (seq !== seqRef.current) return; // superseded
      rows.sort((a, b) => new Date(b.creationdate) - new Date(a.creationdate));
      setItems(rows);
    } catch { /* swallow — the bell just stays empty */ }
  }, [userid]);

  /* Initial load + background poll. */
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  /* Re-fetch on open so the panel is always current. */
  useEffect(() => { if (open) refresh(); }, [open, refresh]);

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
    seqRef.current++; // invalidate any in-flight refresh
    setItems(prev => prev.map(x => x.notificationid === n.notificationid ? { ...x, isread: true } : x));
    try { await api.markNotificationRead(n); } catch { /* keep optimistic state */ }
  };

  const onItemClick = async (n) => {
    markRead(n);
    if (n.taskid != null && onOpenTask) {
      setOpen(false);
      onOpenTask(n.taskid);
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
