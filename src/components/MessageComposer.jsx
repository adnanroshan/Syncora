/* Composer used both for top-level messages and inline replies/edits.
 *
 * Features:
 *  - `@` typeahead against `mentionCandidates`
 *  - ⌘↵ / Ctrl+↵ to send (also Send button)
 *  - autoresize up to 220px
 *  - `compact` mode drops the avatar slot (used inside edit-in-place)
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { Avatar } from './Shared.jsx';

function useMentionTypeahead(value, caret, candidates) {
  const upToCaret = value.slice(0, caret);
  const tokenMatch = upToCaret.match(/(?:^|\s)@([a-zA-Z0-9_.\-]*)$/);
  if (!tokenMatch) return { open: false, query: '', start: -1, end: -1, matches: [] };
  const query = tokenMatch[1];
  const start = upToCaret.length - query.length - 1;
  const end   = caret;
  const matches = candidates
    .filter(u => {
      const q = query.toLowerCase();
      return !q
        || (u.username || '').toLowerCase().startsWith(q)
        || (u.name || '').toLowerCase().includes(q);
    })
    .slice(0, 6);
  return { open: matches.length > 0, query, start, end, matches };
}

export function MessageComposer({
  currentUser,
  mentionCandidates = [],
  placeholder = 'Write a message… use @ to mention',
  autoFocus = false,
  compact = false,
  onSend,
  onCancel,
  initialValue = '',
}) {
  const [value, setValue]         = useState(initialValue);
  const [caret, setCaret]         = useState(initialValue.length);
  const [highlight, setHighlight] = useState(0);
  const textareaRef = useRef(null);

  const ta = useMentionTypeahead(value, caret, mentionCandidates);
  useEffect(() => { setHighlight(0); }, [ta.query, ta.open]);

  const grow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
  };
  useEffect(grow, [value]);

  const insertMention = (user) => {
    if (!user) return;
    const before = value.slice(0, ta.start);
    const after  = value.slice(ta.end);
    const insertion = `@${user.username} `;
    const next = before + insertion + after;
    setValue(next);
    const newCaret = (before + insertion).length;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newCaret, newCaret);
      setCaret(newCaret);
    });
  };

  const submit = () => {
    const t = value.trim();
    if (!t) return;
    onSend?.(t);
    setValue('');
    setCaret(0);
    requestAnimationFrame(grow);
  };

  const onKeyDown = (e) => {
    if (ta.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, ta.matches.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(ta.matches[highlight]);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  const onChange = (e) => { setValue(e.target.value); setCaret(e.target.selectionStart); };
  const onSelect = (e) => setCaret(e.target.selectionStart);

  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => textareaRef.current?.focus());
  }, [autoFocus]);

  return (
    <div className={`chat-composer ${compact ? 'is-compact' : ''}`}>
      {!compact && <Avatar user={currentUser} name={currentUser?.username} size={26}/>}
      <div className="chat-composer-main">
        <div className="chat-composer-input-wrap">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={onChange}
            onSelect={onSelect}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={1}
            spellCheck="true"
          />
          {ta.open && (
            <div className="chat-mention-pop" role="listbox">
              <div className="chat-mention-pop-head">
                {ta.query ? `Members matching “${ta.query}”` : 'Mention a member'}
              </div>
              {ta.matches.map((u, i) => (
                <button
                  key={u.userid}
                  className={`chat-mention-popitem ${i === highlight ? 'is-active' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  <Avatar user={u} name={u.username} size={20}/>
                  <span className="chat-mention-popitem-name">{u.name || u.username}</span>
                  <span className="chat-mention-popitem-handle">@{u.username}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="chat-composer-bar">
          <button
            type="button"
            className="chat-tool"
            title="Mention someone (@)"
            onMouseDown={(e) => {
              e.preventDefault();
              const el = textareaRef.current;
              if (!el) return;
              const pos = el.selectionStart ?? value.length;
              const before = value.slice(0, pos);
              const after  = value.slice(pos);
              const needsSpace = before.length && !/\s$/.test(before);
              const insertion = `${needsSpace ? ' ' : ''}@`;
              const next = before + insertion + after;
              setValue(next);
              const newCaret = (before + insertion).length;
              requestAnimationFrame(() => {
                el.focus();
                el.setSelectionRange(newCaret, newCaret);
                setCaret(newCaret);
              });
            }}
          ><Icon name="at" size={13}/></button>
          <button type="button" className="chat-tool" title="Attach file"><Icon name="paperclip" size={13}/></button>
          <button type="button" className="chat-tool" title="Insert image"><Icon name="image" size={13}/></button>
          <button type="button" className="chat-tool" title="Add emoji"><Icon name="smile" size={13}/></button>
          <span className="spacer"/>
          {onCancel && (
            <button type="button" className="chat-cancel" onClick={onCancel}>Cancel</button>
          )}
          <span className="chat-composer-hint">⌘↵</span>
          <button
            type="button"
            className="chat-send"
            onClick={submit}
            disabled={!value.trim()}
          >
            <Icon name="send" size={11}/>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
