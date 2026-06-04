/* Composer used both for top-level messages and inline replies/edits.
 *
 * Features:
 *  - `@` typeahead against `mentionCandidates`
 *  - ⌘↵ / Ctrl+↵ to send (also Send button)
 *  - autoresize up to 220px
 *  - `compact` mode drops the avatar slot (used inside edit-in-place)
 *  - `enableAttachments` (top-level only): paperclip/image staging strip,
 *    paste-to-attach, drop-onto-composer, and send-gating while sending.
 *    Files upload AFTER the message is created (they need its messageid),
 *    so staging here just collects File objects to hand to `onSend`.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { Avatar } from './Shared.jsx';
import { classify, fmtBytes, hueForName } from '../attachments.js';

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

let _stageSeq = 0;

export function MessageComposer({
  currentUser,
  mentionCandidates = [],
  placeholder = 'Write a message… use @ to mention',
  autoFocus = false,
  compact = false,
  enableAttachments = false,
  onSend,
  onCancel,
  initialValue = '',
}) {
  const [value, setValue]         = useState(initialValue);
  const [caret, setCaret]         = useState(initialValue.length);
  const [highlight, setHighlight] = useState(0);
  const [staged, setStaged]       = useState([]); // { id, file }
  const [dragging, setDragging]   = useState(false);
  const [sending, setSending]     = useState(false);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  const imgRef  = useRef(null);

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

  /* ---- staging ---- */
  const addFiles = (files) => {
    const items = [...files].map(f => ({ id: ++_stageSeq, file: f }));
    if (items.length) setStaged(prev => [...prev, ...items]);
  };
  const removeStaged = (id) => setStaged(prev => prev.filter(s => s.id !== id));

  const onPaste = (e) => {
    if (!enableAttachments) return;
    const imgs = [...(e.clipboardData?.items || [])]
      .filter(i => i.kind === 'file' && i.type.startsWith('image/'))
      .map(i => i.getAsFile())
      .filter(Boolean);
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  };
  const onDrop = (e) => {
    if (!enableAttachments) return;
    e.preventDefault();
    setDragging(false);
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) addFiles(files);
  };

  const submit = async () => {
    if (sending) return;
    const t = value.trim();
    const files = staged.map(s => s.file);
    if (!t && files.length === 0) return;
    if (enableAttachments && files.length) {
      setSending(true);
      try {
        await onSend?.(t, files);
        setValue(''); setCaret(0); setStaged([]);
      } finally {
        setSending(false);
        requestAnimationFrame(grow);
      }
    } else {
      onSend?.(t, files);
      setValue(''); setCaret(0); setStaged([]);
      requestAnimationFrame(grow);
    }
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

  const sendDisabled = sending || (!value.trim() && staged.length === 0);

  return (
    <div
      className={`chat-composer ${compact ? 'is-compact' : ''} ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={enableAttachments ? (e) => { e.preventDefault(); setDragging(true); } : undefined}
      onDragOver={enableAttachments ? (e) => e.preventDefault() : undefined}
      onDragLeave={enableAttachments ? () => setDragging(false) : undefined}
      onDrop={enableAttachments ? onDrop : undefined}
    >
      {!compact && <Avatar user={currentUser} name={currentUser?.username} size={26}/>}
      <div className="chat-composer-main">
        <div className="chat-composer-input-wrap">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={onChange}
            onSelect={onSelect}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
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

        {enableAttachments && staged.length > 0 && (
          <div className="stage-strip">
            {staged.map(s => {
              const { isImage, extClass, label } = classify(s.file.name, s.file.type);
              return (
                <div key={s.id} className="stage-item">
                  <span
                    className={`stage-thumb ${isImage ? '' : 'att-ext--' + extClass}`}
                    style={isImage ? { '--thumb-hue': hueForName(s.file.name) } : null}
                  >
                    {isImage ? <span className="att-thumb" style={{ position: 'absolute', inset: 0 }}/> : label.slice(0, 3)}
                  </span>
                  <span className="stage-main">
                    <span className="stage-name" title={s.file.name}>{s.file.name}</span>
                    <span className="stage-size">{fmtBytes(s.file.size)}</span>
                  </span>
                  {!sending && (
                    <span className="stage-x" title="Remove" onClick={() => removeStaged(s.id)}><Icon name="close" size={9}/></span>
                  )}
                  {sending && <span className="stage-prog"><span className="stage-prog-fill stage-prog-indeterminate"/></span>}
                </div>
              );
            })}
          </div>
        )}

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
          <button
            type="button"
            className={`chat-tool ${enableAttachments && staged.length ? 'is-armed' : ''}`}
            title="Attach file"
            onClick={enableAttachments ? () => fileRef.current?.click() : undefined}
          ><Icon name="paperclip" size={13}/></button>
          <button
            type="button"
            className="chat-tool"
            title="Attach image"
            onClick={enableAttachments ? () => imgRef.current?.click() : undefined}
          ><Icon name="image" size={13}/></button>
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
            disabled={sendDisabled}
          >
            <Icon name="send" size={11}/>
            {sending ? 'Sending…' : 'Send'}
          </button>

          {enableAttachments && (
            <>
              <input ref={fileRef} type="file" multiple className="sr-only"
                onChange={(e) => { const f = [...(e.target.files || [])]; if (f.length) addFiles(f); e.target.value = ''; }}/>
              <input ref={imgRef} type="file" accept="image/*" multiple className="sr-only"
                onChange={(e) => { const f = [...(e.target.files || [])]; if (f.length) addFiles(f); e.target.value = ''; }}/>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
