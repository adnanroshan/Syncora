/* TanStack Query hooks wrapping the existing src/api.js calls.
 *
 * Phase 2 (this file, commit 1): app-wide caching — tasks, lookups,
 * assignees, unread. Phase 3-4 (chat/activity polling + mutations) extend
 * this file in the next commit. `api.js` and the backend stay untouched.
 *
 * Polling intervals are gated on tab visibility (usePageVisible) so a
 * backgrounded tab stops hitting the backend.
 */

import { useQuery } from '@tanstack/react-query';

import * as api from '../api.js';
import { qk } from '../queryKeys.js';
import { getApiHypermedia } from '../auth.js';
import { IS_MOCK } from '../config.js';
import { usePageVisible } from './usePageVisible.js';

/* Poll cadences (ms). Chat is snappy; activity slower; unread app-wide. */
export const POLL = {
  messages:    2000,
  reactions:   2000,
  attachments: 2000,
  activity:    8000,
  unread:      15000,
};

/* ---- Phase 2: caching for the whole app ---- */

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

/* ---- Phase 3: per-task polling (only the open task, gated on visibility,
 *      and paused while a mutation is in flight to avoid clobbering the
 *      optimistic state mid-write). ---- */

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
