/* Syncora — main App.
 *
 * Renders only when bootstrap() in main.jsx has produced a valid auth state.
 * The `user` and `hypermedia` props come from auth.js (decoded id_token + the
 * /v2 hypermedia root, respectively). When `isMock` is true we bypass auth
 * entirely and drive everything off mockData.js.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';

import * as api from './api.js';
import { logout } from './auth.js';
import { Sidebar }     from './components/Sidebar.jsx';
import { TopBar }      from './components/TopBar.jsx';
import { ViewTabs }    from './components/ViewTabs.jsx';
import { DetailPanel } from './components/DetailPanel.jsx';
import { ListView }     from './views/ListView.jsx';
import { BoardView }    from './views/BoardView.jsx';
import { CalendarView } from './views/CalendarView.jsx';
import { GroupedView }  from './views/GroupedView.jsx';
import { normaliseStatus, isToday } from './components/Shared.jsx';
import { usePreferences } from './preferences.js';

export default function App({ user, hypermedia, isMock }) {
  const [prefs, setPrefs] = usePreferences();

  const [view, setView]             = useState('list');
  const [scope, setScope]           = useState('all');
  const [search, setSearch]         = useState('');
  const [sortBy, setSortBy]         = useState('due');
  const [groupBy, setGroupBy]       = useState('org');
  const [filters, setFilters]       = useState({ status: null, priority: null, assignee: null });
  const [selectedId, setSelectedId] = useState(null);
  const [calAnchor, setCalAnchor]   = useState(new Date());

  /* ------- data ------- */
  const [tasks, setTasks]     = useState([]);
  const [lookups, setLookups] = useState({ orgs: [], products: [], modules: [], taskgroups: [], users: [] });
  const [allAssignees, setAllAssignees] = useState([]);
  const [unreadRows, setUnreadRows] = useState([]);
  const [loading, setLoad]    = useState(true);
  const [error, setError]     = useState(null);
  const [creating, setCreating] = useState(false);
  // Logged-in user's `userid` from the backend (used for createdbyuserid on
  // task POST/PATCH). Resolved lazily via /v2/users?filter=(username='…').
  const [meUserId, setMeUserId] = useState(null);
  // In-memory draft for "New task". When non-null, the DetailPanel renders
  // in unsaved mode — no GET/PATCH calls. POST only fires on Create click.
  const [draftTask, setDraftTask] = useState(null);
  // Per-user access lists. Empty until me.userid resolves. Drives the
  // Sidebar's Clients section and the Client/Product/Module pickers.
  const [userOrgs, setUserOrgs] = useState([]);
  const [userProductsModules, setUserProductsModules] = useState([]);

  const reload = useCallback(async () => {
    setLoad(true); setError(null);
    try {
      const { tasks, lookups, assignees } = await api.loadEverything();
      setTasks(tasks);
      setLookups(lookups);
      setAllAssignees(assignees || []);
    } catch (err) {
      setError(prettyErr(err));
    } finally {
      setLoad(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  /* ------- indexes ------- */
  const orgsById     = useMemo(() => indexBy(lookups.orgs,     o => o.id ?? o.organisationid), [lookups.orgs]);
  const productsById = useMemo(() => indexBy(lookups.products, p => p.id ?? p.productid),      [lookups.products]);

  /* ------- current user — derived from id_token, joined to the backend
   * users table so we know the numeric `userid` to write as createdbyuserid. */
  const me = useMemo(() => {
    if (isMock) {
      return { username: 'me', userid: 8, name: 'You', hue: 165, isMe: true };
    }
    if (!user) return null;
    const candidates = [
      user?.raw?.preferred_username,
      user?.email,
      user?.sub,
      user?.name,
    ].filter(Boolean).map(s => String(s).toLowerCase());
    const matched = (lookups.users || []).find(u => {
      const fields = [u.username, u.email, u.name].filter(Boolean).map(s => String(s).toLowerCase());
      return fields.some(f => candidates.includes(f));
    });
    const username = matched?.username
      || user?.raw?.preferred_username
      || user?.email
      || user?.sub
      || null;
    return {
      username,
      userid:   matched?.userid ?? meUserId ?? null,
      name:     matched?.name || user.name,
      email:    user.email,
      picture:  user.picture,
      hue:      hashHue(username),
      isMe:     true,
    };
  }, [user, isMock, lookups.users, meUserId]);

  /* Resolve `me.userid` via /v2/users?filter=(username='…') when it isn't
   * already known from the lookups payload. Skips in mock and when we've
   * already got an id. */
  useEffect(() => {
    if (isMock) return;
    if (!me?.username || me.userid != null) return;
    let cancelled = false;
    api.findUserByUsername(me.username).then(row => {
      if (!cancelled && row?.userid != null) setMeUserId(row.userid);
    });
    return () => { cancelled = true; };
  }, [isMock, me?.username, me?.userid]);

  /* Per-user access lists — fetched once `me.userid` is known. Reset when
   * the user changes (e.g. logout/re-login in the same tab). */
  useEffect(() => {
    if (me?.userid == null) { setUserOrgs([]); setUserProductsModules([]); return; }
    let cancelled = false;
    Promise.all([
      api.listUserOrgs(me.userid),
      api.listUserProductsModules(me.userid),
    ]).then(([o, p]) => {
      if (cancelled) return;
      setUserOrgs(o);
      setUserProductsModules(p);
    });
    return () => { cancelled = true; };
  }, [me?.userid]);

  /* Index users by id so tasks can show the assignee's name/avatar. */
  const usersById = useMemo(() => indexBy(lookups.users, u => u.userid), [lookups.users]);

  /* Orgs the user is allowed to see — drives the Sidebar Clients list and
   * the Client picker. Falls back to the full org list while the access
   * call is still in flight, so we don't flash an empty sidebar. */
  const accessibleOrgIds = useMemo(
    () => new Set(userOrgs.map(r => r.organisationid)),
    [userOrgs],
  );
  const accessibleOrgs = useMemo(() => {
    if (!userOrgs.length) return lookups.orgs;
    return lookups.orgs.filter(o => accessibleOrgIds.has(o.id ?? o.organisationid));
  }, [lookups.orgs, userOrgs, accessibleOrgIds]);

  /* Distinct products the user can write tasks against. Derived from the
   * userproductsmodules rows where canwrite=true. */
  const accessibleProducts = useMemo(() => {
    const map = new Map();
    userProductsModules.forEach(r => {
      if (!r.canwrite) return;
      if (map.has(r.productid)) return;
      map.set(r.productid, { id: r.productid, productid: r.productid, name: r.productname });
    });
    return Array.from(map.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [userProductsModules]);

  /* Single object passed to DetailPanel so its prop surface stays small. */
  const detailLookups = useMemo(() => ({
    ...lookups,
    userOrgs,
    userProductsModules,
    accessibleOrgs,
    accessibleProducts,
  }), [lookups, userOrgs, userProductsModules, accessibleOrgs, accessibleProducts]);

  /* Group taskassignees by taskid so each task can resolve its primary assignee. */
  const assigneesByTask = useMemo(() => {
    const out = {};
    (allAssignees || []).forEach(a => {
      if (a?.taskid == null) return;
      if (!out[a.taskid]) out[a.taskid] = [];
      out[a.taskid].push(a);
    });
    return out;
  }, [allAssignees]);

  /* Per-task unread / mention counts (from /v2/taskunread). */
  const unreadByTask = useMemo(() => {
    const out = {};
    (unreadRows || []).forEach(r => {
      if (r?.taskid != null) out[r.taskid] = r;
    });
    return out;
  }, [unreadRows]);

  /* Decorate every task with its actual primary assignee (from taskassignees),
   * falling back to the existing assignee field or the creator. */
  const decoratedTasks = useMemo(
    () => tasks.map(t => {
      const rows = assigneesByTask[t.taskid] || [];
      const primary = rows.find(r => r.isprimary) || rows[0] || null;
      const primaryUser = primary ? usersById[primary.assigneduserid] : null;
      return {
        ...t,
        assignee: primaryUser || t.assignee || usersById[t.createdbyuserid] || null,
      };
    }),
    [tasks, usersById, assigneesByTask],
  );

  /* Refresh per-task unread counts (called on app load + when the detail
   * panel closes so badges clear for a task you just read). */
  const refreshUnread = useCallback(async () => {
    if (me?.userid == null) { setUnreadRows([]); return; }
    try {
      const rows = await api.listMyUnread(me.userid);
      setUnreadRows(rows || []);
    } catch { /* swallow */ }
  }, [me?.userid]);

  useEffect(() => { refreshUnread(); }, [refreshUnread, tasks]);

  /* Tab title prefix: (@1·4) / (7) / (@2) / nothing. */
  useEffect(() => {
    const totalUnread = unreadRows.reduce((n, r) => n + (r.unreadCount || 0), 0);
    const totalMentions = unreadRows.reduce((n, r) => n + (r.mentionCount || 0), 0);
    let prefix = '';
    if (totalMentions > 0 && totalUnread > totalMentions)      prefix = `(@${totalMentions}·${totalUnread}) `;
    else if (totalMentions > 0)                                 prefix = `(@${totalMentions}) `;
    else if (totalUnread > 0)                                   prefix = `(${totalUnread}) `;
    document.title = `${prefix}Syncora`;
  }, [unreadRows]);

  /* ------- scope filtering ------- */
  const scopedTasks = useMemo(() => {
    let arr = decoratedTasks;
    if (scope === 'mine' && me?.userid != null) arr = arr.filter(t => t.createdbyuserid === me.userid);
    else if (scope === 'today')        arr = arr.filter(t => isToday(t.duedate));
    else if (scope === 'inbox')        arr = arr.slice(0, 3);
    else if (scope === 'view-urgent')  arr = arr.filter(t => t.priority === 'urgent');
    else if (scope === 'view-blocked') arr = arr.filter(t => normaliseStatus(t.status) === 'blocked');
    else if (scope === 'view-recent')  arr = [...arr].sort((a, b) => new Date(b.lastmodifieddate) - new Date(a.lastmodifieddate)).slice(0, 12);
    else if (scope.startsWith('org-')) {
      const id = parseInt(scope.replace('org-', ''), 10);
      arr = arr.filter(t => t.organisationid === id);
    }
    return arr;
  }, [decoratedTasks, scope, me]);

  /* ------- filters + search ------- */
  const filteredTasks = useMemo(() => {
    let arr = scopedTasks.filter(t => t.parenttaskid == null);
    if (filters.status)   arr = arr.filter(t => normaliseStatus(t.status) === filters.status);
    if (filters.priority) arr = arr.filter(t => t.priority === filters.priority);
    if (filters.assignee != null) arr = arr.filter(t => t.createdbyuserid === filters.assignee);
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(t =>
        (t.title || '').toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.organisationname || '').toLowerCase().includes(q) ||
        (t.productname || '').toLowerCase().includes(q) ||
        (t.modulename || '').toLowerCase().includes(q)
      );
    }
    return arr;
  }, [scopedTasks, filters, search]);

  const counts = useMemo(() => ({
    list:     filteredTasks.length,
    board:    filteredTasks.length,
    calendar: filteredTasks.filter(t => t.duedate).length,
    grouped:  filteredTasks.length,
  }), [filteredTasks]);

  const byOrg = useMemo(() => {
    const m = {};
    decoratedTasks.forEach(t => {
      if (normaliseStatus(t.status) === 'done') return;
      m[t.organisationid] = (m[t.organisationid] || 0) + 1;
    });
    return m;
  }, [decoratedTasks]);

  // Distinct assigners ({ value: userid, label: username }) — powers the
  // Assigner filter chip on the toolbar.
  const assigneeOptions = useMemo(() => {
    const seen = new Map();
    decoratedTasks.forEach(t => {
      if (t.createdbyuserid == null) return;
      if (seen.has(t.createdbyuserid)) return;
      const u = usersById[t.createdbyuserid];
      seen.set(t.createdbyuserid, { value: t.createdbyuserid, label: u?.username || u?.name || String(t.createdbyuserid) });
    });
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [decoratedTasks, usersById]);

  /* ------- mutations ------- */
  const onAfterPatch = useCallback((updatedTask) => {
    setTasks(prev => prev.map(t => t.taskid === updatedTask.taskid ? { ...t, ...updatedTask } : t));
  }, []);

  const onAfterDelete = useCallback((deletedTask) => {
    setTasks(prev => prev.filter(t => t.taskid !== deletedTask.taskid));
  }, []);

  /* "New task" no longer POSTs. It opens an in-memory draft in the detail
   * panel. The POST fires later, when the user clicks the Create button. */
  const onNewTask = () => {
    if (draftTask) return; // already drafting — ignore extra clicks/keystrokes
    setSelectedId(null);
    setDraftTask({
      title:           '',
      description:     null,
      status:          'todo',
      priority:        'medium',
      duedate:         null,
      taskgroupid:     lookups.taskgroups[0]?.id ?? lookups.taskgroups[0]?.taskgroupid ?? null,
      organisationid:  null,
      productid:       null,
      moduleid:        null,
      createdbyuserid: me?.userid ?? null,
    });
  };

  const onDiscardDraft = useCallback(() => setDraftTask(null), []);

  /* Commit the draft: single POST to /v2/tasks. On success, the saved row
   * goes into the task list and the panel switches into normal (saved) mode. */
  const onCommitDraft = useCallback(async (draft) => {
    if (creating) return null;
    setCreating(true);
    try {
      const created = await api.createTask(draft);
      const decorated = { ...created, assignee: usersById[created.createdbyuserid] || null };
      setTasks(prev => [decorated, ...prev]);
      setDraftTask(null);
      setSelectedId(decorated.taskid);
      return decorated;
    } catch (err) {
      alert('Could not create task: ' + prettyErr(err));
      return null;
    } finally {
      setCreating(false);
    }
  }, [creating, usersById]);

  /* ------- keyboard shortcuts ------- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      // Ignore modifier-key combos (Ctrl/Cmd+C copy, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        document.querySelector('.topbar-search input')?.focus();
      } else if (e.key === 'Escape' && (selectedId || draftTask)) {
        if (draftTask) setDraftTask(null);
        else           setSelectedId(null);
      } else if (e.key === 'c' && !selectedId && !draftTask) {
        // Only open a draft from the list view — never while a panel is
        // already open (prevents accidental duplicates while editing).
        onNewTask();
      } else if (selectedId && (e.key === 'j' || e.key === 'k')) {
        const list = filteredTasks;
        const idx = list.findIndex(t => t.taskid === selectedId);
        if (idx < 0) return;
        const nxt = e.key === 'j' ? list[Math.min(list.length - 1, idx + 1)] : list[Math.max(0, idx - 1)];
        if (nxt) setSelectedId(nxt.taskid);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, filteredTasks, draftTask]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------- render ------- */
  const scopeLabel = labelForScope(scope, orgsById);
  const scopeSubtitle = loading ? 'loading' : `${filteredTasks.length} task${filteredTasks.length === 1 ? '' : 's'}`;

  return (
    <div className={`app ${prefs.sidebarCollapsed ? 'app--sb-collapsed' : ''}`}>
      {isMock && (
        <div className="mock-banner">
          Running in mock mode · no backend configured. Set <code>VITE_BACKEND_URL</code> + <code>VITE_CLIENT_ID</code> in <code>.env</code> to connect.
        </div>
      )}
      <Sidebar
        active={scope}
        onSelect={setScope}
        scopeCount={tasks.length}
        byOrg={byOrg}
        orgs={accessibleOrgs}
        collapsed={prefs.sidebarCollapsed}
        me={me}
        inboxCount={unreadRows.length}
        inboxHasMentions={unreadRows.some(r => (r.mentionCount || 0) > 0)}
        mineCount={me?.userid != null ? tasks.filter(t => t.createdbyuserid === me.userid).length : 0}
        todayCount={tasks.filter(t => isToday(t.duedate)).length}
      />
      <main className="main">
        <TopBar
          scopeLabel={scopeLabel}
          scopeSubtitle={scopeSubtitle}
          onNew={onNewTask}
          onSearch={setSearch}
          search={search}
          theme={prefs.theme}
          onToggleTheme={() => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}
          user={me}
          onLogout={logout}
        />
        <ViewTabs
          view={view} onChange={setView}
          counts={counts}
          sortBy={sortBy} onSort={setSortBy}
          groupBy={groupBy} onGroup={setGroupBy}
          filters={filters} onFilter={(patch) => setFilters({ ...filters, ...patch })}
          assigneeOptions={assigneeOptions}
        />
        <div className="content">
          {loading ? (
            <div className="empty"><div className="empty-title">Loading tasks…</div></div>
          ) : error ? (
            <div className="empty">
              <div className="empty-title">Could not load tasks</div>
              <div className="empty-sub">{error}</div>
            </div>
          ) : (
            <>
              {view === 'list'     && <ListView     tasks={filteredTasks} orgsById={orgsById} onOpen={setSelectedId} selectedId={selectedId} sortBy={sortBy} unreadByTask={unreadByTask}/>}
              {view === 'board'    && <BoardView    tasks={filteredTasks} orgsById={orgsById} onOpen={setSelectedId} selectedId={selectedId} sortBy={sortBy} unreadByTask={unreadByTask}/>}
              {view === 'calendar' && <CalendarView tasks={filteredTasks}                    onOpen={setSelectedId} selectedId={selectedId} anchor={calAnchor} onAnchorChange={setCalAnchor}/>}
              {view === 'grouped'  && <GroupedView  tasks={filteredTasks} orgsById={orgsById} productsById={productsById} onOpen={setSelectedId} selectedId={selectedId} groupBy={groupBy} sortBy={sortBy} unreadByTask={unreadByTask}/>}
            </>
          )}
        </div>
      </main>

      <DetailPanel
        taskId={selectedId}
        draftTask={draftTask}
        creating={creating}
        onClose={() => { setSelectedId(null); refreshUnread(); }}
        onNavigate={setSelectedId}
        onDiscardDraft={onDiscardDraft}
        onCommitDraft={onCommitDraft}
        allTasks={filteredTasks}
        lookups={detailLookups}
        usersById={usersById}
        currentUser={me}
        api={api}
        onAfterPatch={onAfterPatch}
        onAfterDelete={onAfterDelete}
      />
    </div>
  );
}

function labelForScope(s, orgsById) {
  if (s === 'inbox')          return 'Inbox';
  if (s === 'mine')           return 'My tasks';
  if (s === 'today')          return 'Today';
  if (s === 'all')            return 'All work';
  if (s === 'view-urgent')    return 'Urgent';
  if (s === 'view-blocked')   return 'Blocked';
  if (s === 'view-recent')    return 'Recently updated';
  if (s.startsWith('org-')) {
    const id = parseInt(s.replace('org-', ''), 10);
    return orgsById?.[id]?.name || 'Tasks';
  }
  return 'Tasks';
}

function indexBy(arr, fn) {
  const out = {};
  (arr || []).forEach(x => { const k = fn(x); if (k != null) out[k] = x; });
  return out;
}

function hashHue(s) {
  if (!s) return 165;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function prettyErr(err) {
  if (!err) return 'Unknown error';
  if (err.errors?.[0]) return err.errors[0].message || err.errors[0].reason || 'Error';
  return err.message || String(err);
}
