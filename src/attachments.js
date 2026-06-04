/* Attachment helpers — file-type classification, byte/time formatting,
 * a deterministic hue for striped placeholders, and a small hook that
 * resolves an authed object-URL for image previews/downloads.
 *
 * Classification prefers the real `mimetype` and falls back to the file
 * extension (matching the prototype's `classify()`).
 */

import { useEffect, useState } from 'react';

/* extension → kind, when we have no usable mimetype */
const EXT_KIND = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', heic: 'image',
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', rtf: 'doc',
  txt: 'mono', md: 'mono',
  csv: 'sheet', xls: 'sheet', xlsx: 'sheet',
  zip: 'zip', tar: 'zip', gz: 'zip',
  mp4: 'media', mov: 'media', webm: 'media', mp3: 'media', wav: 'media',
  har: 'mono', log: 'mono', json: 'mono', js: 'mono', ts: 'mono', html: 'mono', sql: 'mono',
};

/* kind → colour class used by `.att-ext--*` chips */
const KIND_EXT_CLASS = {
  image: 'mono', pdf: 'pdf', doc: 'doc', sheet: 'sheet',
  zip: 'zip', media: 'media', mono: 'mono', file: 'mono',
};

export function classify(filename = '', mimetype = '') {
  const ext = (String(filename).split('.').pop() || '').toLowerCase();
  const mt  = (mimetype || '').toLowerCase();

  let kind;
  if (mt.startsWith('image/')) kind = 'image';
  else if (mt === 'application/pdf') kind = 'pdf';
  else if (mt.startsWith('video/') || mt.startsWith('audio/')) kind = 'media';
  else if (mt === 'text/csv' || mt.includes('spreadsheet')) kind = 'sheet';
  else if (mt.includes('word') || mt === 'application/rtf') kind = 'doc';
  else if (mt.includes('zip') || mt.includes('compressed')) kind = 'zip';
  else kind = EXT_KIND[ext] || (mt.startsWith('text/') ? 'mono' : 'file');

  return {
    ext,
    kind,
    extClass: KIND_EXT_CLASS[kind] || 'mono',
    isImage: kind === 'image',
    label: (ext || 'file').slice(0, 4).toUpperCase(),
  };
}

export function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
}

export function relTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.round(s / 86400) + 'd ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* deterministic hue 0..359 for the striped placeholder thumbnails */
export function hueForName(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 37 + seed.charCodeAt(i)) % 360;
  return h;
}

/* `source` is derived, never stored: messageid set ⇒ message-level */
export function attachmentSource(att) {
  return att?.messageid != null ? 'message' : 'task';
}

/* ------------------------------------------------------------------ *
 * useAttachmentUrl — resolves a usable URL for an image/file.
 *
 *  - blob:/data: URLs (mock + optimistic uploads) are used as-is.
 *  - a real backend href is fetched with auth via `resolver(att)`,
 *    which returns an object-URL; revoked on unmount.
 *  - returns null when there's no url yet (callers render a placeholder).
 * ------------------------------------------------------------------ */
export function useAttachmentUrl(att, resolver) {
  const direct = att?.url && /^(blob:|data:)/.test(att.url) ? att.url : null;
  const [url, setUrl] = useState(direct);

  useEffect(() => {
    let cancelled = false;
    let created = null;

    if (!att?.url) { setUrl(null); return; }
    if (/^(blob:|data:)/.test(att.url)) { setUrl(att.url); return; }
    if (!resolver) { setUrl(null); return; }

    resolver(att)
      .then(u => { if (!cancelled) { created = u; setUrl(u); } })
      .catch(() => { if (!cancelled) setUrl(null); });

    return () => {
      cancelled = true;
      if (created && created.startsWith('blob:')) URL.revokeObjectURL(created);
    };
  }, [att?.attachmentid, att?.url, resolver]);

  return url;
}

/* Trigger a browser download for an attachment, fetching authed bytes
 * first so the OAuth token is honoured. */
export async function downloadAttachment(att, resolver) {
  try {
    const url = (att?.url && /^(blob:|data:)/.test(att.url)) ? att.url
      : resolver ? await resolver(att) : att?.url;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = att?.filename || 'download';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch { /* best-effort */ }
}
