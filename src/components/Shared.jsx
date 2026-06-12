/* Small shared display primitives used everywhere. */

import React from 'react';

/* ---------- normalisation helpers ---------- */

export function normaliseStatus(s) {
  const v = (s || '').toLowerCase();
  if (v === 'todo' || v === 'to_do' || v === 'open')              return 'todo';
  if (v === 'inprogress' || v === 'in_progress' || v === 'doing') return 'inprogress';
  if (v === 'verified')                                           return 'verified';
  if (v === 'done' || v === 'completed' || v === 'closed')        return 'done';
  if (v === 'blocked')                                            return 'blocked';
  return 'other';
}

export function statusLabel(s) {
  return ({ todo:'To do', inprogress:'In progress', done:'Done', verified:'Verified', blocked:'Blocked', other:'Other' })[s] || s;
}

export function labelize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

export function shortLabel(name) {
  if (!name) return '·';
  const words = String(name).split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/* ---------- avatars + monograms ---------- */

const HUE_FALLBACK = [165, 28, 280, 210, 340, 50, 130, 95];
function deterministicHue(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return HUE_FALLBACK[Math.abs(h) % HUE_FALLBACK.length];
}

export function Avatar({ user, name, size = 20, title }) {
  // accepts either a structured user {name, hue, isMe} or just a display name.
  // Backend users often have no `name`, only `username` — fall back to it.
  const displayName = user?.name || user?.username || name;
  if (!displayName) {
    return (
      <span className="avatar avatar--empty"
            style={{ width: size, height: size, fontSize: size * 0.42 }}
            title={title || 'Unassigned'}>·</span>
    );
  }
  const initials = displayName
    .replace(/[._\-]/g, ' ')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0]).join('').toUpperCase();
  const hue = user?.hue ?? deterministicHue(displayName);
  const bg = `oklch(0.92 0.045 ${hue})`;
  const fg = `oklch(0.32 0.08 ${hue})`;
  return (
    <span className="avatar"
          style={{ width: size, height: size, fontSize: size * 0.42, background: bg, color: fg }}
          title={title || `Assigned by ${displayName}`}>
      {initials}
    </span>
  );
}

export function OrgMark({ org, size = 18 }) {
  if (!org) return null;
  const short = org.short || shortLabel(org.name);
  return (
    <span className="orgmark"
          style={{ width: size, height: size, fontSize: size * 0.5 }}
          title={org.name}>
      {short}
    </span>
  );
}

/* ---------- priority indicator (Linear-style bars) ---------- */

export function PriorityMark({ priority }) {
  const cfg = {
    urgent: { lit: 3, color: 'var(--priority-urgent)' },
    high:   { lit: 3, color: 'var(--priority-high)'   },
    medium: { lit: 2, color: 'var(--priority-medium)' },
    low:    { lit: 1, color: 'var(--priority-low)'    },
  }[priority] || { lit: 0, color: 'var(--priority-none)' };

  if (priority === 'urgent') {
    return (
      <span className="prio prio--urgent" title="Urgent">
        <svg width="14" height="14" viewBox="0 0 14 14">
          <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--priority-urgent)"/>
          <path d="M7 4v4M7 10v.5" stroke="white" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      </span>
    );
  }

  return (
    <span className="prio" title={priority ? `${priority} priority` : 'No priority'}>
      <span className="prio-bar" style={{ background: cfg.lit >= 1 ? cfg.color : 'var(--priority-none)' }}/>
      <span className="prio-bar" style={{ background: cfg.lit >= 2 ? cfg.color : 'var(--priority-none)' }}/>
      <span className="prio-bar" style={{ background: cfg.lit >= 3 ? cfg.color : 'var(--priority-none)' }}/>
    </span>
  );
}

/* ---------- due-date pill ---------- */

export function DueChip({ iso, compact = false }) {
  if (!iso) return <span className="due due--none">—</span>;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return <span className="due due--none">—</span>;
  const today = new Date(); today.setHours(0,0,0,0);
  const due   = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff  = Math.round((due - today) / 86400000);

  let text, cls = 'due';
  if (diff < 0)        { text = compact ? `${Math.abs(diff)}d late` : 'Overdue';                                   cls += ' due--overdue'; }
  else if (diff === 0) { text = 'Today';                                                                            cls += ' due--soon';    }
  else if (diff === 1) { text = 'Tomorrow';                                                                         cls += ' due--soon';    }
  else if (diff < 7)   { text = d.toLocaleDateString(undefined, { weekday: 'short' }); }
  else                 { text = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  return <span className={cls}>{text}</span>;
}

/* ---------- date formatting ---------- */

export function fmtFullDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtFullDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const t  = new Date(); t.setHours(0,0,0,0);
  const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return dd.getTime() === t.getTime();
}
