/* Discussion tab — per-task chat thread with one-level threading,
 * mentions, reactions, soft-delete tombstones, edit-in-place, and a
 * "↓ New messages" divider before the first non-own message that's
 * newer than the user's lastreadmessageid.
 */

import React, {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { Icon } from './Icons.jsx';
import { Avatar } from './Shared.jsx';
import { MessageComposer } from './MessageComposer.jsx';

const QUICK_EMOJI = ['👍', '🎉', '❤️'];
const EMOJI_PICKER_SET = [
  '👍','👎','🎉','❤️','💛','💚','💙','💜','🔥','✨','⭐','💯',
  '🚀','✅','❌','⚠️','👀','🙏','👋','🤝','🧠','💡','🐛','🔧',
  '😀','😂','😅','😉','😊','😍','🤔','😎','😢','😡','🥳','🤯',
];

/* ---------- time helpers ---------- */
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function fmtRelOrTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60)   return 'just now';
  if (diff < 3600) return Math.round(diff / 60) + 'm';
  return fmtTime(iso);
}
function fmtAbs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
function dayKey(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/* ---------- mention rendering ---------- */
function MentionChip({ username, user }) {
  const valid = !!user;
  return (
    <span
      className={`chat-mention ${valid ? '' : 'is-unresolved'}`}
      title={valid ? (user.name || user.username) : 'Unknown user'}
    >
      @{user?.username || username}
    </span>
  );
}
function renderMessageText(text, usersByUsername) {
  if (!text) return null;
  const parts = [];
  const re = /@([a-zA-Z0-9_.\-]+)/g;
  let last = 0, m, key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    parts.push(<MentionChip key={key++} username={m[1]} user={usersByUsername[m[1]]}/>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={key++}>{text.slice(last)}</span>);
  return parts;
}

/* ============================================================
 * Reactions row
 * ============================================================ */
function Reactions({ reactions, currentUserId, onToggle, usersById }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setPickerOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setPickerOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const groups = {};
  for (const r of reactions || []) {
    if (!groups[r.emoji]) groups[r.emoji] = [];
    groups[r.emoji].push(r);
  }
  const entries = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

  if (entries.length === 0) return null;

  return (
    <div className="chat-reactions" ref={rootRef}>
      {entries.map(([emoji, rows]) => {
        const mine = rows.some(r => r.userid === currentUserId);
        const names = rows
          .map(r => usersById[r.userid])
          .filter(Boolean)
          .map(u => u.name || u.username);
        const tooltip = `${names.join(', ') || 'Someone'} reacted with ${emoji}`;
        return (
          <button
            key={emoji}
            type="button"
            className={`chat-reaction ${mine ? 'is-mine' : ''}`}
            onClick={() => onToggle(emoji)}
            title={tooltip}
          >
            <span className="chat-reaction-emoji">{emoji}</span>
            <span className="chat-reaction-count">{rows.length}</span>
          </button>
        );
      })}
      <div className="chat-reaction-addwrap">
        <button
          type="button"
          className="chat-reaction-add"
          onClick={() => setPickerOpen(o => !o)}
          aria-label="Add reaction"
          title="Add reaction"
        ><Icon name="smile-plus" size={13}/></button>
        {pickerOpen && (
          <div className="chat-emoji-pop">
            {EMOJI_PICKER_SET.map(e => (
              <button
                key={e}
                className="chat-emoji-popitem"
                onClick={() => { onToggle(e); setPickerOpen(false); }}
              >{e}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================
 * Single message row
 * ============================================================ */
function Message({
  message, currentUser, usersById, usersByUsername, mentionCandidates,
  reactions, onReply, onEdit, onDelete, onToggleReaction, isReply = false,
}) {
  const author = usersById[message.userid] || { username: message.userUsername, name: message.userUsername };
  const isMine = currentUser?.userid === message.userid;
  const [editing, setEditing]       = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  if (message.isdeleted) {
    return (
      <div className={`chat-msg is-deleted ${isReply ? 'is-reply' : ''}`}>
        <span className="chat-msg-avatar-slot">
          <span className="chat-tombstone-avatar"><Icon name="trash" size={11}/></span>
        </span>
        <div className="chat-msg-body">
          <div className="chat-tombstone">
            Message deleted
            <span className="chat-msg-time" title={fmtAbs(message.deleteddate)}>
              · {fmtRelOrTime(message.deleteddate)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className={`chat-msg is-editing ${isReply ? 'is-reply' : ''}`}>
        <span className="chat-msg-avatar-slot">
          <Avatar user={author} name={author.username} size={28}/>
        </span>
        <div className="chat-msg-body">
          <div className="chat-msg-head">
            <span className="chat-msg-author">{author.name || author.username}</span>
            <span className="chat-msg-time" title={fmtAbs(message.creationdate)}>{fmtTime(message.creationdate)}</span>
          </div>
          <MessageComposer
            currentUser={currentUser}
            mentionCandidates={mentionCandidates}
            initialValue={message.messagetext}
            placeholder="Edit message…"
            autoFocus
            compact
            onSend={(text) => { onEdit?.(message, text); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`chat-msg ${isReply ? 'is-reply' : ''}`}>
      <span className="chat-msg-avatar-slot">
        <Avatar user={author} name={author.username} size={28}/>
      </span>
      <div className="chat-msg-body">
        <div className="chat-msg-head">
          <span className="chat-msg-author">{author.name || author.username}</span>
          <span className="chat-msg-time" title={fmtAbs(message.creationdate)}>{fmtTime(message.creationdate)}</span>
          {message.isedited && (
            <span className="chat-msg-edited" title={`Edited ${fmtAbs(message.editeddate)}`}>(edited)</span>
          )}
        </div>
        <div className="chat-msg-text">
          {renderMessageText(message.messagetext, usersByUsername)}
        </div>
        <Reactions
          reactions={reactions}
          currentUserId={currentUser?.userid}
          onToggle={(emoji) => onToggleReaction?.(message, emoji)}
          usersById={usersById}
        />

        <div className="chat-msg-actions" ref={pickerRef}>
          <div className="chat-msg-actions-quickreact">
            {QUICK_EMOJI.map(e => (
              <button key={e} className="chat-msg-action" onClick={() => onToggleReaction?.(message, e)}>
                {e}
              </button>
            ))}
            <button className="chat-msg-action" onClick={() => setPickerOpen(o => !o)} title="More reactions">
              <Icon name="smile-plus" size={13}/>
            </button>
            {pickerOpen && (
              <div className="chat-emoji-pop chat-emoji-pop--anchor-r">
                {EMOJI_PICKER_SET.map(e => (
                  <button
                    key={e}
                    className="chat-emoji-popitem"
                    onClick={() => { onToggleReaction?.(message, e); setPickerOpen(false); }}
                  >{e}</button>
                ))}
              </div>
            )}
          </div>
          <span className="chat-msg-actions-sep"/>
          {!isReply && (
            <button className="chat-msg-action" onClick={() => onReply?.(message)} title="Reply in thread">
              <Icon name="reply" size={13}/>
            </button>
          )}
          {isMine && (
            <>
              <button className="chat-msg-action" onClick={() => setEditing(true)} title="Edit">
                <Icon name="edit" size={13}/>
              </button>
              <button className="chat-msg-action is-danger" onClick={() => onDelete?.(message)} title="Delete">
                <Icon name="trash" size={13}/>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * Discussion (the tab)
 * ============================================================ */
export function Discussion({
  messages, reactions, lastReadMessageId, currentUser, usersById,
  taskAssignees = [], onSend, onEdit, onSoftDelete, onToggleReaction, onMarkRead,
  focusMessageId,
}) {
  const usersByUsername = useMemo(() => {
    const out = {};
    Object.values(usersById || {}).forEach(u => { if (u?.username) out[u.username] = u; });
    return out;
  }, [usersById]);

  const mentionCandidates = useMemo(() => {
    const set = new Map();
    (taskAssignees || []).forEach(u => { if (u?.userid != null) set.set(u.userid, u); });
    (messages || []).forEach(m => {
      const u = usersById?.[m.userid];
      if (u) set.set(u.userid, u);
    });
    if (set.size === 0) Object.values(usersById || {}).forEach(u => set.set(u.userid, u));
    return Array.from(set.values());
  }, [taskAssignees, messages, usersById]);

  const sorted = useMemo(
    () => (messages || []).slice().sort((a, b) => new Date(a.creationdate) - new Date(b.creationdate)),
    [messages],
  );
  const topLevel = sorted.filter(m => m.parentmessageid == null);
  const repliesByParent = useMemo(() => {
    const out = {};
    for (const m of sorted) {
      if (m.parentmessageid != null) {
        if (!out[m.parentmessageid]) out[m.parentmessageid] = [];
        out[m.parentmessageid].push(m);
      }
    }
    return out;
  }, [sorted]);
  const reactionsByMessage = useMemo(() => {
    const out = {};
    for (const r of reactions || []) {
      if (!out[r.messageid]) out[r.messageid] = [];
      out[r.messageid].push(r);
    }
    return out;
  }, [reactions]);

  const [replyTo, setReplyTo] = useState(null);

  /* Autoscroll: bottom on mount; on new message only if near bottom. */
  const scrollerRef = useRef(null);
  const prevLenRef  = useRef(sorted.length);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sorted.length !== prevLenRef.current) {
      const el = scrollerRef.current;
      if (el) {
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        if (nearBottom || prevLenRef.current === 0) {
          requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
        }
      }
      prevLenRef.current = sorted.length;
    }
  }, [sorted.length]);

  /* Deep-link focus: scroll the requested message into view and flash
   * it. Each message is wrapped in a display:contents div carrying
   * data-mid, so we can find its rendered node without touching layout. */
  useEffect(() => {
    if (focusMessageId == null) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const host = scroller.querySelector(`[data-mid="${focusMessageId}"]`);
    const el = host?.firstElementChild;
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('chat-msg-flash');
    const t = setTimeout(() => el.classList.remove('chat-msg-flash'), 2600);
    return () => clearTimeout(t);
  }, [focusMessageId, sorted.length]);

  /* Debounced read-marker upsert. */
  const markedRef = useRef(false);
  useEffect(() => {
    if (markedRef.current || topLevel.length === 0) return;
    markedRef.current = true;
    const id = setTimeout(() => onMarkRead?.(), 500);
    return () => clearTimeout(id);
  }, [topLevel.length, onMarkRead]);

  if (topLevel.length === 0) {
    return (
      <div className="chat">
        <div className="chat-empty">
          <Icon name="chat" size={22}/>
          <div className="chat-empty-title">No messages yet</div>
          <div className="chat-empty-sub">Kick off the conversation — assignees will be notified when you @mention them.</div>
        </div>
        <MessageComposer
          currentUser={currentUser}
          mentionCandidates={mentionCandidates}
          onSend={(text) => onSend?.({ text, parentmessageid: null })}
        />
      </div>
    );
  }

  const rendered = [];
  let prevDay = null;
  let dividerInserted = false;

  for (const m of topLevel) {
    const day = dayKey(m.creationdate);
    if (day !== prevDay) {
      rendered.push(<div key={`day-${m.messageid}`} className="chat-day"><span>{day}</span></div>);
      prevDay = day;
    }

    if (!dividerInserted
        && lastReadMessageId != null
        && m.messageid > lastReadMessageId
        && m.userid !== currentUser?.userid) {
      rendered.push(<div key={`new-${m.messageid}`} className="chat-new-divider"><span>New messages</span></div>);
      dividerInserted = true;
    }

    rendered.push(
      <div key={m.messageid} style={{ display: 'contents' }} data-mid={m.messageid}>
        <Message
          message={m}
          currentUser={currentUser}
          usersById={usersById}
          usersByUsername={usersByUsername}
          mentionCandidates={mentionCandidates}
          reactions={reactionsByMessage[m.messageid] || []}
          onReply={() => setReplyTo(m.messageid)}
          onEdit={onEdit}
          onDelete={onSoftDelete}
          onToggleReaction={onToggleReaction}
        />
      </div>,
    );

    const childReplies = repliesByParent[m.messageid] || [];
    if (childReplies.length > 0 || replyTo === m.messageid) {
      rendered.push(
        <div key={`thread-${m.messageid}`} className="chat-thread">
          {childReplies.map(r => (
            <div key={r.messageid} style={{ display: 'contents' }} data-mid={r.messageid}>
              <Message
                message={r}
                currentUser={currentUser}
                usersById={usersById}
                usersByUsername={usersByUsername}
                mentionCandidates={mentionCandidates}
                reactions={reactionsByMessage[r.messageid] || []}
                onEdit={onEdit}
                onDelete={onSoftDelete}
                onToggleReaction={onToggleReaction}
                isReply
              />
            </div>
          ))}
          {replyTo === m.messageid && (
            <div className="chat-reply-composer">
              <MessageComposer
                currentUser={currentUser}
                mentionCandidates={mentionCandidates}
                placeholder={`Reply to ${(usersById[m.userid]?.name) || m.userUsername || 'this thread'}…`}
                autoFocus
                onSend={(text) => {
                  onSend?.({ text, parentmessageid: m.messageid });
                  setReplyTo(null);
                }}
                onCancel={() => setReplyTo(null)}
              />
            </div>
          )}
        </div>,
      );
    }
  }

  return (
    <div className="chat">
      <div className="chat-scroller" ref={scrollerRef}>
        {rendered}
      </div>
      <MessageComposer
        currentUser={currentUser}
        mentionCandidates={mentionCandidates}
        onSend={(text) => onSend?.({ text, parentmessageid: null })}
      />
    </div>
  );
}
