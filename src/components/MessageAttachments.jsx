/* Inline attachments under a chat message: images render as thumbnails
 * (→ lightbox), everything else as a file chip with size + download. */

import React from 'react';
import { Icon } from './Icons.jsx';
import { AttachmentImage } from './AttachmentThumb.jsx';
import { classify, fmtBytes, hueForName, downloadAttachment } from '../attachments.js';

export function MessageAttachments({ atts, onOpenImage, resolver }) {
  if (!atts || atts.length === 0) return null;
  return (
    <div className="msg-att">
      {atts.map((a) => {
        const { isImage, extClass, label } = classify(a.filename, a.mimetype);
        if (isImage) {
          return (
            <div
              key={a.attachmentid}
              className="msg-att-img"
              style={{ '--thumb-hue': hueForName(a.filename || '') }}
              onClick={() => onOpenImage?.(a)}
            >
              <AttachmentImage att={a} resolver={resolver}/>
              <span className="att-zoom"><Icon name="expand" size={16}/></span>
            </div>
          );
        }
        return (
          <div
            key={a.attachmentid}
            className="msg-att-chip"
            title={a.filename}
            onClick={() => downloadAttachment(a, resolver)}
          >
            <span className={`msg-att-chip-ico att-ext--${extClass}`}>{label}</span>
            <span className="msg-att-chip-main">
              <span className="msg-att-chip-name">{a.filename}</span>
              <span className="msg-att-chip-sub">{fmtBytes(a.filesize)}</span>
            </span>
            <span className="msg-att-chip-dl"><Icon name="download" size={14}/></span>
          </div>
        );
      })}
    </div>
  );
}
