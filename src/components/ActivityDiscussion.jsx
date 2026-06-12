/* Activity & Discussion — the two-tab section at the bottom of the
 * detail panel. Owns data fetching for the task, threading mutations
 * down to <Discussion>, and the read-marker / unread badge.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Icon } from './Icons.jsx';
import { ActivityFeed } from './ActivityFeed.jsx';
import { Discussion } from './Discussion.jsx';
import { NOTIF, notifyUsers, getTaskAudience, snippet } from '../notify.js';

const MENTION_RE = /@([a-zA-Z0-9_.\-]+)/g;

function prettyErr(err) {
  if (!err) return 'Unknown error';
  if (err.errors?.[0]) return err.errors[0].message || err.errors[0].reason || 'Error';
  return err.message || String(err);
}

export function ActivityDiscussion({
  task, currentUser, usersById, lookups, api, refreshKey, focusMessageId,
  attachments = [], onOpenImage, resolver, onAttachFiles, jumpRequest,
}) {
  const taskId = task?.taskid;
  const meId   = currentUser?.userid;

  const [tab, setTab]               = useState('discussion');
  const messageRefs = useRef({});

  /* Deep-link from a notification/toast: land on the Discussion tab. */
  useEffect(() => {
    if (focusMessageId != null) setTab('discussion');
  }, [focusMessageId]);
  const [activity, setActivity]     = useState([]);
  const [messages, setMessages]     = useState([]);
  const [reactions, setReactions]   = useState([]);
  const [readMarker, setReadMarker] = useState(null);
  const [taskAssignees, setTaskAssignees] = useState([]);

  /* Load everything in parallel when the task changes. */
  useEffect(() => {
    if (taskId == null) return;
    let cancelled = false;

    (async () => {
      try {
        const [act, msgs, marker, assg] = await Promise.all([
          api.listActivity(taskId).catch(() => []),
          api.listMessages(taskId).catch(() => []),
          meId != null ? api.getReadMarker(taskId, meId).catch(() => null) : Promise.resolve(null),
          api.listAssignees(taskId).catch(() => []),
        ]);
        if (cancelled) return;
        setActivity(act);
        setMessages(msgs);
        setReadMarker(marker);
        setTaskAssignees(assg);
        const ids = msgs.map(m => m.messageid);
        if (ids.length) {
          const rx = await api.listReactionsForMessages(ids).catch(() => []);
          if (!cancelled) setReactions(rx);
        } else if (!cancelled) {
          setReactions([]);
        }
      } catch { /* swallow — empty state will render */ }
    })();

    return () => { cancelled = true; };
  }, [taskId, meId, api, refreshKey]);

  const lastReadMessageId = readMarker?.lastreadmessageid ?? null;

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

  /* --- Mutations (optimistic) --- */
  const sendMessage = async ({ text, parentmessageid, files }) => {
    if (!taskId || !meId) return;
    const optimisticId = -Date.now();
    const optimistic = {
      messageid:       optimisticId,
      taskid:          taskId,
      parentmessageid: parentmessageid ?? null,
      userid:          meId,
      userUsername:    currentUser.username,
      messagetext:     text,
      isedited:        false,
      editeddate:      null,
      isdeleted:       false,
      deleteddate:     null,
      creationdate:    new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    try {
      const saved = await api.createMessage({
        taskid: taskId, userid: meId, parentmessageid: parentmessageid ?? null, messagetext: text,
      });
      setMessages(prev => prev.map(m => m.messageid === optimisticId ? saved : m));

      /* Now that the message exists, upload any staged files against it. */
      if (files?.length && onAttachFiles) {
        await onAttachFiles(files, saved.messageid);
      }

      /* Best-effort mention extraction + POST. */
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
    } catch (err) {
      setMessages(prev => prev.filter(m => m.messageid !== optimisticId));
      alert('Could not send message: ' + prettyErr(err));
    }
  };

  const editMessage = async (message, newText) => {
    const before = message;
    setMessages(prev => prev.map(m => m.messageid === message.messageid
      ? { ...m, messagetext: newText, isedited: true, editeddate: new Date().toISOString() }
      : m,
    ));
    try { await api.editMessage(message.messageid, newText); }
    catch (err) {
      setMessages(prev => prev.map(m => m.messageid === message.messageid ? before : m));
      alert('Could not edit message: ' + prettyErr(err));
    }
  };

  const softDeleteMessage = async (message) => {
    const before = message;
    setMessages(prev => prev.map(m => m.messageid === message.messageid
      ? { ...m, isdeleted: true, deleteddate: new Date().toISOString() }
      : m,
    ));
    try { await api.softDeleteMessage(message.messageid); }
    catch (err) {
      setMessages(prev => prev.map(m => m.messageid === message.messageid ? before : m));
      alert('Could not delete message: ' + prettyErr(err));
    }
  };

  const toggleReaction = async (message, emoji) => {
    if (meId == null) return;
    const mine = reactions.find(r =>
      r.messageid === message.messageid && r.userid === meId && r.emoji === emoji
    );
    if (mine) {
      setReactions(prev => prev.filter(r => r !== mine));
      try { await api.removeReaction({ messageid: message.messageid, userid: meId, emoji }); }
      catch (err) { setReactions(prev => [...prev, mine]); alert('Could not remove reaction: ' + prettyErr(err)); }
      return;
    }
    const row = { messageid: message.messageid, userid: meId, emoji, creationdate: new Date().toISOString() };
    setReactions(prev => [...prev, row]);
    try {
      await api.addReaction(row);
    } catch (err) {
      if (err?.code === 409) {
        try { await api.removeReaction(row); }
        catch { /* swallow */ }
        setReactions(prev => prev.filter(r => r !== row));
      } else {
        setReactions(prev => prev.filter(r => r !== row));
        alert('Could not add reaction: ' + prettyErr(err));
      }
    }
  };

  const markAllRead = useCallback(async () => {
    if (taskId == null || meId == null) return;
    const maxId = messages.reduce((m, x) => Math.max(m, x.messageid), 0);
    if (!maxId || maxId === lastReadMessageId) return;
    try {
      const saved = await api.upsertReadMarker(taskId, meId, maxId);
      setReadMarker(saved || { taskid: taskId, userid: meId, lastreadmessageid: maxId });
    } catch { /* swallow */ }
  }, [api, taskId, meId, messages, lastReadMessageId]);

  /* When the user is on Discussion and there are messages, mark read. */
  useEffect(() => {
    if (tab !== 'discussion') return;
    if (messages.length === 0) return;
    const id = setTimeout(() => { markAllRead(); }, 600);
    return () => clearTimeout(id);
  }, [tab, messages.length, markAllRead]);

  /* Jump to a message (from a "from message" attachment badge): switch to
   * the Discussion tab, then scroll the target into view with a brief flash. */
  useEffect(() => {
    if (jumpRequest?.messageid == null) return;
    setTab('discussion');
    const id = setTimeout(() => {
      const el = messageRefs.current[jumpRequest.messageid];
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('chat-msg-flash');
      setTimeout(() => el.classList.remove('chat-msg-flash'), 1600);
    }, 120);
    return () => clearTimeout(id);
  }, [jumpRequest]);

  const taskAssigneeUsers = useMemo(
    () => taskAssignees
      .map(a => usersById?.[a.assigneduserid])
      .filter(Boolean),
    [taskAssignees, usersById],
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
          focusMessageId={focusMessageId}
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
