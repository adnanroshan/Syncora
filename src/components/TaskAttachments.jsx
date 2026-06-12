/* Task-level Attachments section (sibling of Subtasks).
 *
 * Rolls up BOTH task files (messageid == null) and message files
 * (messageid set, shown with a "from message" badge). Grid/list toggle,
 * an All / Files / From discussion filter (only when there are message
 * files to split), full drag-and-drop, and optimistic upload/failed
 * states with retry.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { Avatar } from './Shared.jsx';
import { AttachmentImage } from './AttachmentThumb.jsx';
import { classify, fmtBytes, relTime, hueForName, attachmentSource } from '../attachments.js';

export function TaskAttachments({
  atts, currentUser, usersById, view, setView,
  onAdd, onDelete, onRetry, onOpenImage, onJumpMessage,
  onDownload, onCopyLink, resolver,
}) {
  const [filter, setFilter] = useState('all'); // all | files | discussion
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const dragDepth = useRef(0);

  const withSource = useMemo(
    () => atts.map(a => ({ ...a, source: attachmentSource(a) })),
    [atts],
  );

  const visible = useMemo(() => {
    let list = withSource.slice().sort((a, b) => new Date(b.creationdate) - new Date(a.creationdate));
    if (filter === 'files') list = list.filter(a => a.source === 'task');
    if (filter === 'discussion') list = list.filter(a => a.source === 'message');
    return list;
  }, [withSource, filter]);

  const counts = useMemo(() => ({
    all: withSource.length,
    files: withSource.filter(a => a.source === 'task').length,
    discussion: withSource.filter(a => a.source === 'message').length,
  }), [withSource]);

  const pickFiles = () => fileInput.current?.click();

  const handleDrop = (e) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) onAdd(files);
  };

  const canDelete = (a) => a.userid === currentUser?.userid;

  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <span>Attachments {counts.all > 0 && <span className="ds-count">· {counts.all}</span>}</span>
        <div className="att-head-tools">
          {counts.all > 0 && (
            <div className="att-seg" role="tablist" aria-label="View">
              <button className={view === 'grid' ? 'is-active' : ''} onClick={() => setView('grid')} title="Grid view"><Icon name="grid" size={12}/></button>
              <button className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')} title="List view"><Icon name="list" size={12}/></button>
            </div>
          )}
          <button className="att-add" onClick={pickFiles}>
            <Icon name="plus" size={12}/> Add
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => {
              const files = [...(e.target.files || [])];
              if (files.length) onAdd(files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {counts.discussion > 0 && counts.all > 0 && (
        <div className="att-seg att-filter">
          <button className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>All <span className="att-seg-n">{counts.all}</span></button>
          <button className={filter === 'files' ? 'is-active' : ''} onClick={() => setFilter('files')}>Files <span className="att-seg-n">{counts.files}</span></button>
          <button className={filter === 'discussion' ? 'is-active' : ''} onClick={() => setFilter('discussion')}><Icon name="chat" size={11}/> From discussion <span className="att-seg-n">{counts.discussion}</span></button>
        </div>
      )}

      {counts.all === 0 ? (
        <div
          className="att-empty"
          onClick={pickFiles}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <Icon name="upload" size={20}/>
          <span className="att-empty-title">Drop files or click to attach</span>
          <span className="att-empty-sub">Screenshots, logs, PDFs, HAR captures — anything the team needs on this task.</span>
        </div>
      ) : (
        <div
          className={`att-zone ${dragging ? 'is-dragging' : ''}`}
          onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragging(true); }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }}
          onDrop={handleDrop}
        >
          <div className="att-drop-label"><Icon name="upload" size={16}/> Drop to attach to this task</div>

          {view === 'grid' ? (
            <div className="att-grid">
              {visible.map(a => (
                <AttCard key={a.attachmentid} a={a} user={usersById?.[a.userid]} canDelete={canDelete(a)}
                  onDelete={onDelete} onRetry={onRetry} onOpenImage={onOpenImage} onJumpMessage={onJumpMessage}
                  onDownload={onDownload} onCopyLink={onCopyLink} resolver={resolver}/>
              ))}
            </div>
          ) : (
            <div className="att-list">
              {visible.map(a => (
                <AttRow key={a.attachmentid} a={a} user={usersById?.[a.userid]} canDelete={canDelete(a)}
                  onDelete={onDelete} onRetry={onRetry} onOpenImage={onOpenImage} onJumpMessage={onJumpMessage}
                  onDownload={onDownload} onCopyLink={onCopyLink} resolver={resolver}/>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function SourceBadge({ a, onJumpMessage }) {
  if (a.source !== 'message') return null;
  return (
    <span
      className="att-src"
      title="Attached in discussion — jump to message"
      onClick={(e) => { e.stopPropagation(); onJumpMessage?.(a.messageid); }}
    >
      <Icon name="chat" size={10}/> from message
    </span>
  );
}

function AttCard({ a, user, canDelete, onDelete, onRetry, onOpenImage, onJumpMessage, onDownload, onCopyLink, resolver }) {
  const { isImage, extClass, label } = classify(a.filename, a.mimetype);
  const uploading = a.status === 'uploading';
  const failed = a.status === 'failed';

  return (
    <div className={`att-card ${failed ? 'is-failed' : ''}`}>
      {!uploading && (
        <div className="att-actions">
          {failed ? (
            <button className="att-act" title="Retry" onClick={() => onRetry(a)}><Icon name="refresh" size={13}/></button>
          ) : (
            <>
              <button className="att-act" title="Download" onClick={() => onDownload?.(a)}><Icon name="download" size={13}/></button>
              <button className="att-act" title="Copy link" onClick={() => onCopyLink?.(a)}><Icon name="link" size={13}/></button>
            </>
          )}
          {(canDelete || failed) && <button className="att-act is-danger" title="Remove" onClick={() => onDelete(a)}><Icon name="trash" size={13}/></button>}
        </div>
      )}

      {isImage ? (
        <div
          className="att-card-preview"
          style={{ '--thumb-hue': hueForName(a.filename || '') }}
          onClick={() => !uploading && !failed && onOpenImage(a)}
        >
          <AttachmentImage att={a} resolver={resolver}/>
          {uploading && <span className="att-uploading-badge"><Icon name="spinner" size={10} className="att-spin"/> {a.progress ?? 0}%</span>}
          {failed && <span className="att-failed-badge"><Icon name="alert" size={10}/> Failed</span>}
          {!uploading && !failed && <span className="att-zoom"><Icon name="expand" size={16}/></span>}
        </div>
      ) : (
        <div className="att-extwrap" style={{ position: 'relative' }}>
          <span className={`att-ext att-ext--${extClass}`}>{label}</span>
          {uploading && <span className="att-uploading-badge"><Icon name="spinner" size={10} className="att-spin"/> {a.progress ?? 0}%</span>}
          {failed && <span className="att-failed-badge"><Icon name="alert" size={10}/> Failed</span>}
        </div>
      )}

      <div className="att-card-meta">
        <span className="att-name" title={a.filename}>{a.filename}</span>
        <span className="att-sub">
          {failed ? <span style={{ color: 'var(--danger)' }}>Upload failed · {fmtBytes(a.filesize)}</span>
            : uploading ? <span>Uploading · {fmtBytes(a.filesize)}</span>
            : <><span>{fmtBytes(a.filesize)}</span><span className="att-dot"/><Avatar user={user} name={a.username} size={13}/><span>{relTime(a.creationdate)}</span></>}
        </span>
        {!uploading && !failed && <SourceBadge a={a} onJumpMessage={onJumpMessage}/>}
      </div>

      {uploading && <div className="att-progress"><div className="att-progress-fill" style={{ width: (a.progress ?? 0) + '%' }}/></div>}
    </div>
  );
}

function AttRow({ a, user, canDelete, onDelete, onRetry, onOpenImage, onJumpMessage, onDownload, onCopyLink, resolver }) {
  const { isImage, extClass, label } = classify(a.filename, a.mimetype);
  const uploading = a.status === 'uploading';
  const failed = a.status === 'failed';
  const clickable = isImage && !uploading && !failed;

  return (
    <div
      className={`att-row ${failed ? 'is-failed' : ''}`}
      onClick={() => clickable && onOpenImage(a)}
      style={{ cursor: clickable ? 'pointer' : 'default' }}
    >
      <div
        className={`att-row-ico ${isImage ? '' : 'att-ext--' + extClass}`}
        style={isImage ? { '--thumb-hue': hueForName(a.filename || '') } : null}
      >
        {isImage ? <AttachmentImage att={a} resolver={resolver}/> : label}
      </div>
      <div className="att-row-main">
        <span className="att-name" title={a.filename}>{a.filename}</span>
        <span className="att-sub">
          {failed ? <span style={{ color: 'var(--danger)' }}>Upload failed</span>
            : uploading ? <span>Uploading… {a.progress ?? 0}%</span>
            : <><Avatar user={user} name={a.username} size={12}/><span>{(user?.name || a.username || '').split(' ')[0]}</span><span className="att-dot"/><span>{relTime(a.creationdate)}</span></>}
          {!uploading && !failed && a.source === 'message' && <><span className="att-dot"/><SourceBadge a={a} onJumpMessage={onJumpMessage}/></>}
        </span>
      </div>
      <div className="att-row-right">
        {!uploading && !failed && <span className="att-row-size">{fmtBytes(a.filesize)}</span>}
        <div className="att-row-actions" onClick={(e) => e.stopPropagation()}>
          {failed ? <button className="att-act" title="Retry" onClick={() => onRetry(a)}><Icon name="refresh" size={13}/></button>
            : !uploading && <>
              <button className="att-act" title="Download" onClick={() => onDownload?.(a)}><Icon name="download" size={13}/></button>
              <button className="att-act" title="Copy link" onClick={() => onCopyLink?.(a)}><Icon name="link" size={13}/></button>
            </>}
          {(canDelete || failed) && !uploading && <button className="att-act is-danger" title="Remove" onClick={() => onDelete(a)}><Icon name="trash" size={13}/></button>}
        </div>
      </div>
      {uploading && <div className="att-progress"><div className="att-progress-fill" style={{ width: (a.progress ?? 0) + '%' }}/></div>}
    </div>
  );
}
