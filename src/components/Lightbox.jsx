/* Full-screen image viewer. Walks ALL of the task's images (one shared
 * sorted list) regardless of whether the click came from a card or a
 * message. Keyboard: ←/→ to move, Esc to close. Backdrop click closes;
 * clicking the frame does not.
 */

import React, { useEffect } from 'react';
import { Icon } from './Icons.jsx';
import { AttachmentImage } from './AttachmentThumb.jsx';
import { fmtBytes, relTime, hueForName, downloadAttachment } from '../attachments.js';

export function Lightbox({ images, index, onClose, onIndex, resolver, usersById }) {
  const safeIndex = Math.min(Math.max(index, 0), images.length - 1);
  const att = images[safeIndex];

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowLeft' && safeIndex > 0) { e.preventDefault(); onIndex(safeIndex - 1); }
      else if (e.key === 'ArrowRight' && safeIndex < images.length - 1) { e.preventDefault(); onIndex(safeIndex + 1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [safeIndex, images.length, onClose, onIndex]);

  if (!att) return null;
  const user = usersById?.[att.userid] || (att.username ? { username: att.username, name: att.username } : null);

  return (
    <div className="lb-overlay" onClick={onClose}>
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="lb-name">{att.filename}</div>
          <div className="lb-sub">
            {fmtBytes(att.filesize)}
            {user && <> · {user.name || user.username}</>}
            {att.creationdate && <> · {relTime(att.creationdate)}</>}
            {' · '}{safeIndex + 1} of {images.length}
          </div>
        </div>
        <span className="spacer"/>
        <button className="lb-btn" onClick={() => downloadAttachment(att, resolver)}>
          <Icon name="download" size={14}/> Download
        </button>
        <button className="lb-icon" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <Icon name="close" size={18}/>
        </button>
      </div>

      <div className="lb-stage" onClick={onClose}>
        <button
          className="lb-nav"
          disabled={safeIndex === 0}
          onClick={(e) => { e.stopPropagation(); onIndex(safeIndex - 1); }}
          aria-label="Previous"
        ><Icon name="chevron-l" size={18}/></button>

        <div
          className="lb-frame"
          style={{ '--thumb-hue': hueForName(att.filename || '') }}
          onClick={(e) => e.stopPropagation()}
        >
          <AttachmentImage att={att} resolver={resolver} tagClassName="lb-frame-tag"/>
        </div>

        <button
          className="lb-nav"
          disabled={safeIndex === images.length - 1}
          onClick={(e) => { e.stopPropagation(); onIndex(safeIndex + 1); }}
          aria-label="Next"
        ><Icon name="chevron-r" size={18}/></button>
      </div>
    </div>
  );
}
