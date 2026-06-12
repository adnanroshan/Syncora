/* Local-storage backed user preferences for theme/density/accent.
   Persists across reloads but is per-user-per-device. No server roundtrip. */

import { useState, useEffect } from 'react';

const KEY = 'syncora.prefs.v1';

const DEFAULTS = {
  theme:    'light',
  density:  'compact',
  accent:   '#0F6E56',
  sidebarCollapsed: false,
  /* Task detail layout: 'side' (right rail) or 'center' (floating modal). */
  panelMode: 'side',
};

const ACCENT_BG = {
  '#0F6E56': '#E1F5EE',
  '#4C5BD4': '#EAEBFA',
  '#BA7517': '#FBEFD7',
  '#2D2D2D': '#E8E7E2',
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { return DEFAULTS; }
}

function save(prefs) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
}

export function usePreferences() {
  const [prefs, setPrefsState] = useState(load);

  // apply to <html> on every change
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme   = prefs.theme;
    root.dataset.density = prefs.density;
    root.style.setProperty('--accent',    prefs.accent);
    root.style.setProperty('--accent-bg', ACCENT_BG[prefs.accent] || '#E1F5EE');
  }, [prefs.theme, prefs.density, prefs.accent]);

  const setPrefs = (patch) => {
    setPrefsState(prev => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      save(next);
      return next;
    });
  };
  return [prefs, setPrefs];
}

/* ------------------------------------------------------------------ *
 * usePref — a single localStorage-backed value, namespaced under its
 * own key. Used for lightweight UI prefs that persist across reloads
 * but don't belong in the theme/density bundle (e.g. attachmentsView).
 * ------------------------------------------------------------------ */
export function usePref(key, defaultValue) {
  const storageKey = `syncora.pref.${key}`;
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw == null ? defaultValue : JSON.parse(raw);
    } catch { return defaultValue; }
  });

  const set = (next) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      try { localStorage.setItem(storageKey, JSON.stringify(resolved)); } catch {}
      return resolved;
    });
  };

  return [value, set];
}
