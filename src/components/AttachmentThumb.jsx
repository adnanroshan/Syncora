/* Renders an attachment's image: a real <img> once an (authed) object-URL
 * resolves, otherwise the prototype's striped placeholder + filename tag.
 * Used by attachment cards/rows, message thumbnails, and the lightbox. */

import React from 'react';
import { useAttachmentUrl, hueForName } from '../attachments.js';

export function AttachmentImage({ att, resolver, tagClassName = 'att-thumb-tag' }) {
  const url = useAttachmentUrl(att, resolver);
  if (url) {
    return (
      <img
        src={url}
        alt={att.filename}
        draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />
    );
  }
  return (
    <>
      <div className="att-thumb" style={{ '--thumb-hue': hueForName(att.filename || '') }}/>
      <span className={tagClassName}>{att.filename}</span>
    </>
  );
}
