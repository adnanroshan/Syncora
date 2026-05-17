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
  const [loading, setLoad]    = useState(true);
  const [error, setError]     = useState(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setLoad(true); setError(null);
    try {
      const { tasks, lookups } = await api.loadEverything();
      setTasks(tasks);
      setLookups(lookups);
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

  /* ------- current user — derived from id_token, mapped to task.usersusername ------- */
  const me = useMemo(() => {
    if (isMock) {
      // mock-mode fixture
      return { username: 'me', name: 'You', hue: 165, isMe: true };
    }
    if (!user) return null;
    // The id_token gives us name/email/sub. Match against the backend's
    // users lookup so `usersusername` aligns with what the assignee picker
    // expects (the picker's option values are `u.username`).
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
      name:     matched?.name || user.name,
      email:    user.email,
      picture:  user.picture,
      hue:      hashHue(username),
      isMe:     true,
    };
  }, [user, isMock, lookups.users]);

  /* ------- scope filtering ------- */
  const scopedTasks = useMemo(() => {
    let arr = tasks;
    if (scope === 'mine' && me)        arr = arr.filter(t => t.usersusername === me.username);
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
  }, [tasks, scope, me]);

  /* ------- filters + search ------- */
  const filteredTasks = useMemo(() => {
    let arr = scopedTasks;
    if (filters.status)   arr = arr.filter(t => normaliseStatus(t.status) === filters.status);
    if (filters.priority) arr = arr.filter(t => t.priority === filters.priority);
    if (filters.assignee) arr = arr.filter(t => (t.assignee?.name || t.usersusername) === filters.assignee);
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
    tasks.forEach(t => {
      if (normaliseStatus(t.status) === 'done') return;
      m[t.organisationid] = (m[t.organisationid] || 0) + 1;
    });
    return m;
  }, [tasks]);

  // Distinct assigner names — powers the Assigner filter dropdown
  const assigneeOptions = useMemo(() => {
    const names = new Set();
    tasks.forEach(t => {
      const n = t.assignee?.name || t.usersusername;
      if (n) names.add(n);
    });
    return Array.from(names).sort();
  }, [tasks]);

  /* ------- mutations ------- */
  const onAfterPatch = useCallback((updatedTask) => {
    setTasks(prev => prev.map(t => t.taskid === updatedTask.taskid ? { ...t, ...updatedTask } : t));
  }, []);

  const onAfterDelete = useCallback((deletedTask) => {
    setTasks(prev => prev.filter(t => t.taskid !== deletedTask.taskid));
  }, []);

  const onCreate = async () => {
    if (creating) return; // guard against double-submit (button mash / 'c' keystroke during POST)
    setCreating(true);
    try {
      const draft = {
        title:       'New task',
        description: null,
        status:      'todo',
        priority:    'medium',
        duedate:     null,
        taskgroupid: lookups.taskgroups[0]?.id ?? lookups.taskgroups[0]?.taskgroupid ?? null,
        usersusername: me?.username ?? null,
      };
      let created = await api.createTask(draft);
      // If the backend's POST didn't persist the assigner (CoT may strip
      // fields the user has no create-permission on), follow up with a
      // PATCH so the logged-in user is recorded as the assigner.
      if (me?.username && !created.usersusername && created.taskid != null) {
        try {
          const patched = await api.patchTask(created, { usersusername: me.username });
          created = { ...created, ...patched };
        } catch (_) { /* non-fatal — fall through with optimistic decoration */ }
      }
      // Decorate locally so the assigner shows the logged-in user immediately,
      // even if the backend response still omits usersusername/assignee.
      const decorated = {
        ...created,
        usersusername: created.usersusername ?? me?.username ?? null,
        assignee:      created.assignee ?? (me ? { username: me.username, name: me.name, hue: me.hue } : null),
      };
      setTasks(prev => [decorated, ...prev]);
      setSelectedId(decorated.taskid);
    } catch (err) {
      alert('Could not create task: ' + prettyErr(err));
    } finally {
      setCreating(false);
    }
  };

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
      } else if (e.key === 'Escape' && selectedId) {
        setSelectedId(null);
      } else if (e.key === 'c' && !selectedId) {
        // Only create from the list view — never while the detail panel
        // is open (prevents accidental duplicates while editing a task).
        onCreate();
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
  }, [selectedId, filteredTasks]); // eslint-disable-line react-hooks/exhaustive-deps

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
        orgs={lookups.orgs}
        collapsed={prefs.sidebarCollapsed}
        me={me}
        inboxCount={3}
        mineCount={me ? tasks.filter(t => t.usersusername === me.username).length : 0}
        todayCount={tasks.filter(t => isToday(t.duedate)).length}
      />
      <main className="main">
        <TopBar
          scopeLabel={scopeLabel}
          scopeSubtitle={scopeSubtitle}
          onNew={onCreate}
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
              {view === 'list'     && <ListView     tasks={filteredTasks} orgsById={orgsById} onOpen={setSelectedId} selectedId={selectedId} sortBy={sortBy}/>}
              {view === 'board'    && <BoardView    tasks={filteredTasks} orgsById={orgsById} onOpen={setSelectedId} selectedId={selectedId} sortBy={sortBy}/>}
              {view === 'calendar' && <CalendarView tasks={filteredTasks}                    onOpen={setSelectedId} selectedId={selectedId} anchor={calAnchor} onAnchorChange={setCalAnchor}/>}
              {view === 'grouped'  && <GroupedView  tasks={filteredTasks} orgsById={orgsById} productsById={productsById} onOpen={setSelectedId} selectedId={selectedId} groupBy={groupBy} sortBy={sortBy}/>}
            </>
          )}
        </div>
      </main>

      <DetailPanel
        taskId={selectedId}
        onClose={() => setSelectedId(null)}
        onNavigate={setSelectedId}
        allTasks={filteredTasks}
        lookups={lookups}
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
