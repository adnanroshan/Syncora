/* Syncora — main App.
 *
 * Renders only when bootstrap() in main.jsx has produced a valid auth state.
 * The `user` and `hypermedia` props come from auth.js (decoded id_token + the
 * /v2 hypermedia root, respectively). When `isMock` is true we bypass auth
 * entirely and drive everything off mockData.js.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import * as api from './api.js';
import { logout } from './auth.js';
import { qk } from './queryKeys.js';
import {
  useTasks, useLookups, useAllAssignees, useUnread,
  useUserOrgs, useUserProductsModules,
} from './hooks/queries.js';
import { ACT, NOTIF, logActivity, notifyTaskAudience, addManagersAsWatchers } from './notify.js';
import { ToastHost } from './components/Notifications.jsx';
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

/* Stable empty defaults so a loading query doesn't churn referential identity. */
const EMPTY_ARR = [];
const EMPTY_LOOKUPS = { orgs: [], products: [], modules: [], taskgroups: [], users: [] };

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
  // Deep-link target inside the open task's discussion (from a
  // notification or live toast click).
  const [focusMessageId, setFocusMessageId] = useState(null);
  // Live notification popups.
  const [toasts, setToasts] = useState([]);

  /* ------- data (TanStack Query — cache + background revalidation) ------- */
  const queryClient = useQueryClient();
  const tasksQ     = useTasks();
  const lookupsQ   = useLookups();
  const assigneesQ = useAllAssignees();

  const tasks        = tasksQ.data || EMPTY_ARR;
  const lookups      = lookupsQ.data || EMPTY_LOOKUPS;
  const allAssignees = assigneesQ.data || EMPTY_ARR;
  const loading      = tasksQ.isLoading || lookupsQ.isLoading;
  const error        = tasksQ.error ? prettyErr(tasksQ.error) : null;
  const [creating, setCreating] = useState(false);
  // Logged-in user's `userid` from the backend (used for createdbyuserid on
  // task POST/PATCH). Resolved lazily via /v2/users?filter=(username='…').
  const [meUserId, setMeUserId] = useState(null);
  // In-memory draft for "New task". When non-null, the DetailPanel renders
  // in unsaved mode — no GET/PATCH calls. POST only fires on Create click.
  const [draftTask, setDraftTask] = useState(null);

  /* ------- indexes ------- */
  const orgsById     = useMemo(() => indexBy(lookups.orgs,     o => o.id ?? o.organisationid), [lookups.orgs]);
  const productsById = useMemo(() => indexBy(lookups.products, p => p.id ?? p.productid),      [lookups.products]);
  const modulesById  = useMemo(() => indexBy(lookups.modules,  m => m.id ?? m.moduleid),       [lookups.modules]);

  /* ------- current user — derived from id_token, joined to the backend
   * users table so we know the numeric `userid` to write as createdbyuserid. */
  const me = useMemo(() => {
    if (isMock) {
      return { username: 'me', userid: 8, name: 'You', hue: 165, isMe: true };
    }
    if (!user) return null;
    // The login handle from the id_token is authoritative for the current user.
    const handle = user?.raw?.preferred_username || user?.raw?.unique_name || null;
    const subId  = user?.sub != null ? String(user.sub) : null;
    const subNum = subId != null && /^\d+$/.test(subId) ? Number(subId) : null;
    const textCandidates = [handle, user?.email].filter(Boolean).map(s => String(s).toLowerCase());
    // Match the backend row by userid (sub) first, then by handle/email.
    const matched = (lookups.users || []).find(u => {
      if (subId != null && String(u.userid) === subId) return true;
      const fields = [u.username, u.email].filter(Boolean).map(s => String(s).toLowerCase());
      return fields.some(f => textCandidates.includes(f));
    });
    // Display the login handle; only fall back to backend/token name if absent.
    const username = handle || matched?.username || user?.email || subId || null;
    return {
      username,
      // The token's `sub` IS the numeric userid in this backend — trust it
      // over the fuzzy lookups match (which was resolving to admin/userid 1
      // once the users list loaded, flipping me.userid to 1).
      userid:   subNum ?? matched?.userid ?? meUserId ?? null,
      name:     username || matched?.name || user.name,
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

  /* Per-user access lists — cached per userid (independent queries, so one
   * failing call can't wipe the other's rows). */
  const userOrgsQ            = useUserOrgs(me?.userid);
  const userProductsModulesQ = useUserProductsModules(me?.userid);
  const userOrgs             = userOrgsQ.data || EMPTY_ARR;
  const userProductsModules  = userProductsModulesQ.data || EMPTY_ARR;

  /* Per-task unread counts: polled app-wide (visibility-gated) so badges
   * update without reselecting a task. Invalidated when the panel closes
   * so badges clear for a task you just read. */
  const unreadQ = useUnread(me?.userid != null);
  const unreadRows = unreadQ.data || EMPTY_ARR;
  const refreshUnread = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: qk.unread() });
  }, [queryClient]);


  /* Index users by id so tasks can show the assignee's name/avatar. */
  const usersById = useMemo(() => indexBy(lookups.users, u => u.userid), [lookups.users]);
  const usersByUsername = useMemo(() => {
    const out = {};
    (lookups.users || []).forEach(u => { if (u?.username) out[u.username] = u; });
    return out;
  }, [lookups.users]);

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
    const fromPerms = Array.from(map.values());
    if (fromPerms.length) {
      return fromPerms.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }
    // Fallback to the global products list when the per-user permission list
    // is empty/unavailable (mirrors accessibleOrgs → lookups.orgs).
    return (lookups.products || [])
      .map(p => ({ id: p.id ?? p.productid, productid: p.id ?? p.productid, name: p.name }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [userProductsModules, lookups.products]);

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
   * falling back to the existing assignee field or the creator. The module
   * name is resolved from the modules lookup by moduleid — the denormalized
   * `modulename` column on the /v2/tasks row can be stale/wrong, and the
   * detail panel already resolves it this way; keep the list consistent. */
  const decoratedTasks = useMemo(
    () => tasks.map(t => {
      const rows = assigneesByTask[t.taskid] || [];
      const primary = rows.find(r => r.isprimary) || rows[0] || null;
      const primaryUser = primary
        ? (usersById[primary.assigneduserid]
           || (primary.assignedusername ? { username: primary.assignedusername } : null))
        : null;
      // Also honour the task's single `usersusername` assignee (the detail
      // panel's "Assignee" field) so the grid avatar matches it.
      const byUsername = t.usersusername
        ? (usersByUsername[t.usersusername] || { username: t.usersusername })
        : null;
      return {
        ...t,
        modulename: modulesById[t.moduleid]?.name || t.modulename,
        assignee: primaryUser || byUsername || t.assignee || usersById[t.createdbyuserid] || null,
      };
    }),
    [tasks, usersById, usersByUsername, assigneesByTask, modulesById],
  );

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

  /* ------- mutations (optimistic cache writes + background revalidate) ------- */
  const onAfterPatch = useCallback((updatedTask) => {
    queryClient.setQueryData(qk.tasks(), (prev = []) =>
      prev.map(t => t.taskid === updatedTask.taskid ? { ...t, ...updatedTask } : t));
    queryClient.setQueryData(qk.task(updatedTask.taskid), (prev) =>
      prev ? { ...prev, ...updatedTask } : prev);
  }, [queryClient]);

  const onAfterDelete = useCallback((deletedTask) => {
    queryClient.setQueryData(qk.tasks(), (prev = []) =>
      prev.filter(t => t.taskid !== deletedTask.taskid));
    queryClient.removeQueries({ queryKey: qk.task(deletedTask.taskid) });
  }, [queryClient]);

  /* Open a task from a notification or toast — optionally focusing a
   * specific message in its discussion. */
  const openTask = useCallback((taskid, messageid = null) => {
    setDraftTask(null);
    setFocusMessageId(messageid ?? null);
    setSelectedId(taskid);
  }, []);

  const onToastIncoming = useCallback((fresh) => {
    setToasts(prev => {
      const seen = new Set(prev.map(t => t.notificationid));
      const add = fresh.filter(n => !seen.has(n.notificationid));
      // newest on top, cap the stack at 4
      return [...add, ...prev].slice(0, 4);
    });
  }, []);

  const dismissToast = useCallback((notificationid) => {
    setToasts(prev => prev.filter(t => t.notificationid !== notificationid));
  }, []);

  const onToastOpen = useCallback((n) => {
    dismissToast(n.notificationid);
    api.markNotificationRead(n).catch(() => {});
    if (n.taskid != null) openTask(n.taskid, n.messageid ?? null);
  }, [dismissToast, openTask]);

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
      usersusername:   me?.username ?? null,
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
      queryClient.setQueryData(qk.tasks(), (prev = []) => [decorated, ...prev]);
      setDraftTask(null);
      setSelectedId(decorated.taskid);

      /* Workflow side-effects (best-effort, never block the create):
       * audit row, creator's manager auto-watches, then notify the
       * task's audience (watchers — assignees join via the panel and
       * get their own Task Assigned notifications there). */
      const meName = me?.name || me?.username || 'Someone';
      logActivity({
        taskid: created.taskid, userid: me?.userid, activitytype: ACT.Created,
        description: `Task created by ${meName}`,
      });
      (async () => {
        await addManagersAsWatchers(created.taskid, [me?.userid]);
        notifyTaskAudience(
          { ...created, createdbyuserid: created.createdbyuserid ?? me?.userid },
          {
            actorId: me?.userid, notificationtype: NOTIF.TaskCreated,
            title: `New task: ${created.title}`,
            body: `Created by ${meName}`,
          },
        );
      })().catch(() => {});

      return decorated;
    } catch (err) {
      alert('Could not create task: ' + prettyErr(err));
      return null;
    } finally {
      setCreating(false);
    }
  }, [creating, usersById, me, queryClient]);

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
          onOpenTask={openTask}
          onNotifIncoming={onToastIncoming}
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
        focusMessageId={focusMessageId}
        onClose={() => { setSelectedId(null); setFocusMessageId(null); refreshUnread(); }}
        onNavigate={(id) => { setFocusMessageId(null); setSelectedId(id); }}
        onDiscardDraft={onDiscardDraft}
        onCommitDraft={onCommitDraft}
        allTasks={filteredTasks}
        lookups={detailLookups}
        usersById={usersById}
        currentUser={me}
        api={api}
        onAfterPatch={onAfterPatch}
        onAfterDelete={onAfterDelete}
        panelMode={prefs.panelMode}
        onPanelMode={(m) => setPrefs({ panelMode: m })}
      />

      <ToastHost toasts={toasts} onDismiss={dismissToast} onOpen={onToastOpen}/>
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
