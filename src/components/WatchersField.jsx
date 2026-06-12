/* Watchers field — who gets notified about everything on this task.
 *
 * Backed by /v2/taskwatchers (taskid, userid). Any user can be added as
 * a watcher (unlike assignees there is no org/module eligibility rule —
 * managers outside the module need to watch too). Reuses the assg-*
 * popover styling from AssigneesField for a consistent look.
 *
 * Side-effects on add/remove (activity log + notification) are the
 * parent's job via onWatcherAdded / onWatcherRemoved — this component
 * only owns the taskwatchers rows.
 */

import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { Icon } from './Icons.jsx';
import { Avatar } from './Shared.jsx';

const POP_WIDTH  = 260;
const POP_HEIGHT = 320;
const POP_GAP    = 6;
const VIEWPORT_MARGIN = 8;

export function WatchersField({ taskId, users = [], usersById = {}, api, disabled, onWatcherAdded, onWatcherRemoved }) {
  const [watchers, setWatchers] = useState([]);
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const rootRef    = useRef(null);
  const triggerRef = useRef(null);
  const popRef     = useRef(null);
  const [popStyle, setPopStyle] = useState({ position: 'fixed', top: 0, left: 0, width: POP_WIDTH, visibility: 'hidden' });

  /* Load watcher rows when the task changes. */
  useEffect(() => {
    if (disabled || taskId == null) { setWatchers([]); return; }
    let cancelled = false;
    api.listWatchers(taskId)
      .then(rows => { if (!cancelled) setWatchers(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setWatchers([]); });
    return () => { cancelled = true; };
  }, [api, taskId, disabled]);

  /* Close on outside click + Escape. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target) &&
          popRef.current  && !popRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /* Fixed-position popover, clamped to the viewport (same as assignees). */
  const reposition = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ph = popRef.current ? popRef.current.offsetHeight : POP_HEIGHT;

    let top = r.bottom + POP_GAP;
    if (top + ph > vh - VIEWPORT_MARGIN) {
      const flipped = r.top - ph - POP_GAP;
      top = flipped >= VIEWPORT_MARGIN ? flipped : Math.max(VIEWPORT_MARGIN, vh - ph - VIEWPORT_MARGIN);
    }
    let left = r.right - POP_WIDTH;
    if (left + POP_WIDTH > vw - VIEWPORT_MARGIN) left = vw - POP_WIDTH - VIEWPORT_MARGIN;
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

    setPopStyle({ position: 'fixed', top, left, width: POP_WIDTH, visibility: 'visible' });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPopStyle((s) => ({ ...s, visibility: 'hidden' }));
      return;
    }
    reposition();
    const onMove = () => reposition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, reposition]);

  const watchingIds = useMemo(() => new Set(watchers.map(w => w.userid)), [watchers]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u => (u.name || u.username || '').toLowerCase().includes(q));
  }, [users, query]);

  /* ----- mutations (optimistic) ----- */
  const addOne = async (userid) => {
    if (watchingIds.has(userid)) return;
    const optimistic = [...watchers, { taskid: taskId, userid }];
    setWatchers(optimistic);
    try {
      await api.addWatcher({ taskid: taskId, userid });
      onWatcherAdded?.(userid);
    } catch (err) {
      setWatchers(watchers);
      alert('Could not add watcher: ' + (err?.message || err));
    }
  };

  const removeOne = async (userid) => {
    setWatchers(watchers.filter(w => w.userid !== userid));
    try {
      await api.removeWatcher(taskId, userid);
      onWatcherRemoved?.(userid);
    } catch (err) {
      setWatchers(watchers);
      alert('Could not remove watcher: ' + (err?.message || err));
    }
  };

  const stackLimit = 4;
  const visible = watchers.slice(0, stackLimit);
  const overflow = watchers.length - visible.length;

  return (
    <div className="assg" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="sidefield-btn assg-trigger"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        title={disabled ? 'Save the task to add watchers' : undefined}
      >
        {watchers.length === 0 ? (
          <>
            <Icon name="bell" size={12}/>
            <span className="assg-empty">{disabled ? 'Save the task to add watchers' : 'Add watchers'}</span>
          </>
        ) : (
          <>
            <span className="assg-stack" style={{ '--n': visible.length }}>
              {visible.map((w, i) => (
                <span key={w.userid} className="assg-stack-item" style={{ zIndex: stackLimit - i }}>
                  <Avatar user={usersById[w.userid] || { username: `User ${w.userid}` }} size={20}/>
                </span>
              ))}
              {overflow > 0 && (
                <span className="assg-stack-item assg-overflow" style={{ zIndex: 0 }}>+{overflow}</span>
              )}
            </span>
            <span className="assg-summary">
              {watchers.length} watcher{watchers.length === 1 ? '' : 's'}
            </span>
            <Icon name="chevron-d" size={11}/>
          </>
        )}
      </button>

      {open && (
        <div className="assg-pop" ref={popRef} style={popStyle} role="dialog" aria-label="Watchers">
          <div className="assg-search">
            <Icon name="search" size={13}/>
            <input
              autoFocus
              type="text"
              placeholder="Search people…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="assg-list">
            {filteredUsers.length === 0 ? (
              <div className="assg-empty-state">
                {query ? `No users match "${query}"` : 'No users available.'}
              </div>
            ) : filteredUsers.map(u => {
              const watching = watchingIds.has(u.userid);
              return (
                <div key={u.userid} className={`assg-row${watching ? ' assg-row-on' : ''}`}>
                  <button
                    type="button"
                    className="assg-row-main"
                    onClick={() => watching ? removeOne(u.userid) : addOne(u.userid)}
                  >
                    <span className={`assg-check${watching ? ' assg-check-on' : ''}`}>
                      {watching && <Icon name="check" size={10}/>}
                    </span>
                    <Avatar user={u} size={20}/>
                    <span className="assg-name">{u.name || u.username}</span>
                    {u.name && u.username && u.name !== u.username && (
                      <span className="assg-handle">{u.username}</span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
