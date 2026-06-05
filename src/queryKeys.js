/* Central query-key factory for TanStack Query.
 *
 * Keeping every key in one place keeps cache reads, polling, and
 * invalidation consistent. Keys are arrays so partial matches work
 * (e.g. invalidating ['messages'] would hit every task's messages).
 */

export const qk = {
  tasks:        () => ['tasks'],
  task:         (id) => ['task', id],
  lookups:      () => ['lookups'],
  allAssignees: () => ['assignees', 'all'],
  assignees:    (taskId) => ['assignees', taskId],
  unread:       () => ['unread'],
  activity:     (taskId) => ['activity', taskId],
  messages:     (taskId) => ['messages', taskId],
  reactions:    (taskId) => ['reactions', taskId],
  readMarker:   (taskId, userId) => ['readMarker', taskId, userId],
  attachments:  (taskId) => ['attachments', taskId],
};
