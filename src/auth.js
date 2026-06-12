/* OAuth 2.0 + PKCE auth module for Code On Time.
 *
 * The Code On Time backend provides `/v2/js/restful-2.0.1.js` which exposes
 * `window.$app.restful` — a helper that handles auth headers, hypermedia
 * navigation (`oauth2 >> authorize-client-native >>`), and silent token
 * refresh. We load that script dynamically and then drive it through the
 * flow described in the security guide.
 *
 *   1. Load restful.js from the backend
 *   2. Configure $app.restful with our client_id + token callback
 *   3. If location has #auth → exchange code for tokens, then reload
 *   4. Otherwise return { state: 'anonymous' | 'authenticated' | ... }
 *
 * Storage layout:
 *   localStorage (persistent — survives tab close & browser restart):
 *     syncora.token          → full token response { access_token, refresh_token, id_token, expires_at, ... }
 *     syncora.apiHypermedia  → the /v2 root response (drives ACL — which resources are visible)
 *   sessionStorage (per-tab, in-flight only):
 *     syncora.loginRequest   → PKCE state during the redirect dance
 *
 * Session persistence: the access_token is short-lived (15 min by default),
 * so we keep it fresh ourselves rather than trusting restful.js alone:
 *   - a timer renews it via refresh_token ~2 min before expiry,
 *   - returning to a backgrounded tab triggers an immediate renewal check,
 *   - a 401 triggers one refresh-and-retry before the session is dropped.
 * Only a rejected refresh_token (revoked / expired server-side) logs the
 * user out.
 */

import { CONFIG, IS_MOCK } from './config.js';

const LS_TOKEN        = 'syncora.token';
const LS_HYPERMEDIA   = 'syncora.apiHypermedia';
const SS_LOGIN_REQ    = 'syncora.loginRequest';
const RESTFUL_JS_PATH = '/v2/js/restful-2.0.1.js';

/** Renew the access token this long before it expires. */
const REFRESH_SKEW_MS = 2 * 60 * 1000;
/** Retry delay when a refresh fails for transient (network) reasons. */
const REFRESH_RETRY_MS = 30 * 1000;

/** Public state machine returned by bootstrap(). */
export const AuthState = Object.freeze({
  Loading:        'loading',
  Anonymous:      'anonymous',
  Authenticated:  'authenticated',
  Redirecting:    'redirecting',
  Error:          'error',
});

/* ============================================================ *
 * bootstrap — called once at app start.                         *
 * Cached in a module-level promise so React StrictMode's       *
 * intentional double-invoke doesn't try to exchange the         *
 * authorization code twice.                                    *
 * ============================================================ */
let _bootstrapPromise = null;
export function bootstrap() {
  if (!_bootstrapPromise) _bootstrapPromise = _runBootstrap();
  return _bootstrapPromise;
}

async function _runBootstrap() {
  // Mock mode → fake a logged-in session immediately, skip OAuth entirely.
  if (IS_MOCK) {
    return {
      state: AuthState.Authenticated,
      mock:  true,
      user:  { name: 'You (mock)', email: 'dev@local', picture: null },
      hypermedia: null,
    };
  }

  try {
    await loadRestfulScript();
  } catch (err) {
    return { state: AuthState.Error, error: `Could not load ${CONFIG.backendUrl}${RESTFUL_JS_PATH}: ${err.message}` };
  }

  // Hook restful.js into our token storage. The `token` callback is how
  // restful.js asks us "what's the current token?" and how it stores a new
  // one after a silent refresh.
  await window.$app.restful({
    config: {
      clientId: CONFIG.clientId,
      token: function (value) {
        if (value !== undefined) saveToken(value);
        return loadLocal(LS_TOKEN);
      },
    },
  });

  // We just returned from the IDP — finish the exchange.
  if (location.hash.match(/#auth\b/)) {
    try {
      await completeAuthCallback();
    } catch (err) {
      return { state: AuthState.Error, error: prettyErr(err) };
    }
    // Clean URL + reload so we drop the ?code / #auth.
    location.replace(location.pathname);
    return { state: AuthState.Redirecting };
  }

  // Already-logged-in case: load hypermedia + decode user.
  let token = loadLocal(LS_TOKEN);
  if (!token) return { state: AuthState.Anonymous };

  // The app may have been closed past the access token's lifetime —
  // renew it up front so the first data requests don't 401.
  if (tokenExpiresSoon(token) && token.refresh_token) {
    await tryRefreshToken();
    token = loadLocal(LS_TOKEN);
    if (!token) return { state: AuthState.Anonymous }; // refresh_token rejected
  }

  let hypermedia = loadLocal(LS_HYPERMEDIA);
  if (!hypermedia) {
    try {
      hypermedia = await window.$app.restful();
      saveLocal(LS_HYPERMEDIA, hypermedia);
    } catch (err) {
      if (err && (err.code === 401 || err.code === 403)) {
        // Token rejected — renew it once via refresh_token before giving up.
        const renewed = await tryRefreshToken();
        if (!renewed) return { state: AuthState.Anonymous };
        try {
          hypermedia = await window.$app.restful();
          saveLocal(LS_HYPERMEDIA, hypermedia);
        } catch (err2) {
          if (err2 && (err2.code === 401 || err2.code === 403)) {
            saveToken(null);
            return { state: AuthState.Anonymous };
          }
          return { state: AuthState.Error, error: prettyErr(err2) };
        }
        token = loadLocal(LS_TOKEN);
      } else {
        return { state: AuthState.Error, error: prettyErr(err) };
      }
    }
  }

  // Keep the session alive for as long as the app stays open.
  scheduleRefresh(loadLocal(LS_TOKEN));
  installVisibilityRefresh();

  return {
    state: AuthState.Authenticated,
    user: decodeIdToken(token),
    hypermedia,
  };
}

/* ============================================================ *
 * Token refresh — keeps the session alive                       *
 * ============================================================ */
let _refreshPromise = null;
let _refreshTimer   = null;

function tokenExpiresSoon(token) {
  return token?.expires_at != null && Date.now() >= token.expires_at - REFRESH_SKEW_MS;
}

/** Stamp an absolute expiry on the token so we can renew it proactively
 *  (expires_in is relative to the moment the server issued it). */
function saveToken(value) {
  if (value && value.expires_in && !value.expires_at) {
    value = { ...value, expires_at: Date.now() + value.expires_in * 1000 };
  }
  saveLocal(LS_TOKEN, value);
  if (value) scheduleRefresh(value);
  else clearTimeout(_refreshTimer);
  return value;
}

/** Exchange the refresh_token for a new access_token.
 *  Returns the new token, or null if the refresh_token was rejected
 *  (in which case the session is cleared — user must log in again).
 *  Transient/network failures keep the session and resolve to the
 *  existing token so a retry can happen later. */
export async function tryRefreshToken() {
  if (IS_MOCK) return null;
  const token = loadLocal(LS_TOKEN);
  if (!token?.refresh_token) return null;
  if (_refreshPromise) return _refreshPromise; // single-flight

  _refreshPromise = (async () => {
    try {
      const result = await window.$app.restful({
        hypermedia: 'oauth2 >> token >>',
        body: {
          grant_type:    'refresh_token',
          refresh_token: token.refresh_token,
          client_id:     CONFIG.clientId,
        },
        // Anonymous call — the (possibly expired) Bearer header would be
        // rejected before the grant is even looked at.
        token: false,
      });
      // Servers may rotate the refresh_token or omit it — keep the old
      // one when a new one isn't issued.
      if (!result.refresh_token) result.refresh_token = token.refresh_token;
      return saveToken(result);
    } catch (err) {
      if (err && (err.code === 400 || err.code === 401 || err.code === 403)) {
        // refresh_token revoked/expired server-side — session is over.
        saveToken(null);
        saveLocal(LS_HYPERMEDIA, null);
        return null;
      }
      // Network blip etc. — keep the session, retry shortly.
      scheduleRetry();
      return loadLocal(LS_TOKEN);
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

/** Arm a timer that renews the token REFRESH_SKEW_MS before expiry. */
function scheduleRefresh(token) {
  clearTimeout(_refreshTimer);
  if (IS_MOCK || !token?.refresh_token || !token.expires_at) return;
  const delay = Math.max(token.expires_at - REFRESH_SKEW_MS - Date.now(), 5000);
  _refreshTimer = setTimeout(() => { tryRefreshToken(); }, delay);
}

function scheduleRetry() {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => { tryRefreshToken(); }, REFRESH_RETRY_MS);
}

/** Browsers throttle timers in background tabs — when the user comes
 *  back, renew immediately if the token went stale while we slept. */
let _visListenerInstalled = false;
function installVisibilityRefresh() {
  if (_visListenerInstalled || IS_MOCK) return;
  _visListenerInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const token = loadLocal(LS_TOKEN);
    if (token && tokenExpiresSoon(token)) tryRefreshToken();
  });
}

/* ============================================================ *
 * login — initiate PKCE flow                                    *
 * ============================================================ */
export async function login() {
  if (IS_MOCK) return; // no-op in mock mode

  // We redirect back to the same URL with #auth appended.
  const appUrl = location.href.match(/^(.+?)((\?|#).+)?$/)[1];
  const redirectUri = appUrl + '#auth';

  const result = await window.$app.restful({
    hypermedia: 'oauth2 >> authorize-client-native >>',
    body: {
      client_id:    CONFIG.clientId,
      redirect_uri: redirectUri,
      scope:        CONFIG.scope,
    },
  });

  // Stash the in-flight state so we can validate it when we come back.
  saveSession(SS_LOGIN_REQ, result);
  // Off to the authorization server's login + consent screens.
  location.href = result._links.authorize.href;
}

/* ============================================================ *
 * Finish a redirect from the IDP — exchange code for tokens.    *
 * ============================================================ */
async function completeAuthCallback() {
  const args = parseUrlArgs(location.href);
  if (args.error) throw new Error(`Authorization denied: ${args.error}`);

  const loginRequest = loadSession(SS_LOGIN_REQ);
  if (!loginRequest) throw new Error('Login state missing — please retry login.');
  saveSession(SS_LOGIN_REQ, null);

  if (args.state !== loginRequest.state) {
    // CSRF guard from the security guide — the state must round-trip exactly.
    throw new Error("Forged 'state' detected — login aborted.");
  }

  // restful.js gives us a token-exchange template; we plug in the code and POST.
  loginRequest.token.code = args.code;
  const tokenResult = await window.$app.restful({
    url:  loginRequest.token._links['self'],
    body: loginRequest.token,
  });
  saveToken(tokenResult);

  // Prime the hypermedia cache so ACL checks work on first paint.
  const hypermedia = await window.$app.restful();
  saveLocal(LS_HYPERMEDIA, hypermedia);
}

/* ============================================================ *
 * logout — revoke token, clear session, reload anonymous        *
 * ============================================================ */
export async function logout() {
  clearTimeout(_refreshTimer);
  const token = loadLocal(LS_TOKEN);
  if (token && !IS_MOCK) {
    try {
      await window.$app.restful({
        hypermedia: 'oauth2 >> revoke >>',
        body: {
          client_id: CONFIG.clientId,
          token: token.refresh_token || token.access_token || token,
        },
        // Anonymous call — don't attach the Bearer header (it'd be rejected
        // immediately if the token is already revoked or expired).
        token: false,
      });
    } catch (_) { /* best-effort — fall through to local cleanup */ }
  }
  saveToken(null);
  saveLocal(LS_HYPERMEDIA, null);
  saveSession(SS_LOGIN_REQ, null);
  location.replace(location.pathname);
}

/* ============================================================ *
 * helpers                                                        *
 * ============================================================ */
export function getApiHypermedia() { return loadLocal(LS_HYPERMEDIA); }
export function getToken()         { return loadLocal(LS_TOKEN); }

/** Refresh the hypermedia cache after a mutation that may have changed ACL. */
export async function refreshHypermedia() {
  if (IS_MOCK) return null;
  const h = await window.$app.restful();
  saveLocal(LS_HYPERMEDIA, h);
  return h;
}

/* ---- script loader ---- */
let restfulScriptPromise = null;
function loadRestfulScript() {
  if (window.$app && typeof window.$app.restful === 'function') return Promise.resolve();
  if (restfulScriptPromise) return restfulScriptPromise;
  restfulScriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src     = CONFIG.backendUrl + RESTFUL_JS_PATH;
    s.async   = true;
    s.onload  = () => {
      if (window.$app && typeof window.$app.restful === 'function') resolve();
      else reject(new Error('restful.js loaded but $app.restful is not available'));
    };
    s.onerror = () => reject(new Error('script load failed'));
    document.head.appendChild(s);
  });
  return restfulScriptPromise;
}

/* ---- storage ----
 * Token + hypermedia live in localStorage so the session survives tab
 * close and browser restart (and is shared across tabs). The in-flight
 * PKCE loginRequest stays per-tab in sessionStorage so concurrent login
 * attempts in different tabs can't clobber each other's `state`. */
function loadLocal(name) {
  try {
    const raw = localStorage.getItem(name);
    if (raw != null) return JSON.parse(raw);
    // One-time migration: users logged in before the move to localStorage
    // still have their session in sessionStorage — carry it over.
    const legacy = sessionStorage.getItem(name);
    if (legacy != null) {
      localStorage.setItem(name, legacy);
      sessionStorage.removeItem(name);
      return JSON.parse(legacy);
    }
    return null;
  } catch { return null; }
}
function saveLocal(name, value) {
  try {
    if (value == null) localStorage.removeItem(name);
    else localStorage.setItem(name, JSON.stringify(value));
  } catch { /* private mode etc. */ }
}
function loadSession(name) {
  try {
    const raw = sessionStorage.getItem(name);
    return raw == null ? null : JSON.parse(raw);
  } catch { return null; }
}
function saveSession(name, value) {
  try {
    if (value == null) sessionStorage.removeItem(name);
    else sessionStorage.setItem(name, JSON.stringify(value));
  } catch { /* private mode etc. */ }
}

/* ---- JWT decode (id_token) ---- */
function decodeIdToken(token) {
  if (!token?.id_token) return { name: null, email: null, picture: null };
  try {
    const payload = JSON.parse(atob(token.id_token.split('.')[1]));
    return {
      name:     payload.name || payload.given_name || payload.email || 'User',
      email:    payload.email || null,
      picture:  payload.picture || null,
      sub:      payload.sub || null,
      raw:      payload,
    };
  } catch {
    return { name: 'User', email: null, picture: null };
  }
}

/* ---- url arg parser (handles values after `#` as well as `?`) ---- */
function parseUrlArgs(url) {
  const out = {};
  const re  = /(\w+)=([^&#]+)/g;
  let m;
  while ((m = re.exec(url))) out[m[1]] = decodeURIComponent(m[2]);
  return out;
}

function prettyErr(err) {
  if (!err) return 'Unknown error';
  if (err.errors?.[0]) return err.errors[0].message || err.errors[0].reason || 'Error';
  return err.message || String(err);
}
