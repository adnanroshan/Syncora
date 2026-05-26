/* Syncora — API layer
 *
 * Thin wrapper over window.$app.restful (provided by restful.js loaded
 * from your Code On Time backend). In mock mode, routes to an in-memory
 * dataset so `vite dev` works without a backend.
 *
 * Convention: every URL is just `~/v2/<resource>` — no field selectors,
 * no limit params. The backend's hypermedia links (saved in session as
 * `syncora.apiHypermedia`) are preferred whenever present.
 */

import { IS_MOCK } from './config.js';
import { getApiHypermedia } from './auth.js';
import { SEED } from './mockData.js';

const MOCK_LATENCY = 200;

/* ------------------------------------------------------------ *
 * Thin proxy                                                     *
 * ------------------------------------------------------------ */
function restful(opts) {
  if (IS_MOCK || typeof window.$app === 'undefined' || typeof window.$app.restful !== 'function') {
    return mockRoute(opts);
  }
  return window.$app.restful(opts);
}

/* ------------------------------------------------------------ *
 * Public API                                                     *
 * ------------------------------------------------------------ */
export async function loadEverything() {
  // ACL gate: refuse early if the user has no access to tasks.
  const h = getApiHypermedia();
  if (!IS_MOCK && h && !h.tasks) {
    throw mkError(403, 'forbidden', 'You do not have access to tasks.');
  }
  const [tasksPage, lookups] = await Promise.all([
    listTasks(),
    loadLookups(),
  ]);
  return { tasks: tasksPage.collection || [], count: tasksPage.count, lookups };
}

export async function listTasks() {
  const url = hypermediaUrl('tasks', '~/v2/tasks');
  return restful({ url });
}

export async function getTask(taskid) {
  return restful({ url: `~/v2/tasks/${encodeURIComponent(taskid)}` });
}

export async function createTask(data) {
  return restful({ method: 'POST', url: '~/v2/tasks', body: data });
}

export async function patchTask(task, patch) {
  const url = task?._links?.edit?.href || `~/v2/tasks/${task.taskid}`;
  return restful({ method: 'PATCH', url, body: patch });
}

export async function deleteTask(task) {
  const url = task?._links?.delete?.href || `~/v2/tasks/${task.taskid}`;
  return restful({ method: 'DELETE', url });
}

export async function removeAssignee(taskid, assigneduserid) {
  return restful({
    method: 'POST',
    url: '~/v2/taskassignees/ra',
    body: { parameters: { taskid, assigneduserid } },
  });
}

/* ------------------------------------------------------------ *
 * Lookups — plain GET /v2/<resource>, no field filter            *
 * ------------------------------------------------------------ */
export async function loadLookups() {
  const [orgs, products, modules, taskgroups, users] = await Promise.all([
    safeList('organisation'),
    safeList('products'),
    safeList('modules'),
    safeList('taskgroups'),
    safeList('users'),
  ]);
  return { orgs, products, modules, taskgroups, users };
}

async function safeList(resource) {
  try {
    const url = hypermediaUrl(resource, `~/v2/${resource}`);
    const r = await restful({ url });
    return r?.collection || [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ *
 * HATEOAS helper — prefer the user-filtered hypermedia link      *
 * ------------------------------------------------------------ */
function hypermediaUrl(resourceKey, fallback) {
  if (IS_MOCK) return fallback;
  const h = getApiHypermedia();
  const first = h?.[resourceKey]?._links?.first?.href;
  return first || fallback;
}

/* ------------------------------------------------------------ *
 * Mock router — keeps `vite dev` working without a backend       *
 * ------------------------------------------------------------ */
function mockRoute(opts) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(handleMock(opts)); }
      catch (err) { reject(err); }
    }, MOCK_LATENCY);
  });
}

const MOCK = {
  tasks:      SEED.tasks.slice(),
  orgs:       SEED.orgs,
  products:   SEED.products,
  modules:    SEED.modules,
  taskgroups: SEED.taskgroups,
  users:      SEED.users,
  nextId:     Math.max(...SEED.tasks.map(t => t.taskid)) + 1,
};

function handleMock({ method = 'GET', url, body } = {}) {
  const path = stripTilde(url).split('?')[0];

  if (method === 'GET' && path === '/v2/tasks') {
    return { collection: MOCK.tasks, count: MOCK.tasks.length };
  }
  if (method === 'GET' && path.startsWith('/v2/tasks/')) {
    const id = parseInt(path.split('/').pop(), 10);
    const t  = MOCK.tasks.find(x => x.taskid === id);
    if (!t) throw mkError(404, 'not_found', 'Task not found');
    return withLinks(t);
  }
  if (method === 'POST' && path === '/v2/tasks') {
    const id = MOCK.nextId++;
    const now = new Date().toISOString();
    const decorated = decorateTask({ ...body, taskid: id, creationdate: now, lastmodifieddate: now });
    MOCK.tasks.unshift(decorated);
    return withLinks(decorated);
  }
  if (method === 'PATCH' && path.startsWith('/v2/tasks/')) {
    const id = parseInt(path.split('/').pop(), 10);
    const i  = MOCK.tasks.findIndex(x => x.taskid === id);
    if (i < 0) throw mkError(404, 'not_found', 'Task not found');
    const merged = decorateTask({ ...MOCK.tasks[i], ...body, lastmodifieddate: new Date().toISOString() });
    MOCK.tasks[i] = merged;
    return withLinks(merged);
  }
  if (method === 'DELETE' && path.startsWith('/v2/tasks/')) {
    const id = parseInt(path.split('/').pop(), 10);
    MOCK.tasks = MOCK.tasks.filter(x => x.taskid !== id);
    return {};
  }
  if (method === 'POST' && path === '/v2/taskassignees/ra') {
    const id = body?.parameters?.taskid;
    const i  = MOCK.tasks.findIndex(x => x.taskid === id);
    if (i < 0) throw mkError(404, 'not_found', 'Task not found');
    const merged = decorateTask({
      ...MOCK.tasks[i],
      usersusername: null,
      assignee: null,
      lastmodifieddate: new Date().toISOString(),
    });
    MOCK.tasks[i] = merged;
    return withLinks(merged);
  }

  if (method === 'GET' && path === '/v2/organisation') return { collection: MOCK.orgs };
  if (method === 'GET' && path === '/v2/products')     return { collection: MOCK.products };
  if (method === 'GET' && path === '/v2/modules')      return { collection: MOCK.modules };
  if (method === 'GET' && path === '/v2/taskgroups')   return { collection: MOCK.taskgroups };
  if (method === 'GET' && path === '/v2/users')        return { collection: MOCK.users };

  if (method === 'GET' && (path === '/v2' || path === '/v2/')) {
    return { tasks: { _links: { first: { href: '~/v2/tasks' } } } };
  }

  throw mkError(404, 'no_route', `Mock: no route for ${method} ${path}`);
}

function decorateTask(t) {
  const org   = MOCK.orgs.find(o => o.id === t.organisationid);
  const prod  = MOCK.products.find(p => p.id === t.productid);
  const mod   = t.moduleid ? MOCK.modules.find(m => m.id === t.moduleid) : null;
  const grp   = t.taskgroupid ? MOCK.taskgroups.find(g => g.id === t.taskgroupid) : null;
  const user  = t.usersusername ? MOCK.users.find(u => u.username === t.usersusername) : null;
  return {
    ...t,
    organisationname: org?.name || t.organisationname,
    productname:      prod?.name || t.productname,
    modulename:       mod?.name || t.modulename,
    taskgroupname:    grp?.name || t.taskgroupname,
    assignee:         user || t.assignee || null,
    orgShort:         org?.short || t.orgShort,
  };
}

function withLinks(t) {
  return {
    ...t,
    _links: {
      self:   { href: `~/v2/tasks/${t.taskid}` },
      edit:   { href: `~/v2/tasks/${t.taskid}` },
      delete: { href: `~/v2/tasks/${t.taskid}` },
    },
  };
}

function stripTilde(url) { return String(url).replace(/^~/, ''); }

function mkError(code, reason, message) {
  const e = new Error(message);
  e.code = code;
  e.errors = [{ reason, message }];
  return e;
}

export const __isMock = () => IS_MOCK;
