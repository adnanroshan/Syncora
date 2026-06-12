/* Activity & Discussion — the two-tab section at the bottom of the
 * detail panel.
 *
 * Data is served from TanStack Query (cache + smart polling): messages,
 * reactions and activity refetch on a short interval while the panel is
 * open and the tab is visible; polling pauses while a mutation is in
 * flight so optimistic state isn't clobbered mid-write. Mutations use
 * useMutation with optimistic cache writes + rollback; sends keep a
 * pending overlay (temp negative id) so an in-flight message survives a
 * poll that lands before its POST resolves.
 *
 * Sends also fan out notifications: mentioned users get a Mention, the
 * rest of the task's audience (creator + assignees + watchers) a Message.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useMutation, useIsMutating, useQueryClient } from '@tanstack/react-query';
import { Icon } from './Icons.jsx';
import { ActivityFeed } from './ActivityFeed.jsx';
import { Discussion } from './Discussion.jsx';
import { qk } from '../queryKeys.js';
import {
  useActivity, useMessages, useReactions, useReadMarker, useAssignees,
} from '../hooks/queries.js';
import { NOTIF, notifyUsers, getTaskAudience, snippet } from '../notify.js';

const MENTION_RE = /@([a-zA-Z0-9_.\-]+)/g;
const EMPTY = [];

function prettyErr(err) {
  if (!err) return 'Unknown error';
  if (err.errors?.[0]) return err.errors[0].message || err.errors[0].reason || 'Error';
  return err.message || String(err);
}

export function ActivityDiscussion({
  task, currentUser, usersById, lookups, api,
  attachments = [], onOpenImage, resolver, onAttachFiles, jumpRequest,
}) {
  const taskId = task?.taskid;
  const meId   = currentUser?.userid;

  const [tab, setTab] = useState('discussion');
  const messageRefs = useRef({});
  const queryClient = useQueryClient();

  /* Pause polling for this task while any mutation is running. */
  const mutating = useIsMutating() > 0;
  const pollOpts = { enabled: taskId != null, paused: mutating };

  /* --- queries --- */
  const activityQ   = useActivity(taskId, pollOpts);
  const messagesQ   = useMessages(taskId, pollOpts);
  const readMarkerQ = useReadMarker(taskId, meId, { enabled: taskId != null && meId != null });
  const assigneesQ  = useAssignees(taskId, { enabled: taskId != null });

  const activity   = activityQ.data || EMPTY;
  const serverMsgs = messagesQ.data || EMPTY;

  const messageIds = useMemo(
    () => serverMsgs.map(m => m.messageid).filter(id => id > 0),
    [serverMsgs],
  );
  const reactionsQ = useReactions(taskId, messageIds, pollOpts);
  const reactions  = reactionsQ.data || EMPTY;

  const readMarker = readMarkerQ.data || null;
  const lastReadMessageId = readMarker?.lastreadmessageid ?? null;

  /* Pending optimistic sends (temp negative ids) not yet confirmed. */
  const [pending, setPending] = useState([]);
  const messages = useMemo(() => [...serverMsgs, ...pending], [serverMsgs, pending]);

  /* Reset the pending overlay when switching tasks. */
  useEffect(() => { setPending([]); }, [taskId]);

  const unread = useMemo(() => messages.filter(m =>
    !m.isdeleted
    && (lastReadMessageId == null || m.messageid > lastReadMessageId)
    && m.userid !== meId
  ).length, [messages, lastReadMessageId, meId]);

  /* Candidate users for @mention resolution at send-time. */
  const usersByUsername = useMemo(() => {
    const out = {};
    Object.values(usersById || {}).forEach(u => { if (u?.username) out[u.username] = u; });
    return out;
  }, [usersById]);

  /* Group message-level attachments by messageid for inline rendering.
   * Failed optimistic rows are hidden from the thread. */
  const attachmentsByMessage = useMemo(() => {
    const out = {};
    for (const a of attachments) {
      if (a.messageid == null || a.status === 'failed') continue;
      (out[a.messageid] ||= []).push(a);
    }
    return out;
  }, [attachments]);

  /* --- mutations --- */
  const sendMutation = useMutation({
    mutationFn: async ({ text, parentmessageid, files }) => {
      const saved = await api.createMessage({
        taskid: taskId, userid: meId, parentmessageid: parentmessageid ?? null, messagetext: text,
      });
      // Files need the real messageid, so upload after the message exists.
      if (files?.length && onAttachFiles) await onAttachFiles(files, saved.messageid);

      // Best-effort mention extraction + POST.
      const tokens = Array.from(new Set((text.match(MENTION_RE) || []).map(s => s.slice(1))));
      const mentionIds = [];
      for (const username of tokens) {
        const u = usersByUsername[username];
        if (!u?.userid) continue;
        mentionIds.push(u.userid);
        api.addMention({ messageid: saved.messageid, userid: u.userid }).catch(() => {});
      }

      /* Notification fan-out: mentioned users get a Mention, the rest of
       * the task's audience (creator + assignees + watchers) a Message. */
      const meName = currentUser?.name || currentUser?.username || 'Someone';
      notifyUsers(mentionIds, {
        actorId: meId, notificationtype: NOTIF.Mention,
        title: `${meName} mentioned you in: ${task.title}`,
        body: snippet(text),
        taskid: taskId, messageid: saved.messageid,
      });
      getTaskAudience(task).then(audience => {
        mentionIds.forEach(id => audience.delete(id));
        notifyUsers(audience, {
          actorId: meId, notificationtype: NOTIF.Message,
          title: `New message in: ${task.title}`,
          body: `${meName}: ${snippet(text)}`,
          taskid: taskId, messageid: saved.messageid,
        });
      }).catch(() => {});

      return saved;
    },
    onMutate: ({ text, parentmessageid }) => {
      const optimisticId = -Date.now();
      setPending(prev => [...prev, {
        messageid: optimisticId, taskid: taskId, parentmessageid: parentmessageid ?? null,
        userid: meId, userUsername: currentUser.username, messagetext: text,
        isedited: false, editeddate: null, isdeleted: false, deleteddate: null,
        creationdate: new Date().toISOString(),
      }]);
      return { optimisticId };
    },
    onSuccess: (saved, _vars, ctx) => {
      queryClient.setQueryData(qk.messages(taskId), (prev = []) =>
        prev.some(m => m.messageid === saved.messageid) ? prev : [...prev, saved]);
      setPending(prev => prev.filter(m => m.messageid !== ctx.optimisticId));
      queryClient.invalidateQueries({ queryKey: qk.unread() });
    },
    onError: (err, _vars, ctx) => {
      setPending(prev => prev.filter(m => m.messageid !== ctx?.optimisticId));
      alert('Could not send message: ' + prettyErr(err));
    },
  });
  const sendMessage = (args) => sendMutation.mutateAsync(args);

  const editMutation = useMutation({
    mutationFn: ({ message, newText }) => api.editMessage(message.messageid, newText),
    onMutate: ({ message, newText }) => {
      const key = qk.messages(taskId);
      const prev = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (list = []) => list.map(m => m.messageid === message.messageid
        ? { ...m, messagetext: newText, isedited: true, editeddate: new Date().toISOString() } : m));
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(qk.messages(taskId), ctx.prev);
      alert('Could not edit message: ' + prettyErr(err));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.messages(taskId) }),
  });
  const editMessage = (message, newText) => editMutation.mutate({ message, newText });

  const deleteMutation = useMutation({
    mutationFn: (message) => api.softDeleteMessage(message.messageid),
    onMutate: (message) => {
      const key = qk.messages(taskId);
      const prev = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (list = []) => list.map(m => m.messageid === message.messageid
        ? { ...m, isdeleted: true, deleteddate: new Date().toISOString() } : m));
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(qk.messages(taskId), ctx.prev);
      alert('Could not delete message: ' + prettyErr(err));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.messages(taskId) }),
  });
  const softDeleteMessage = (message) => deleteMutation.mutate(message);

  const reactionMutation = useMutation({
    mutationFn: async ({ message, emoji, mine }) => {
      if (mine) return api.removeReaction({ messageid: message.messageid, userid: meId, emoji });
      try {
        return await api.addReaction({ messageid: message.messageid, userid: meId, emoji });
      } catch (err) {
        if (err?.code === 409) { try { await api.removeReaction({ messageid: message.messageid, userid: meId, emoji }); } catch { /* */ } return; }
        throw err;
      }
    },
    onMutate: ({ message, emoji, mine }) => {
      const key = qk.reactions(taskId);
      const prev = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (list = []) => mine
        ? list.filter(r => !(r.messageid === message.messageid && r.userid === meId && r.emoji === emoji))
        : [...list, { messageid: message.messageid, userid: meId, emoji, creationdate: new Date().toISOString() }]);
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(qk.reactions(taskId), ctx.prev);
      alert('Could not update reaction: ' + prettyErr(err));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.reactions(taskId) }),
  });
  const toggleReaction = (message, emoji) => {
    if (meId == null) return;
    const mine = reactions.some(r => r.messageid === message.messageid && r.userid === meId && r.emoji === emoji);
    reactionMutation.mutate({ message, emoji, mine });
  };

  const readMutation = useMutation({
    mutationFn: (maxId) => api.upsertReadMarker(taskId, meId, maxId),
    onSuccess: (saved, maxId) => {
      queryClient.setQueryData(qk.readMarker(taskId, meId),
        saved || { taskid: taskId, userid: meId, lastreadmessageid: maxId });
      queryClient.invalidateQueries({ queryKey: qk.unread() });
    },
  });
  const markAllRead = useCallback(() => {
    if (taskId == null || meId == null) return;
    const maxId = serverMsgs.reduce((m, x) => Math.max(m, x.messageid > 0 ? x.messageid : 0), 0);
    if (!maxId || maxId === lastReadMessageId) return;
    readMutation.mutate(maxId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, meId, serverMsgs, lastReadMessageId]);

  /* Mark read shortly after the Discussion tab shows messages. */
  useEffect(() => {
    if (tab !== 'discussion') return;
    if (messages.length === 0) return;
    const id = setTimeout(() => { markAllRead(); }, 600);
    return () => clearTimeout(id);
  }, [tab, messages.length, markAllRead]);

  /* Jump to a message (from a notification toast or a "from message"
   * attachment badge): switch to the Discussion tab, then scroll the
   * target into view with a brief flash. Retries while data loads. */
  useEffect(() => {
    if (jumpRequest?.messageid == null) return;
    setTab('discussion');
    let tries = 0;
    let timer;
    const tryScroll = () => {
      const el = messageRefs.current[jumpRequest.messageid];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('chat-msg-flash');
        setTimeout(() => el.classList.remove('chat-msg-flash'), 1600);
        return;
      }
      // Message may not be rendered yet (task/messages still loading after a
      // toast click) — retry for a few seconds.
      if (tries++ < 25) timer = setTimeout(tryScroll, 150);
    };
    timer = setTimeout(tryScroll, 120);
    return () => clearTimeout(timer);
  }, [jumpRequest]);

  const taskAssigneeUsers = useMemo(
    () => (assigneesQ.data || EMPTY)
      .map(a => usersById?.[a.assigneduserid])
      .filter(Boolean),
    [assigneesQ.data, usersById],
  );

  return (
    <section className="detail-section ad-shell">
      <div className="ad-tabs">
        <div className="ad-tab-strip" role="tablist">
          <button
            role="tab"
            className={`ad-tab ${tab === 'activity' ? 'is-active' : ''}`}
            onClick={() => setTab('activity')}
          >
            <Icon name="history" size={13}/>
            <span>Activity</span>
            <span className="ad-tab-count">{activity.length}</span>
          </button>
          <button
            role="tab"
            className={`ad-tab ${tab === 'discussion' ? 'is-active' : ''}`}
            onClick={() => setTab('discussion')}
          >
            <Icon name="chat" size={13}/>
            <span>Discussion</span>
            <span className="ad-tab-count">{messages.filter(m => !m.isdeleted).length}</span>
            {unread > 0 && tab !== 'discussion' && (
              <span className="ad-tab-unread" title={`${unread} unread`}/>
            )}
          </button>
        </div>
        <div className="ad-tab-tools">
          {tab === 'discussion' && unread > 0 && (
            <button
              className="ad-tab-tool"
              onClick={markAllRead}
              title="Mark all messages as read"
            >
              <Icon name="check-all" size={13}/>
              <span>Mark read</span>
            </button>
          )}
        </div>
      </div>

      {tab === 'activity' ? (
        <ActivityFeed items={activity} usersById={usersById}/>
      ) : (
        <Discussion
          messages={messages}
          reactions={reactions}
          lastReadMessageId={lastReadMessageId}
          currentUser={currentUser}
          usersById={usersById}
          taskAssignees={taskAssigneeUsers}
          onSend={sendMessage}
          onEdit={editMessage}
          onSoftDelete={softDeleteMessage}
          onToggleReaction={toggleReaction}
          onMarkRead={markAllRead}
          attachmentsByMessage={attachmentsByMessage}
          onOpenImage={onOpenImage}
          resolver={resolver}
          messageRefs={messageRefs}
        />
      )}
    </section>
  );
}
