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

export async function findUserByUsername(username) {
  if (!username) return null;
  const r = await restful({ url: `~/v2/users?filter=(username='${encodeURIComponent(username)}')` });
  return r?.collection?.[0] || null;
}

export async function listUserOrgs(userid) {
  if (userid == null) return [];
  const r = await restful({ url: `~/v2/userorgs?userid=${encodeURIComponent(userid)}` });
  return r?.collection || [];
}

export async function listUserProductsModules(userid) {
  if (userid == null) return [];
  const r = await restful({ url: `~/v2/userproductsmodules?userid=${encodeURIComponent(userid)}` });
  return r?.collection || [];
}

export async function listOrgAccessRows(organisationid) {
  if (organisationid == null) return [];
  const r = await restful({ url: `~/v2/userorgs?organisationid=${encodeURIComponent(organisationid)}` });
  return r?.collection || [];
}

export async function listProductAccessRows(productid) {
  if (productid == null) return [];
  const r = await restful({ url: `~/v2/userproductsmodules?productid=${encodeURIComponent(productid)}` });
  return r?.collection || [];
}

export async function listAssignees(taskid) {
  if (taskid == null) return [];
  const r = await restful({ url: `~/v2/taskassignees?taskid=${encodeURIComponent(taskid)}` });
  return r?.collection || [];
}

export async function addAssignee({ taskid, assigneduserid, isprimary = false }) {
  return restful({
    method: 'POST',
    url: '~/v2/taskassignees',
    body: { taskid, assigneduserid, isprimary },
  });
}

export async function setPrimaryAssignee(taskid, assigneduserid) {
  const key = `${encodeURIComponent(taskid)},${encodeURIComponent(assigneduserid)}`;
  return restful({
    method: 'PATCH',
    url: `~/v2/taskassignees/${key}`,
    body: { isprimary: true },
  });
}

export async function listSubtasks(parenttaskid) {
  if (parenttaskid == null) return [];
  const r = await restful({ url: `~/v2/tasks?filter=(parenttaskid=${encodeURIComponent(parenttaskid)})` });
  return r?.collection || [];
}

/* ------------------------------------------------------------ *
 * Activity & Discussion                                          *
 * ------------------------------------------------------------ */

export async function listActivity(taskid) {
  if (taskid == null) return [];
  const r = await restful({ url: `~/v2/taskactivity?filter=(taskid=${encodeURIComponent(taskid)})&order=creationdate%20desc&limit=100` });
  return r?.collection || [];
}

export async function listMessages(taskid) {
  if (taskid == null) return [];
  const r = await restful({ url: `~/v2/taskmessages?filter=(taskid=${encodeURIComponent(taskid)})&order=creationdate&limit=50` });
  return r?.collection || [];
}

export async function createMessage({ taskid, userid, parentmessageid = null, messagetext }) {
  return restful({
    method: 'POST',
    url: '~/v2/taskmessages',
    body: { taskid, userid, parentmessageid, messagetext },
  });
}

export async function editMessage(messageid, messagetext) {
  return restful({
    method: 'PATCH',
    url: `~/v2/taskmessages/${encodeURIComponent(messageid)}`,
    body: { messagetext, isedited: true, editeddate: new Date().toISOString() },
  });
}

export async function softDeleteMessage(messageid) {
  return restful({
    method: 'PATCH',
    url: `~/v2/taskmessages/${encodeURIComponent(messageid)}`,
    body: { isdeleted: true, deleteddate: new Date().toISOString() },
  });
}

export async function addMention({ messageid, userid }) {
  return restful({
    method: 'POST',
    url: '~/v2/taskmessagementions',
    body: { messageid, userid },
  });
}

export async function listMentionsForMessages(messageids) {
  if (!messageids?.length) return [];
  const list = messageids.map(i => encodeURIComponent(i)).join(',');
  const r = await restful({ url: `~/v2/taskmessagementions?filter=(messageid%20IN%20(${list}))&limit=200` });
  return r?.collection || [];
}

export async function listReactionsForMessages(messageids) {
  if (!messageids?.length) return [];
  const list = messageids.map(i => encodeURIComponent(i)).join(',');
  const r = await restful({ url: `~/v2/taskmessagereactions?filter=(messageid%20IN%20(${list}))&limit=500` });
  return r?.collection || [];
}

export async function addReaction({ messageid, userid, emoji }) {
  return restful({
    method: 'POST',
    url: '~/v2/taskmessagereactions',
    body: { messageid, userid, emoji },
  });
}

export async function removeReaction({ messageid, userid, emoji }) {
  const key = [messageid, userid, emoji].map(encodeURIComponent).join(',');
  return restful({ method: 'DELETE', url: `~/v2/taskmessagereactions/${key}` });
}

export async function getReadMarker(taskid, userid) {
  try {
    return await restful({ url: `~/v2/taskmessagereads/${encodeURIComponent(taskid)},${encodeURIComponent(userid)}` });
  } catch (err) {
    if (err?.code === 404) return null;
    throw err;
  }
}

export async function upsertReadMarker(taskid, userid, lastreadmessageid) {
  const key  = `${encodeURIComponent(taskid)},${encodeURIComponent(userid)}`;
  const body = { lastreadmessageid, lastreaddate: new Date().toISOString() };
  try {
    return await restful({ method: 'PATCH', url: `~/v2/taskmessagereads/${key}`, body });
  } catch (err) {
    if (err?.code === 404) {
      return await restful({ method: 'POST', url: '~/v2/taskmessagereads', body: { taskid, userid, ...body } });
    }
    throw err;
  }
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
  tasks:                SEED.tasks.slice(),
  orgs:                 SEED.orgs,
  products:             SEED.products,
  modules:              SEED.modules,
  taskgroups:           SEED.taskgroups,
  users:                SEED.users,
  userOrgs:             SEED.userOrgs.slice(),
  userProductsModules:  SEED.userProductsModules.slice(),
  taskAssignees:        (SEED.taskAssignees || []).slice(),
  taskActivity:         (SEED.taskActivity || []).slice(),
  taskMessages:         (SEED.taskMessages || []).slice(),
  taskMessageReactions: (SEED.taskMessageReactions || []).slice(),
  taskMessageMentions:  (SEED.taskMessageMentions || []).slice(),
  taskMessageReads:     (SEED.taskMessageReads || []).slice(),
  nextId:               Math.max(...SEED.tasks.map(t => t.taskid)) + 1,
  nextMessageId:        Math.max(0, ...((SEED.taskMessages || []).map(m => m.messageid))) + 1,
  nextActivityId:       Math.max(0, ...((SEED.taskActivity || []).map(a => a.activityid))) + 1,
};

function handleMock({ method = 'GET', url, body } = {}) {
  const path = stripTilde(url).split('?')[0];

  if (method === 'GET' && path === '/v2/tasks') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const m = q.match(/parenttaskid=(\d+|null)/);
    let rows = MOCK.tasks;
    if (m) {
      const v = m[1];
      rows = v === 'null'
        ? rows.filter(t => t.parenttaskid == null)
        : rows.filter(t => t.parenttaskid === parseInt(v, 10));
    }
    return { collection: rows, count: rows.length };
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
  if (method === 'GET' && path === '/v2/users') {
    // honour ?filter=(username='...') for the findUserByUsername helper
    const q = String(url).split('?')[1] || '';
    const m = decodeURIComponent(q).match(/username='([^']*)'/);
    const filtered = m ? MOCK.users.filter(u => u.username === m[1]) : MOCK.users;
    return { collection: filtered };
  }
  if (method === 'GET' && path === '/v2/userorgs') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const byUser = q.match(/userid=(\d+)/);
    const byOrg  = q.match(/organisationid=(\d+)/);
    let filtered = MOCK.userOrgs;
    if (byUser) filtered = filtered.filter(r => r.userid === parseInt(byUser[1], 10));
    if (byOrg)  filtered = filtered.filter(r => r.organisationid === parseInt(byOrg[1], 10));
    return { collection: filtered };
  }
  if (method === 'GET' && path === '/v2/userproductsmodules') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const byUser    = q.match(/userid=(\d+)/);
    const byProduct = q.match(/productid=(\d+)/);
    const byModule  = q.match(/moduleid=(\d+)/);
    let filtered = MOCK.userProductsModules;
    if (byUser)    filtered = filtered.filter(r => r.userid === parseInt(byUser[1], 10));
    if (byProduct) filtered = filtered.filter(r => r.productid === parseInt(byProduct[1], 10));
    if (byModule)  filtered = filtered.filter(r => r.moduleid === parseInt(byModule[1], 10));
    return { collection: filtered };
  }

  /* Task assignees (composite key taskid,assigneduserid) */
  if (method === 'GET' && path === '/v2/taskassignees') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const byTask = q.match(/taskid=(\d+)/);
    let rows = MOCK.taskAssignees;
    if (byTask) rows = rows.filter(r => r.taskid === parseInt(byTask[1], 10));
    return { collection: rows.map(decorateAssignee) };
  }
  if (method === 'POST' && path === '/v2/taskassignees') {
    const exists = MOCK.taskAssignees.find(
      r => r.taskid === body.taskid && r.assigneduserid === body.assigneduserid
    );
    if (exists) throw mkError(409, 'duplicate', 'Assignee already exists');
    if (body.isprimary) {
      MOCK.taskAssignees = MOCK.taskAssignees.map(r =>
        r.taskid === body.taskid ? { ...r, isprimary: false } : r
      );
    }
    const row = { taskid: body.taskid, assigneduserid: body.assigneduserid, isprimary: !!body.isprimary };
    MOCK.taskAssignees.push(row);
    return decorateAssignee(row);
  }
  if (method === 'DELETE' && path.startsWith('/v2/taskassignees/')) {
    const key = decodeURIComponent(path.split('/').pop());
    const [taskidStr, userIdStr] = key.split(',');
    const tid = parseInt(taskidStr, 10);
    const uid = parseInt(userIdStr, 10);
    MOCK.taskAssignees = MOCK.taskAssignees.filter(
      r => !(r.taskid === tid && r.assigneduserid === uid)
    );
    return {};
  }
  if (method === 'PATCH' && path.startsWith('/v2/taskassignees/')) {
    const key = decodeURIComponent(path.split('/').pop());
    const [taskidStr, userIdStr] = key.split(',');
    const tid = parseInt(taskidStr, 10);
    const uid = parseInt(userIdStr, 10);
    if (body.isprimary) {
      MOCK.taskAssignees = MOCK.taskAssignees.map(r =>
        r.taskid === tid ? { ...r, isprimary: r.assigneduserid === uid } : r
      );
    } else {
      MOCK.taskAssignees = MOCK.taskAssignees.map(r =>
        (r.taskid === tid && r.assigneduserid === uid) ? { ...r, ...body } : r
      );
    }
    const row = MOCK.taskAssignees.find(r => r.taskid === tid && r.assigneduserid === uid);
    return row ? decorateAssignee(row) : {};
  }

  /* ---------- Activity ---------- */
  if (method === 'GET' && path === '/v2/taskactivity') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const m = q.match(/taskid=(\d+)/);
    let rows = MOCK.taskActivity;
    if (m) rows = rows.filter(a => a.taskid === parseInt(m[1], 10));
    rows = [...rows].sort((a, b) => new Date(b.creationdate) - new Date(a.creationdate));
    return { collection: rows };
  }

  /* ---------- Messages ---------- */
  if (method === 'GET' && path === '/v2/taskmessages') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const m = q.match(/taskid=(\d+)/);
    let rows = MOCK.taskMessages;
    if (m) rows = rows.filter(x => x.taskid === parseInt(m[1], 10));
    rows = [...rows].sort((a, b) => new Date(a.creationdate) - new Date(b.creationdate));
    return { collection: rows };
  }
  if (method === 'POST' && path === '/v2/taskmessages') {
    const id  = MOCK.nextMessageId++;
    const now = new Date().toISOString();
    const row = {
      messageid:       id,
      taskid:          body.taskid,
      parentmessageid: body.parentmessageid ?? null,
      userid:          body.userid,
      messagetext:     body.messagetext,
      isedited:        false,
      editeddate:      null,
      isdeleted:       false,
      deleteddate:     null,
      creationdate:    now,
    };
    MOCK.taskMessages.push(row);
    return row;
  }
  if (method === 'PATCH' && path.startsWith('/v2/taskmessages/')) {
    const id = parseInt(path.split('/').pop(), 10);
    const i  = MOCK.taskMessages.findIndex(m => m.messageid === id);
    if (i < 0) throw mkError(404, 'not_found', 'Message not found');
    MOCK.taskMessages[i] = { ...MOCK.taskMessages[i], ...body };
    return MOCK.taskMessages[i];
  }
  if (method === 'DELETE' && path.startsWith('/v2/taskmessages/')) {
    const id = parseInt(path.split('/').pop(), 10);
    MOCK.taskMessages = MOCK.taskMessages.filter(m => m.messageid !== id);
    return {};
  }

  /* ---------- Mentions ---------- */
  if (method === 'GET' && path === '/v2/taskmessagementions') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const inMatch = q.match(/messageid\s+IN\s+\(([^)]+)\)/i);
    const userMatch = q.match(/userid=(\d+)/);
    let rows = MOCK.taskMessageMentions;
    if (inMatch) {
      const ids = inMatch[1].split(',').map(s => parseInt(s.trim(), 10));
      rows = rows.filter(r => ids.includes(r.messageid));
    }
    if (userMatch) rows = rows.filter(r => r.userid === parseInt(userMatch[1], 10));
    return { collection: rows };
  }
  if (method === 'POST' && path === '/v2/taskmessagementions') {
    const exists = MOCK.taskMessageMentions.some(
      r => r.messageid === body.messageid && r.userid === body.userid
    );
    if (exists) throw mkError(409, 'duplicate', 'Mention exists');
    const row = { ...body, creationdate: new Date().toISOString() };
    MOCK.taskMessageMentions.push(row);
    return row;
  }

  /* ---------- Reactions ---------- */
  if (method === 'GET' && path === '/v2/taskmessagereactions') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const inMatch = q.match(/messageid\s+IN\s+\(([^)]+)\)/i);
    let rows = MOCK.taskMessageReactions;
    if (inMatch) {
      const ids = inMatch[1].split(',').map(s => parseInt(s.trim(), 10));
      rows = rows.filter(r => ids.includes(r.messageid));
    }
    return { collection: rows };
  }
  if (method === 'POST' && path === '/v2/taskmessagereactions') {
    const exists = MOCK.taskMessageReactions.some(
      r => r.messageid === body.messageid && r.userid === body.userid && r.emoji === body.emoji
    );
    if (exists) throw mkError(409, 'duplicate', 'Reaction exists');
    const row = { ...body, creationdate: new Date().toISOString() };
    MOCK.taskMessageReactions.push(row);
    return row;
  }
  if (method === 'DELETE' && path.startsWith('/v2/taskmessagereactions/')) {
    const key = decodeURIComponent(path.split('/').pop());
    const [m, u, e] = key.split(',');
    const mid = parseInt(m, 10);
    const uid = parseInt(u, 10);
    MOCK.taskMessageReactions = MOCK.taskMessageReactions.filter(
      r => !(r.messageid === mid && r.userid === uid && r.emoji === e)
    );
    return {};
  }

  /* ---------- Read markers ---------- */
  if (method === 'GET' && path.startsWith('/v2/taskmessagereads/')) {
    const key = decodeURIComponent(path.split('/').pop());
    const [t, u] = key.split(',').map(s => parseInt(s, 10));
    const row = MOCK.taskMessageReads.find(r => r.taskid === t && r.userid === u);
    if (!row) throw mkError(404, 'not_found', 'Read marker not found');
    return row;
  }
  if (method === 'PATCH' && path.startsWith('/v2/taskmessagereads/')) {
    const key = decodeURIComponent(path.split('/').pop());
    const [t, u] = key.split(',').map(s => parseInt(s, 10));
    const i = MOCK.taskMessageReads.findIndex(r => r.taskid === t && r.userid === u);
    if (i < 0) throw mkError(404, 'not_found', 'Read marker not found');
    MOCK.taskMessageReads[i] = { ...MOCK.taskMessageReads[i], ...body };
    return MOCK.taskMessageReads[i];
  }
  if (method === 'POST' && path === '/v2/taskmessagereads') {
    const i = MOCK.taskMessageReads.findIndex(
      r => r.taskid === body.taskid && r.userid === body.userid
    );
    if (i >= 0) {
      MOCK.taskMessageReads[i] = { ...MOCK.taskMessageReads[i], ...body };
      return MOCK.taskMessageReads[i];
    }
    const row = { ...body };
    MOCK.taskMessageReads.push(row);
    return row;
  }

  if (method === 'GET' && (path === '/v2' || path === '/v2/')) {
    return { tasks: { _links: { first: { href: '~/v2/tasks' } } } };
  }

  throw mkError(404, 'no_route', `Mock: no route for ${method} ${path}`);
}

function decorateAssignee(r) {
  const u = MOCK.users.find(x => x.userid === r.assigneduserid);
  return { ...r, assignedusername: u?.username || u?.name || `User ${r.assigneduserid}` };
}

function decorateTask(t) {
  const org   = MOCK.orgs.find(o => o.id === t.organisationid);
  const prod  = MOCK.products.find(p => p.id === t.productid);
  const mod   = t.moduleid ? MOCK.modules.find(m => m.id === t.moduleid) : null;
  const grp   = t.taskgroupid ? MOCK.taskgroups.find(g => g.id === t.taskgroupid) : null;
  const user  = t.createdbyuserid != null ? MOCK.users.find(u => u.userid === t.createdbyuserid) : null;
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
