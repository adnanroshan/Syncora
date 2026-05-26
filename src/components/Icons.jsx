/* Tiny inline SVG icon set — stroke-based, 16px default. */

import React from 'react';

export function Icon({ name, size = 16, className = '', style = {} }) {
  const s = { width: size, height: size, ...style };
  const common = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
    className, style: s,
  };
  switch (name) {
    case 'inbox':     return <svg {...common}><path d="M3 13l2-7h14l2 7"/><path d="M3 13v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6"/><path d="M3 13h5l1 3h6l1-3h5"/></svg>;
    case 'today':     return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/><circle cx="12" cy="14" r="2" fill="currentColor"/></svg>;
    case 'mytasks':   return <svg {...common}><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>;
    case 'all':       return <svg {...common}><path d="M4 6h16M4 12h16M4 18h16"/></svg>;
    case 'board':     return <svg {...common}><rect x="3" y="4" width="6" height="16" rx="1.5"/><rect x="11" y="4" width="6" height="10" rx="1.5"/><rect x="19" y="4" width="2" height="6" rx="1"/></svg>;
    case 'calendar':  return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/></svg>;
    case 'list':      return <svg {...common}><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6"  r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>;
    case 'group':     return <svg {...common}><path d="M3 6h7M3 12h11M3 18h7"/><path d="M14 6h7M17 12h4M14 18h7"/></svg>;
    case 'filter':    return <svg {...common}><path d="M3 5h18l-7 9v5l-4 2v-7L3 5z"/></svg>;
    case 'search':    return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>;
    case 'plus':      return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
    case 'chevron-r': return <svg {...common}><path d="M9 6l6 6-6 6"/></svg>;
    case 'chevron-d': return <svg {...common}><path d="M6 9l6 6 6-6"/></svg>;
    case 'chevron-l': return <svg {...common}><path d="M15 6l-6 6 6 6"/></svg>;
    case 'close':     return <svg {...common}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case 'more':      return <svg {...common}><circle cx="5"  cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>;
    case 'link':      return <svg {...common}><path d="M10 14a4 4 0 0 1 0-6l3-3a4 4 0 1 1 6 6l-1 1"/><path d="M14 10a4 4 0 0 1 0 6l-3 3a4 4 0 1 1-6-6l1-1"/></svg>;
    case 'attach':    return <svg {...common}><path d="M21 12l-8.5 8.5a5 5 0 0 1-7-7L13 5a3.5 3.5 0 1 1 5 5L9.5 18.5a2 2 0 1 1-3-3L14 8"/></svg>;
    case 'check':     return <svg {...common}><path d="M5 12l5 5L20 7"/></svg>;
    case 'tag':       return <svg {...common}><path d="M20 12l-8 8a2 2 0 0 1-2.8 0L3 13.8V4h9.8L20 11.2a.6.6 0 0 1 0 .8z"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>;
    case 'trash':     return <svg {...common}><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v7M14 11v7"/></svg>;
    case 'bell':      return <svg {...common}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>;
    case 'settings':  return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>;
    case 'sort':      return <svg {...common}><path d="M7 4v16M7 4l-3 3M7 4l3 3"/><path d="M17 20V4M17 20l-3-3M17 20l3-3"/></svg>;
    case 'sparkle':   return <svg {...common}><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/></svg>;
    case 'sun':       return <svg {...common}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>;
    case 'moon':      return <svg {...common}><path d="M20 14.5A8 8 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>;
    case 'logo':      return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={s} className={className}>
        <circle cx="9"  cy="12" r="6" fill="currentColor" opacity="0.55"/>
        <circle cx="15" cy="12" r="6" fill="currentColor"/>
      </svg>
    );
    default: return null;
  }
}

export function StatusGlyph({ status, size = 14 }) {
  const s = { width: size, height: size, flexShrink: 0 };
  const common = { width: size, height: size, viewBox: '0 0 24 24', style: s };
  switch (status) {
    case 'todo':
      return <svg {...common}><circle cx="12" cy="12" r="8" fill="none" stroke="var(--status-todo-text)" strokeWidth="1.75" strokeDasharray="2 2"/></svg>;
    case 'inprogress':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" fill="none" stroke="var(--status-progress-text)" strokeWidth="1.75"/>
          <path d="M12 4 A8 8 0 0 1 20 12 L12 12 Z" fill="var(--status-progress-text)"/>
        </svg>
      );
    case 'done':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" fill="var(--status-done-text)"/>
          <path d="M8 12l3 3 5-6" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      );
    case 'blocked':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" fill="none" stroke="var(--status-blocked-text)" strokeWidth="1.75"/>
          <path d="M8 8l8 8M16 8l-8 8" stroke="var(--status-blocked-text)" strokeWidth="1.75" strokeLinecap="round"/>
        </svg>
      );
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8" fill="none" stroke="var(--text-faint)" strokeWidth="1.75"/></svg>;
  }
}
