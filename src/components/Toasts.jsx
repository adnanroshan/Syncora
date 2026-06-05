/* Bottom-right toast stack for incoming messages / mentions.
 * Click a toast to open its task and jump to the message; auto-dismisses
 * after a few seconds (paused on hover), or dismiss manually. */

import React, { useEffect, useState } from 'react';
import { Icon } from './Icons.jsx';
import { Avatar } from './Shared.jsx';

const AUTO_DISMISS_MS = 6500;

function Toast({ note, onDismiss, onOpen }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => onDismiss(note.id), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [paused, note.id, onDismiss]);

  return (
    <div
      className={`toast ${note.isMention ? 'toast--mention' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(note)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(note); }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <Avatar user={note.authorUser} name={note.authorName} size={28}/>
      <div className="toast-body">
        <div className="toast-head">
          <span className="toast-author">{note.authorName}</span>
          {note.isMention && (
            <span className="toast-mention-chip"><Icon name="at" size={10}/> mentioned you</span>
          )}
        </div>
        <div className="toast-task" title={note.taskTitle}>{note.taskTitle}</div>
        <div className="toast-text">{note.text}</div>
      </div>
      <button
        className="toast-close"
        onClick={(e) => { e.stopPropagation(); onDismiss(note.id); }}
        aria-label="Dismiss"
      >
        <Icon name="close" size={13}/>
      </button>
    </div>
  );
}

export function Toasts({ toasts, onDismiss, onOpen }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map(note => (
        <Toast key={note.id} note={note} onDismiss={onDismiss} onOpen={onOpen}/>
      ))}
    </div>
  );
}
