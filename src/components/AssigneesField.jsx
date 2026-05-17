/* Assignees field
 * --------------------------------------------------------------
 *  Shown in the task detail panel as a SideField. Lets the user
 *  manage multiple assignees on a task, including which one is
 *  primary.
 *
 *  Eligibility: a user can only be assigned if they have access
 *  to the task's organisation AND to its module. The picker is
 *  disabled until both organisationid and moduleid are set.
 *
 *  Closed state:
 *    Stack of overlapping avatars (primary first with a small
 *    star badge), a "+N" pill if more than 3, and "Add assignees"
 *    when empty.
 *
 *  Open state (popover, position: fixed — same pattern as
 *  DueDatePicker): search input + a list of *eligible* users.
 *  Assigned rows have a check + a star toggle for primary;
 *  unassigned rows are click-to-assign.
 */

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { Icon } from './Icons.jsx';
import { Avatar } from './Shared.jsx';

const POP_WIDTH  = 300;
const POP_HEIGHT = 380;
const POP_GAP    = 6;
const VIEWPORT_MARGIN = 8;

export function AssigneesField({
  taskId, organisationid, productid, moduleid,
  users = [], usersById = {}, api, onChange, disabled = false,
}) {
  const [assignees, setAssignees] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [open, setOpen]           = useState(false);
  const [query, setQuery]         = useState('');
  const [eligibleIds, setEligibleIds] = useState(null); // null = still loading

  const triggerRef = useRef(null);
  const popRef     = useRef(null);
  const rootRef    = useRef(null);
  const [popStyle, setPopStyle] = useState({
    position: 'fixed', top: 0, left: 0, width: POP_WIDTH, visibility: 'hidden',
  });

  const scopeReady = organisationid != null && moduleid != null && productid != null;

  /* Load assignees whenever the task changes. */
  useEffect(() => {
    if (disabled || taskId == null) { setAssignees([]); return; }
    let cancelled = false;
    setLoading(true);
    api.listAssignees(taskId)
      .then((rows) => { if (!cancelled) setAssignees(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setAssignees([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId, api, disabled]);

  /* Recompute eligibility whenever org/product/module changes. Two
   * filtered calls (userorgs by org, userproductsmodules by product),
   * intersect by userid, then narrow to the specific moduleid client-
   * side. We avoid a compound AND filter so we don't depend on the
   * backend supporting it. */
  useEffect(() => {
    if (!scopeReady) { setEligibleIds(new Set()); return; }
    let cancelled = false;
    setEligibleIds(null);
    Promise.all([
      api.listOrgAccessRows(organisationid),
      api.listProductAccessRows(productid),
    ]).then(([orgRows, prodRows]) => {
      if (cancelled) return;
      const orgUsers = new Set((orgRows || []).map(r => r.userid));
      const modUsers = new Set(
        (prodRows || [])
          .filter(r => r.moduleid === moduleid)
          .map(r => r.userid)
      );
      const ids = new Set();
      orgUsers.forEach(uid => { if (modUsers.has(uid)) ids.add(uid); });
      setEligibleIds(ids);
    }).catch(() => { if (!cancelled) setEligibleIds(new Set()); });
    return () => { cancelled = true; };
  }, [api, organisationid, productid, moduleid, scopeReady]);

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

  /* Position the popover with fixed coords; clamp to viewport. */
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

  /* ----- derived ----- */
  const assignedIds = useMemo(
    () => new Set(assignees.map((a) => a.assigneduserid)),
    [assignees],
  );
  const primary = assignees.find((a) => a.isprimary) || assignees[0] || null;
  const ordered = useMemo(() => {
    const p = assignees.filter((a) => a.isprimary);
    const o = assignees.filter((a) => !a.isprimary);
    return [...p, ...o];
  }, [assignees]);

  /* Pickable users: eligible by org+module AND in the lookup list.
   * Always include people already assigned to the task even if they
   * lost access since — otherwise they couldn't be removed. */
  const eligibleUsers = useMemo(() => {
    if (eligibleIds == null) return [];
    return users.filter(u =>
      eligibleIds.has(u.userid) || assignedIds.has(u.userid)
    );
  }, [users, eligibleIds, assignedIds]);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return eligibleUsers;
    return eligibleUsers.filter((u) => {
      const name = (u.name || u.username || '').toLowerCase();
      return name.includes(q);
    });
  }, [eligibleUsers, query]);

  /* ----- mutations (optimistic) ----- */
  const broadcast = (next) => { setAssignees(next); onChange?.(next); };

  const addOne = async (userid) => {
    if (assignedIds.has(userid)) return;
    const u = usersById[userid] || users.find((x) => x.userid === userid);
    const isFirst = assignees.length === 0;
    const optimistic = [...assignees, {
      taskid: taskId,
      assigneduserid: userid,
      assignedusername: u?.username || u?.name || `User ${userid}`,
      isprimary: isFirst,
    }];
    broadcast(optimistic);
    try {
      await api.addAssignee({ taskid: taskId, assigneduserid: userid, isprimary: isFirst });
      const fresh = await api.listAssignees(taskId);
      broadcast(Array.isArray(fresh) ? fresh : optimistic);
    } catch (err) {
      broadcast(assignees);
      alert('Could not add assignee: ' + (err?.message || err));
    }
  };

  const removeOne = async (userid) => {
    const wasPrimary = !!assignees.find((a) => a.assigneduserid === userid)?.isprimary;
    const remaining  = assignees.filter((a) => a.assigneduserid !== userid);
    if (wasPrimary && remaining.length) remaining[0] = { ...remaining[0], isprimary: true };
    broadcast(remaining);
    try {
      await api.removeAssignee(taskId, userid);
      if (wasPrimary && remaining.length) {
        await api.setPrimaryAssignee(taskId, remaining[0].assigneduserid);
      }
      const fresh = await api.listAssignees(taskId);
      broadcast(Array.isArray(fresh) ? fresh : remaining);
    } catch (err) {
      broadcast(assignees);
      alert('Could not remove assignee: ' + (err?.message || err));
    }
  };

  const setPrimary = async (userid) => {
    const next = assignees.map((a) => ({ ...a, isprimary: a.assigneduserid === userid }));
    broadcast(next);
    try {
      await api.setPrimaryAssignee(taskId, userid);
      const fresh = await api.listAssignees(taskId);
      broadcast(Array.isArray(fresh) ? fresh : next);
    } catch (err) {
      broadcast(assignees);
      alert('Could not set primary: ' + (err?.message || err));
    }
  };

  /* ----- render ----- */
  const stackLimit = 3;
  const visibleStack = ordered.slice(0, stackLimit);
  const overflow = ordered.length - visibleStack.length;

  const triggerDisabled = disabled || !scopeReady;
  const disabledHint = disabled
    ? 'Save the task to add assignees'
    : !scopeReady ? 'Pick a client, product, and module first'
    : '';

  return (
    <div className="assg" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="sidefield-btn assg-trigger"
        onClick={() => !triggerDisabled && setOpen((o) => !o)}
        disabled={triggerDisabled}
        title={triggerDisabled ? disabledHint : undefined}
      >
        {assignees.length === 0 ? (
          <>
            <Icon name="plus" size={12}/>
            <span className="assg-empty">
              {triggerDisabled ? disabledHint : 'Add assignees'}
            </span>
          </>
        ) : (
          <>
            <span className="assg-stack" style={{ '--n': visibleStack.length }}>
              {visibleStack.map((a, i) => {
                const u = usersById[a.assigneduserid];
                return (
                  <span key={a.assigneduserid} className={`assg-stack-item${a.isprimary ? ' assg-primary' : ''}`} style={{ zIndex: stackLimit - i }}>
                    <Avatar user={u || { username: a.assignedusername }} size={20}/>
                    {a.isprimary && <span className="assg-star" aria-label="Primary"><StarIcon size={9}/></span>}
                  </span>
                );
              })}
              {overflow > 0 && (
                <span className="assg-stack-item assg-overflow" style={{ zIndex: 0 }}>+{overflow}</span>
              )}
            </span>
            <span className="assg-summary">
              {primary ? (usersById[primary.assigneduserid]?.name || usersById[primary.assigneduserid]?.username || primary.assignedusername) : ''}
              {assignees.length > 1 && <span className="assg-extra"> +{assignees.length - 1} more</span>}
            </span>
            <Icon name="chevron-d" size={11}/>
          </>
        )}
      </button>

      {open && (
        <div className="assg-pop" ref={popRef} style={popStyle} role="dialog" aria-label="Assignees">
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
            {eligibleIds == null ? (
              <div className="assg-empty-state">Loading…</div>
            ) : filteredUsers.length === 0 ? (
              <div className="assg-empty-state">
                {query
                  ? `No users match "${query}"`
                  : 'No one has access to this client and module yet.'}
              </div>
            ) : filteredUsers.map((u) => {
              const assigned = assignedIds.has(u.userid);
              const isPrim   = assigned && primary?.assigneduserid === u.userid;
              return (
                <div key={u.userid} className={`assg-row${assigned ? ' assg-row-on' : ''}`}>
                  <button
                    type="button"
                    className="assg-row-main"
                    onClick={() => assigned ? removeOne(u.userid) : addOne(u.userid)}
                  >
                    <span className={`assg-check${assigned ? ' assg-check-on' : ''}`}>
                      {assigned && <Icon name="check" size={10}/>}
                    </span>
                    <Avatar user={u} size={20}/>
                    <span className="assg-name">{u.name || u.username}</span>
                    {u.name && u.username && u.name !== u.username && (
                      <span className="assg-handle">{u.username}</span>
                    )}
                  </button>
                  {assigned && (
                    <button
                      type="button"
                      className={`assg-starbtn${isPrim ? ' assg-starbtn-on' : ''}`}
                      onClick={(e) => { e.stopPropagation(); if (!isPrim) setPrimary(u.userid); }}
                      title={isPrim ? 'Primary assignee' : 'Make primary'}
                    >
                      <StarIcon size={12} filled={isPrim}/>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {loading && <div className="assg-footnote">Syncing…</div>}
        </div>
      )}
    </div>
  );
}

function StarIcon({ size = 12, filled = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l2.7 6 6.3.5-4.8 4.2 1.5 6.3L12 16.8 6.3 20l1.5-6.3L3 9.5 9.3 9z"/>
    </svg>
  );
}
