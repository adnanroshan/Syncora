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

import { CONFIG, IS_MOCK } from './config.js';
import { getApiHypermedia, getToken, tryRefreshToken } from './auth.js';
import { SEED } from './mockData.js';

const MOCK_LATENCY = 200;

/* ------------------------------------------------------------ *
 * Thin proxy                                                     *
 * ------------------------------------------------------------ */
async function restful(opts) {
  if (IS_MOCK || typeof window.$app === 'undefined' || typeof window.$app.restful !== 'function') {
    return mockRoute(opts);
  }
  try {
    return await window.$app.restful(opts);
  } catch (err) {
    // Access token expired mid-session — renew via refresh_token and retry
    // once instead of surfacing a 401 (which used to log the user out).
    if (err?.code === 401) {
      const renewed = await tryRefreshToken();
      if (renewed) return window.$app.restful(opts);
    }
    throw err;
  }
}

/* ------------------------------------------------------------ *
 * Pagination — page=0,1,2,… until a page returns no NEW rows.    *
 * No fixed `limit`; each page is the backend's default size. A   *
 * dedupe guard (by self-link/identity) also stops cleanly if the *
 * backend ignores `page` and repeats the first page (e.g. mock). *
 * ------------------------------------------------------------ */
const MAX_PAGES = 1000;

function withPage(url, page) {
  const [path, qs = ''] = String(url).split('?');
  const params = qs.split('&').filter(p => p && !/^page=/i.test(p) && !/^limit=/i.test(p));
  params.push('page=' + page);
  return `${path}?${params.join('&')}`;
}

async function restfulAll(baseUrl) {
  const out = [];
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await restful({ url: withPage(baseUrl, page) });
    const rows = r?.collection || [];
    if (rows.length === 0) break;                       // empty page → done
    let added = 0;
    for (const row of rows) {
      const key = row?._links?.self?.href || JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
      added++;
    }
    if (added === 0) break;                             // no new rows → done
  }
  return out;
}

/* ------------------------------------------------------------ *
 * Public API                                                     *
 * ------------------------------------------------------------ */
export async function loadEverything() {
  // ACL gate: refuse early if the user's hypermedia exposes neither
  // tasks resource.
  const h = getApiHypermedia();
  if (!IS_MOCK && h && !h.tasks && !h.tasksfresh) {
    throw mkError(403, 'forbidden', 'You do not have access to tasks.');
  }
  const [tasksPage, lookups, assignees] = await Promise.all([
    listTasks(),
    loadLookups(),
    listAllAssignees(),
  ]);
  return { tasks: tasksPage.collection || [], count: tasksPage.count, lookups, assignees };
}

export async function listTasks() {
  const url = hypermediaUrl('tasksfresh', '~/v2/tasksfresh');
  return { collection: await restfulAll(url) };
}

export async function getTask(taskid) {
  return restful({ url: `~/v2/tasksfresh/${encodeURIComponent(taskid)}` });
}

export async function createTask(data) {
  return restful({ method: 'POST', url: '~/v2/tasksfresh', body: data });
}

export async function patchTask(task, patch) {
  const url = task?._links?.edit?.href || `~/v2/tasksfresh/${task.taskid}`;
  return restful({ method: 'PATCH', url, body: patch });
}

export async function deleteTask(task) {
  const url = task?._links?.delete?.href || `~/v2/tasksfresh/${task.taskid}`;
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
  return restfulAll(`~/v2/userorgs?userid=${encodeURIComponent(userid)}`);
}

export async function listUserProductsModules(userid) {
  if (userid == null) return [];
  return restfulAll(`~/v2/userproductsmodules?userid=${encodeURIComponent(userid)}`);
}

export async function listOrgAccessRows(organisationid) {
  if (organisationid == null) return [];
  return restfulAll(`~/v2/userorgs?organisationid=${encodeURIComponent(organisationid)}`);
}

export async function listProductAccessRows(productid) {
  if (productid == null) return [];
  return restfulAll(`~/v2/userproductsmodules?productid=${encodeURIComponent(productid)}`);
}

export async function listAssignees(taskid) {
  if (taskid == null) return [];
  return restfulAll(`~/v2/taskassignees?taskid=${encodeURIComponent(taskid)}`);
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
  return restfulAll(`~/v2/tasksfresh?filter=(parenttaskid=${encodeURIComponent(parenttaskid)})`);
}

export async function listAllAssignees() {
  try { return await restfulAll('~/v2/taskassignees'); }
  catch { return []; }
}

export async function listMyUnread() {
  try {
    const rows = await restfulAll('~/v2/taskunread');
    // Normalize field casing: the backend returns lowercase
    // `unreadcount`/`mentioncount`; the UI reads camelCase.
    return rows.map(row => ({
      ...row,
      unreadCount:  row.unreadCount  ?? row.unreadcount  ?? 0,
      mentionCount: row.mentionCount ?? row.mentioncount ?? 0,
    }));
  } catch { return []; }
}

/* ------------------------------------------------------------ *
 * Verifications — one row per verifier per task                  *
 * ------------------------------------------------------------ */

export async function listVerifications(taskid) {
  if (taskid == null) return [];
  return restfulAll(`~/v2/taskverifications?filter=(taskid=${encodeURIComponent(taskid)})`);
}

export async function addVerification({ taskid, userid }) {
  try {
    return await restful({ method: 'POST', url: '~/v2/taskverifications', body: { taskid, userid } });
  } catch (err) {
    if (err?.code === 409) return null; // already verified — fine
    throw err;
  }
}

/** Reopening a completed task starts a fresh verification cycle. */
export async function clearVerifications(taskid) {
  const rows = await listVerifications(taskid).catch(() => []);
  await Promise.all(rows.map(r => {
    const key = `${encodeURIComponent(r.taskid)},${encodeURIComponent(r.userid)}`;
    return restful({ method: 'DELETE', url: `~/v2/taskverifications/${key}` }).catch(() => {});
  }));
}

/* ------------------------------------------------------------ *
 * Notifications                                                  *
 * ------------------------------------------------------------ */

export async function listNotifications(userid) {
  if (userid == null) return [];
  return restfulAll(`~/v2/notifications?filter=(userid%3D${encodeURIComponent(userid)})`);
}

export async function markNotificationRead(n) {
  const url = n?._links?.self?.href || `~/v2/notifications/${encodeURIComponent(n.notificationid)}`;
  return restful({
    method: 'PATCH',
    url,
    body: { isread: true, readdate: new Date().toISOString() },
  });
}

/* ------------------------------------------------------------ *
 * Activity & Discussion                                          *
 * ------------------------------------------------------------ */

export async function listActivity(taskid) {
  if (taskid == null) return [];
  return restfulAll(`~/v2/taskactivity?filter=(taskid=${encodeURIComponent(taskid)})&sort=creationdate%20desc`);
}

export async function listMessages(taskid) {
  if (taskid == null) return [];
  return restfulAll(`~/v2/taskmessages?filter=(taskid=${encodeURIComponent(taskid)})&sort=creationdate`);
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
  return restfulAll(`~/v2/taskmessagementions?filter=(messageid%20IN%20(${list}))`);
}

export async function listReactionsForMessages(messageids) {
  if (!messageids?.length) return [];
  const list = messageids.map(i => encodeURIComponent(i)).join(',');
  return restfulAll(`~/v2/taskmessagereactions?filter=(messageid%20IN%20(${list}))`);
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
 * Watchers, managers, notifications fan-out, activity log        *
 * ------------------------------------------------------------ */

export async function listWatchers(taskid) {
  if (taskid == null) return [];
  return restfulAll(`~/v2/taskwatchers?filter=(taskid=${encodeURIComponent(taskid)})`);
}

export async function addWatcher({ taskid, userid }) {
  try {
    return await restful({ method: 'POST', url: '~/v2/taskwatchers', body: { taskid, userid } });
  } catch (err) {
    if (err?.code === 409) return null; // already watching — fine
    throw err;
  }
}

export async function removeWatcher(taskid, userid) {
  const key = `${encodeURIComponent(taskid)},${encodeURIComponent(userid)}`;
  return restful({ method: 'DELETE', url: `~/v2/taskwatchers/${key}` });
}

/** Manager rows for a set of users: usersubordinates where subordinateid IN (…).
 *  Returns [{ managerid, subordinateid }]. */
export async function listManagersOf(userids) {
  const ids = Array.from(new Set((userids || []).filter(id => id != null)));
  if (!ids.length) return [];
  const list = ids.map(encodeURIComponent).join(',');
  return restfulAll(`~/v2/usersubordinates?filter=(subordinateid%20IN%20(${list}))`);
}

export async function createNotification({ userid, notificationtype, title, body = null, taskid = null, messageid = null }) {
  return restful({
    method: 'POST',
    url: '~/v2/notifications',
    body: { userid, notificationtype, title, body, taskid, messageid },
  });
}

export async function createActivity({ taskid, userid, activitytype, fieldname = null, oldvalue = null, newvalue = null, description = null }) {
  return restful({
    method: 'POST',
    url: '~/v2/taskactivity',
    body: { taskid, userid, activitytype, fieldname, oldvalue, newvalue, description },
  });
}

/* ------------------------------------------------------------ *
 * Attachments — /v2/attachments (single multipart upload)        *
 *                                                                *
 * One table backs both surfaces: messageid==null ⇒ task-level,   *
 * set ⇒ message-level. The file bytes + metadata go up together  *
 * in one multipart POST; `attachmentid` is a client-generated    *
 * UUID so the optimistic card and the persisted row share an id. *
 * ------------------------------------------------------------ */

export async function listAttachments(taskid) {
  if (taskid == null) return [];
  const rows = await restfulAll(`~/v2/attachments?filter=(taskid=${encodeURIComponent(taskid)})&sort=creationdate`);
  return rows.map(normalizeAttachment);
}

export async function createAttachment({
  taskid, messageid = null, uploadedbyuserid, file, attachmentid, onProgress,
}) {
  const id = attachmentid || genUuid();

  if (mockModeOn()) {
    return mockCreateAttachment({ id, taskid, messageid, uploadedbyuserid, file, onProgress });
  }

  const fd = new FormData();
  fd.append('attachmentid', id);
  fd.append('taskid', String(taskid));
  fd.append('uploadedbyuserid', String(uploadedbyuserid));
  if (messageid != null) fd.append('messageid', String(messageid));
  fd.append('externaldoc', file, file.name);

  const raw = await xhrSend('POST', absUrl('/v2/attachments'), fd, onProgress);
  return normalizeAttachment(raw);
}

export async function deleteAttachment(attachmentid) {
  if (attachmentid == null) return {};
  if (mockModeOn()) {
    return mockRoute({ method: 'DELETE', url: `~/v2/attachments/${encodeURIComponent(attachmentid)}` });
  }
  const res = await fetch(absUrl('/v2/attachments/' + encodeURIComponent(attachmentid)), {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw mkError(res.status, 'delete_failed', `Delete failed (HTTP ${res.status})`);
  return {};
}

/* Resolve a usable object-URL for an attachment, fetching the bytes
 * with the OAuth token attached (a raw <img>/anchor wouldn't carry it). */
export async function fetchAttachmentBlobUrl(att) {
  if (!att?.url) return null;
  if (mockModeOn() || /^(blob:|data:)/.test(att.url)) return att.url;
  const res = await fetch(absUrl(att.url), { headers: authHeaders() });
  if (!res.ok) throw mkError(res.status, 'fetch_failed', `Fetch failed (HTTP ${res.status})`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/* Absolute, shareable href for "copy link". */
export function attachmentHref(att) {
  return att?.url ? absUrl(att.url) : '';
}

/* Map the backend's `externalDoc*` columns onto the flat UI shape. */
function normalizeAttachment(r) {
  if (!r) return r;
  return {
    attachmentid: r.attachmentid,
    taskid:       r.taskid,
    messageid:    r.messageid ?? null,
    userid:       r.uploadedbyuserid ?? null,
    username:     r.uploadedbyuserUsername ?? null,
    filename:     r.externalDocFileName ?? r.filename ?? '',
    filesize:     r.externalDocLength ?? r.filesize ?? null,
    mimetype:     r.externalDoccontenttype ?? r.mimetype ?? null,
    storagepath:  r.externalDocstoragepath ?? null,
    url:          r.externalDoc ?? r.url ?? null,
    creationdate: r.creationdate ?? null,
    status:       'done',
  };
}

function mockModeOn() {
  return IS_MOCK
    || typeof window.$app === 'undefined'
    || typeof window.$app.restful !== 'function';
}

function genUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function absUrl(path) {
  if (!path) return path;
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  return CONFIG.backendUrl + String(path).replace(/^~/, '');
}

function authHeaders() {
  const t = getToken();
  const at = t?.access_token;
  return at ? { Authorization: 'Bearer ' + at } : {};
}

/* XHR so we get real upload progress (fetch() can't report it). */
function xhrSend(method, url, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    Object.entries(authHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {}); }
        catch { resolve({}); }
      } else {
        reject(mkError(xhr.status, 'request_failed', xhr.responseText || `HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(mkError(0, 'network', 'Network error'));
    xhr.send(body);
  });
}

/* Mock upload: fake progress, then persist a raw-shaped row into the
 * in-memory store using an object-URL for the real bytes. */
function mockCreateAttachment({ id, taskid, messageid, uploadedbyuserid, file, onProgress }) {
  const toInt = (v) => (typeof v === 'string' ? parseInt(v, 10) : v);
  return new Promise((resolve) => {
    let p = 0;
    const step = () => {
      p = Math.min(100, p + 20 + Math.random() * 25);
      onProgress?.(Math.round(p));
      if (p < 100) { setTimeout(step, 160); return; }
      const uid = toInt(uploadedbyuserid);
      const u = MOCK.users.find(x => x.userid === uid);
      const raw = {
        attachmentid:           id,
        taskid:                 toInt(taskid),
        messageid:              messageid != null ? toInt(messageid) : null,
        externalDocFileName:    file?.name || 'file',
        externalDocLength:      file?.size ?? null,
        externalDoccontenttype: file?.type || null,
        externalDocstoragepath: null,
        uploadedbyuserid:       uid,
        uploadedbyuserUsername: u?.username || null,
        creationdate:           new Date().toISOString(),
        externalDoc:            file ? URL.createObjectURL(file) : null,
      };
      MOCK.attachments.push(raw);
      setTimeout(() => resolve(normalizeAttachment(raw)), MOCK_LATENCY);
    };
    setTimeout(step, 160);
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
    return await restfulAll(url);
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
  taskVerifications:    [],
  taskWatchers:         [
    { taskid: SEED.tasks[0]?.taskid, userid: 2, creationdate: new Date().toISOString() },
  ],
  // managerid → subordinateid. User 1 manages the mock "me" (8); 8 manages 3.
  userSubordinates:     [
    { managerid: 1, subordinateid: 8 },
    { managerid: 8, subordinateid: 3 },
  ],
  taskActivity:         (SEED.taskActivity || []).slice(),
  taskMessages:         (SEED.taskMessages || []).slice(),
  taskMessageReactions: (SEED.taskMessageReactions || []).slice(),
  taskMessageMentions:  (SEED.taskMessageMentions || []).slice(),
  taskMessageReads:     (SEED.taskMessageReads || []).slice(),
  attachments:          (SEED.attachments || []).slice(),
  // Mock notifications for the seed "me" user (userid 8) — mirrors the
  // /v2/notifications row shape from the real backend.
  notifications: [
    {
      notificationid: 1, userid: 8, notificationtype: 'Task Completion',
      title: 'Task completed', body: 'This task has been completed',
      taskid: SEED.tasks[0]?.taskid ?? null, taskTitle: SEED.tasks[0]?.title ?? null,
      messageid: null, messageMessagetext: null,
      isread: false, readdate: null,
      creationdate: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
    },
    {
      notificationid: 2, userid: 8, notificationtype: 'Mention',
      title: 'You were mentioned', body: 'Check the discussion when you get a minute',
      taskid: SEED.tasks[1]?.taskid ?? null, taskTitle: SEED.tasks[1]?.title ?? null,
      messageid: null, messageMessagetext: null,
      isread: true, readdate: new Date(Date.now() - 80 * 60 * 1000).toISOString(),
      creationdate: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    },
  ],
  nextId:               Math.max(...SEED.tasks.map(t => t.taskid)) + 1,
  nextMessageId:        Math.max(0, ...((SEED.taskMessages || []).map(m => m.messageid))) + 1,
  nextActivityId:       Math.max(0, ...((SEED.taskActivity || []).map(a => a.activityid))) + 1,
};

function handleMock({ method = 'GET', url, body } = {}) {
  const path = stripTilde(url).split('?')[0];

  if (method === 'GET' && path === '/v2/tasksfresh') {
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
  if (method === 'GET' && path.startsWith('/v2/tasksfresh/')) {
    const id = parseInt(path.split('/').pop(), 10);
    const t  = MOCK.tasks.find(x => x.taskid === id);
    if (!t) throw mkError(404, 'not_found', 'Task not found');
    return withLinks(t);
  }
  if (method === 'POST' && path === '/v2/tasksfresh') {
    const id = MOCK.nextId++;
    const now = new Date().toISOString();
    const decorated = decorateTask({ ...body, taskid: id, creationdate: now, lastmodifieddate: now });
    MOCK.tasks.unshift(decorated);
    return withLinks(decorated);
  }
  if (method === 'PATCH' && path.startsWith('/v2/tasksfresh/')) {
    const id = parseInt(path.split('/').pop(), 10);
    const i  = MOCK.tasks.findIndex(x => x.taskid === id);
    if (i < 0) throw mkError(404, 'not_found', 'Task not found');
    const merged = decorateTask({ ...MOCK.tasks[i], ...body, lastmodifieddate: new Date().toISOString() });
    MOCK.tasks[i] = merged;
    return withLinks(merged);
  }
  if (method === 'DELETE' && path.startsWith('/v2/tasksfresh/')) {
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

  /* ---------- Per-user per-task unread counts (synthesized in mock) ----------
   * Real backend derives the userid from auth context. In mock we fall back
   * to the SEED "me" user (userid 8) — the same one App.jsx hardcodes when
   * IS_MOCK is true. */
  if (method === 'GET' && path === '/v2/taskunread') {
    const meUser = MOCK.users.find(u => u.isMe) || MOCK.users.find(u => u.username === 'me');
    const userid = meUser?.userid ?? meUser?.id ?? 8;
    const reads = new Map(
      MOCK.taskMessageReads
        .filter(r => r.userid === userid)
        .map(r => [r.taskid, r.lastreadmessageid ?? 0]),
    );
    const mentionMessageIds = new Set(
      MOCK.taskMessageMentions
        .filter(m => m.userid === userid)
        .map(m => m.messageid),
    );
    const byTask = new Map();
    for (const m of MOCK.taskMessages) {
      if (m.isdeleted) continue;
      if (m.userid === userid) continue;
      const lastRead = reads.has(m.taskid) ? reads.get(m.taskid) : 0;
      if (m.messageid <= lastRead) continue;
      const cur = byTask.get(m.taskid) || { taskid: m.taskid, unreadCount: 0, mentionCount: 0 };
      cur.unreadCount += 1;
      if (mentionMessageIds.has(m.messageid)) cur.mentionCount += 1;
      byTask.set(m.taskid, cur);
    }
    return { collection: Array.from(byTask.values()) };
  }

  /* ---------- Verifications ---------- */
  if (method === 'GET' && path === '/v2/taskverifications') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const m = q.match(/taskid=(\d+)/);
    let rows = MOCK.taskVerifications;
    if (m) rows = rows.filter(r => r.taskid === parseInt(m[1], 10));
    return { collection: rows };
  }
  if (method === 'POST' && path === '/v2/taskverifications') {
    const exists = MOCK.taskVerifications.some(r => r.taskid === body.taskid && r.userid === body.userid);
    if (exists) throw mkError(409, 'duplicate', 'Already verified');
    const row = { taskid: body.taskid, userid: body.userid, verifieddate: new Date().toISOString() };
    MOCK.taskVerifications.push(row);
    return row;
  }
  if (method === 'DELETE' && path.startsWith('/v2/taskverifications/')) {
    const key = decodeURIComponent(path.split('/').pop());
    const [t, u] = key.split(',').map(x => parseInt(x, 10));
    MOCK.taskVerifications = MOCK.taskVerifications.filter(r => !(r.taskid === t && r.userid === u));
    return {};
  }

  /* ---------- Watchers ---------- */
  if (method === 'GET' && path === '/v2/taskwatchers') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const m = q.match(/taskid=(\d+)/);
    let rows = MOCK.taskWatchers;
    if (m) rows = rows.filter(r => r.taskid === parseInt(m[1], 10));
    return { collection: rows };
  }
  if (method === 'POST' && path === '/v2/taskwatchers') {
    const exists = MOCK.taskWatchers.some(r => r.taskid === body.taskid && r.userid === body.userid);
    if (exists) throw mkError(409, 'duplicate', 'Already watching');
    const row = { taskid: body.taskid, userid: body.userid, creationdate: new Date().toISOString() };
    MOCK.taskWatchers.push(row);
    return row;
  }
  if (method === 'DELETE' && path.startsWith('/v2/taskwatchers/')) {
    const key = decodeURIComponent(path.split('/').pop());
    const [t, u] = key.split(',').map(s => parseInt(s, 10));
    MOCK.taskWatchers = MOCK.taskWatchers.filter(r => !(r.taskid === t && r.userid === u));
    return {};
  }

  /* ---------- Manager lookups ---------- */
  if (method === 'GET' && path === '/v2/usersubordinates') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const inMatch = q.match(/subordinateid\s+IN\s+\(([^)]+)\)/i);
    const eqMatch = q.match(/subordinateid=(\d+)/);
    let rows = MOCK.userSubordinates;
    if (inMatch) {
      const ids = inMatch[1].split(',').map(s => parseInt(s.trim(), 10));
      rows = rows.filter(r => ids.includes(r.subordinateid));
    } else if (eqMatch) {
      rows = rows.filter(r => r.subordinateid === parseInt(eqMatch[1], 10));
    }
    return { collection: rows };
  }

  /* ---------- Activity (write) ---------- */
  if (method === 'POST' && path === '/v2/taskactivity') {
    const row = { activityid: MOCK.nextActivityId++, creationdate: new Date().toISOString(), ...body };
    MOCK.taskActivity.push(row);
    return row;
  }

  /* ---------- Notifications ---------- */
  if (method === 'POST' && path === '/v2/notifications') {
    const id = Math.max(0, ...MOCK.notifications.map(n => n.notificationid)) + 1;
    const row = { notificationid: id, isread: false, readdate: null, creationdate: new Date().toISOString(), ...body };
    MOCK.notifications.push(row);
    return row;
  }
  if (method === 'GET' && path === '/v2/notifications') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const m = q.match(/userid=(\d+)/);
    let rows = MOCK.notifications;
    if (m) rows = rows.filter(n => n.userid === parseInt(m[1], 10));
    rows = [...rows].sort((a, b) => new Date(b.creationdate) - new Date(a.creationdate));
    return {
      collection: rows.map(n => ({
        ...n,
        _links: { self: { href: `~/v2/notifications/${n.notificationid}` } },
      })),
    };
  }
  if (method === 'PATCH' && path.startsWith('/v2/notifications/')) {
    const id = parseInt(path.split('/').pop(), 10);
    const i  = MOCK.notifications.findIndex(n => n.notificationid === id);
    if (i < 0) throw mkError(404, 'not_found', 'Notification not found');
    MOCK.notifications[i] = { ...MOCK.notifications[i], ...body };
    return MOCK.notifications[i];
  }

  /* ---------- Attachments ---------- */
  if (method === 'GET' && path === '/v2/attachments') {
    const q = decodeURIComponent(String(url).split('?')[1] || '');
    const m = q.match(/taskid=(\d+)/);
    let rows = MOCK.attachments;
    if (m) rows = rows.filter(a => a.taskid === parseInt(m[1], 10));
    rows = [...rows].sort((a, b) => new Date(a.creationdate) - new Date(b.creationdate));
    return { collection: rows };
  }
  if (method === 'POST' && path === '/v2/attachments') {
    const raw = { ...body };
    MOCK.attachments.push(raw);
    return raw;
  }
  if (method === 'DELETE' && path.startsWith('/v2/attachments/')) {
    const id = decodeURIComponent(path.split('/').pop());
    MOCK.attachments = MOCK.attachments.filter(a => String(a.attachmentid) !== String(id));
    return {};
  }

  if (method === 'GET' && (path === '/v2' || path === '/v2/')) {
    return { tasks: { _links: { first: { href: '~/v2/tasksfresh' } } } };
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
      self:   { href: `~/v2/tasksfresh/${t.taskid}` },
      edit:   { href: `~/v2/tasksfresh/${t.taskid}` },
      delete: { href: `~/v2/tasksfresh/${t.taskid}` },
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

/* Dev-only escape hatch: lets the console / UI tests simulate events
 * coming from OTHER users (e.g. push a notification row and watch the
 * live toast appear). Mock mode only — never defined in production. */
if (IS_MOCK && typeof window !== 'undefined') {
  window.__syncoraMock = MOCK;
}
