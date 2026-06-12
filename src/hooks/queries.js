/* TanStack Query hooks wrapping the existing src/api.js calls.
 *
 * Server-load profile (the reason this layer exists — ~100 users):
 *   - lookups/access lists are cached for minutes, not refetched per
 *     panel-open
 *   - identical queries from different components are deduplicated
 *   - polling runs only for the open task and only while the tab is
 *     visible (usePageVisible), and pauses during writes
 *
 * `api.js` and the backend stay untouched.
 */

import { useQuery } from '@tanstack/react-query';

import * as api from '../api.js';
import { qk } from '../queryKeys.js';
import { getApiHypermedia } from '../auth.js';
import { IS_MOCK } from '../config.js';
import { usePageVisible } from './usePageVisible.js';

/* Poll cadences (ms). Chat is snappy; activity slower; unread app-wide. */
export const POLL = {
  messages:      4000,
  reactions:     4000,
  attachments:   5000,
  activity:      10000,
  unread:        20000,
  notifications: 20000,
};

/* ---- App-wide caching ---- */

export function useTasks() {
  return useQuery({
    queryKey: qk.tasks(),
    queryFn: async () => {
      // ACL gate preserved from the old loadEverything(): refuse early if
      // the user's hypermedia exposes neither tasks resource.
      const h = getApiHypermedia();
      if (!IS_MOCK && h && !h.tasks && !h.tasksfresh) {
        const e = new Error('You do not have access to tasks.');
        e.code = 403;
        throw e;
      }
      const page = await api.listTasks();
      return page?.collection || [];
    },
    staleTime: 15_000,
  });
}

export function useLookups() {
  return useQuery({
    queryKey: qk.lookups(),
    queryFn: api.loadLookups,
    staleTime: 5 * 60_000,   // lookups rarely change
  });
}

export function useAllAssignees() {
  return useQuery({
    queryKey: qk.allAssignees(),
    queryFn: api.listAllAssignees,
    staleTime: 60_000,
  });
}

/* Per-user access lists (sidebar clients + product/module pickers).
 * Fetched once per session per user in practice. */
export function useUserOrgs(userid) {
  return useQuery({
    queryKey: qk.userOrgs(userid),
    queryFn: () => api.listUserOrgs(userid),
    enabled: userid != null,
    staleTime: 5 * 60_000,
  });
}

export function useUserProductsModules(userid) {
  return useQuery({
    queryKey: qk.userProductsModules(userid),
    queryFn: () => api.listUserProductsModules(userid),
    enabled: userid != null,
    staleTime: 5 * 60_000,
  });
}

/* Light app-wide polling so unread badges update without reselecting a task.
 * `enabled` is gated on a resolved user id (backend scopes by auth context). */
export function useUnread(enabled) {
  const visible = usePageVisible();
  return useQuery({
    queryKey: qk.unread(),
    queryFn: api.listMyUnread,
    enabled: !!enabled,
    refetchInterval: visible ? POLL.unread : false,
    staleTime: 5_000,
  });
}

/* Notifications drive the bell + live toasts. One query app-wide. */
export function useNotifications(userid) {
  const visible = usePageVisible();
  return useQuery({
    queryKey: qk.notifications(userid),
    queryFn: async () => {
      const rows = await api.listNotifications(userid);
      rows.sort((a, b) => new Date(b.creationdate) - new Date(a.creationdate));
      return rows;
    },
    enabled: userid != null,
    refetchInterval: visible && userid != null ? POLL.notifications : false,
    staleTime: 5_000,
  });
}

/* ---- Per-task queries (the open task only, gated on visibility, and
 *      paused while a mutation is in flight to avoid clobbering the
 *      optimistic state mid-write). ---- */

export function useTask(taskId, { enabled = true } = {}) {
  return useQuery({
    queryKey: qk.task(taskId),
    queryFn: () => api.getTask(taskId),
    enabled: enabled && taskId != null,
    staleTime: 15_000,
  });
}

export function useActivity(taskId, { enabled = true, paused = false } = {}) {
  const visible = usePageVisible();
  const on = enabled && taskId != null;
  return useQuery({
    queryKey: qk.activity(taskId),
    queryFn: () => api.listActivity(taskId),
    enabled: on,
    refetchInterval: (visible && on && !paused) ? POLL.activity : false,
    staleTime: 4_000,
  });
}

export function useMessages(taskId, { enabled = true, paused = false } = {}) {
  const visible = usePageVisible();
  const on = enabled && taskId != null;
  return useQuery({
    queryKey: qk.messages(taskId),
    queryFn: () => api.listMessages(taskId),
    enabled: on,
    refetchInterval: (visible && on && !paused) ? POLL.messages : false,
    staleTime: 1_000,
  });
}

/* Reactions are fetched by message-id list (no "all reactions for task"
 * endpoint). Re-runs as the message set grows; polled alongside messages. */
export function useReactions(taskId, messageIds, { enabled = true, paused = false } = {}) {
  const visible = usePageVisible();
  const ids = messageIds || [];
  const on = enabled && taskId != null && ids.length > 0;
  return useQuery({
    queryKey: qk.reactions(taskId),
    queryFn: () => api.listReactionsForMessages(ids),
    enabled: on,
    refetchInterval: (visible && on && !paused) ? POLL.reactions : false,
    staleTime: 1_000,
  });
}

export function useReadMarker(taskId, userId, { enabled = true } = {}) {
  return useQuery({
    queryKey: qk.readMarker(taskId, userId),
    queryFn: () => api.getReadMarker(taskId, userId),  // returns null on 404
    enabled: enabled && taskId != null && userId != null,
    staleTime: 30_000,
    retry: false,
  });
}

export function useAssignees(taskId, { enabled = true } = {}) {
  return useQuery({
    queryKey: qk.assignees(taskId),
    queryFn: () => api.listAssignees(taskId),
    enabled: enabled && taskId != null,
    staleTime: 60_000,
  });
}

export function useWatchers(taskId, { enabled = true } = {}) {
  return useQuery({
    queryKey: qk.watchers(taskId),
    queryFn: () => api.listWatchers(taskId),
    enabled: enabled && taskId != null,
    staleTime: 60_000,
  });
}

/* Verifiers of the open task — polled with the activity cadence so other
 * users' verifications appear in the banner live. */
export function useVerifications(taskId, { enabled = true, paused = false } = {}) {
  const visible = usePageVisible();
  const on = enabled && taskId != null;
  return useQuery({
    queryKey: qk.verifications(taskId),
    queryFn: () => api.listVerifications(taskId),
    enabled: on,
    refetchInterval: (visible && on && !paused) ? POLL.activity : false,
    staleTime: 4_000,
  });
}

export function useAttachments(taskId, { enabled = true, paused = false } = {}) {
  const visible = usePageVisible();
  const on = enabled && taskId != null;
  return useQuery({
    queryKey: qk.attachments(taskId),
    queryFn: () => api.listAttachments(taskId),
    enabled: on,
    refetchInterval: (visible && on && !paused) ? POLL.attachments : false,
    staleTime: 1_000,
  });
}
