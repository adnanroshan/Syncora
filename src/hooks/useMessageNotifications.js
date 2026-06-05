/* Derives in-app toast notifications from the unread poll.
 *
 * /v2/taskunread only gives counts, so when a task's unread count *rises*
 * we fetch that task's recent messages to get the author, preview text,
 * and messageid (for jump-to-message) plus whether it mentions the user.
 *
 * - Baselines on the first poll so the existing backlog doesn't toast.
 * - Skips the user's own messages and the task currently open.
 * - Collapses multiple new messages on one task into a single toast.
 */

import { useEffect, useRef, useState } from 'react';

let _nid = 0;

export function useMessageNotifications({
  unreadRows, api, meId, openTaskId, usersById, tasksById, enabled = true,
}) {
  const [toasts, setToasts] = useState([]);
  const prevCounts = useRef(null);       // Map<taskid, unreadCount> — null until baseline
  const lastSeen   = useRef(new Map());  // Map<taskid, messageid>
  const openRef    = useRef(openTaskId);
  useEffect(() => { openRef.current = openTaskId; }, [openTaskId]);

  useEffect(() => {
    if (!enabled || meId == null) return;
    const rows = unreadRows || [];
    const curr = new Map(rows.map(r => [r.taskid, r.unreadCount || 0]));

    // First observation = baseline. Don't notify for the pre-existing backlog.
    if (prevCounts.current == null) { prevCounts.current = curr; return; }

    const prev = prevCounts.current;
    prevCounts.current = curr;  // set before async work to avoid re-entrant double-fire
    const risen = rows.filter(r => (r.unreadCount || 0) > (prev.get(r.taskid) || 0));
    if (risen.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const r of risen) {
        const taskid = r.taskid;
        if (taskid === openRef.current) continue;        // suppress for the open task

        let msgs;
        try { msgs = await api.listMessages(taskid); } catch { continue; }
        if (cancelled) return;

        const others = (msgs || [])
          .filter(m => !m.isdeleted && m.userid !== meId && m.messageid > 0)
          .sort((a, b) => a.messageid - b.messageid);
        if (others.length === 0) continue;

        const seen  = lastSeen.current.get(taskid);
        const delta = (r.unreadCount || 0) - (prev.get(taskid) || 0);
        // Known baseline → everything newer; first sighting → newest `delta`.
        const fresh = seen != null
          ? others.filter(m => m.messageid > seen)
          : others.slice(-Math.max(1, delta));
        lastSeen.current.set(taskid, others[others.length - 1].messageid);
        if (fresh.length === 0) continue;

        let mentionIds = new Set();
        try {
          const ms = await api.listMentionsForMessages(fresh.map(m => m.messageid));
          if (!cancelled) mentionIds = new Set((ms || []).filter(x => x.userid === meId).map(x => x.messageid));
        } catch { /* mentions are best-effort */ }
        if (cancelled) return;

        const latest      = fresh[fresh.length - 1];
        const anyMention  = fresh.some(m => mentionIds.has(m.messageid));
        const author      = usersById?.[latest.userid];
        setToasts(list => [...list, {
          id:         ++_nid,
          taskid,
          messageid:  latest.messageid,
          taskTitle:  tasksById?.[taskid]?.title || `Task #${taskid}`,
          authorName: author?.name || author?.username || latest.userUsername || 'Someone',
          authorUser: author || null,
          isMention:  anyMention,
          count:      fresh.length,
          text:       fresh.length === 1 ? (latest.messagetext || '') : `${fresh.length} new messages`,
        }].slice(-4)); // keep at most 4 on screen
      }
    })();

    return () => { cancelled = true; };
  }, [unreadRows, enabled, meId, api, usersById, tasksById]);

  const dismiss = (id) => setToasts(list => list.filter(t => t.id !== id));
  return { toasts, dismiss };
}
