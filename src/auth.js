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
 * Session storage layout (cleared on tab close):
 *   syncora.token          → full token response { access_token, refresh_token, id_token, ... }
 *   syncora.apiHypermedia  → the /v2 root response (drives ACL — which resources are visible)
 *   syncora.loginRequest   → in-flight PKCE state during the redirect dance
 */

import { CONFIG, IS_MOCK } from './config.js';

const SS_TOKEN        = 'syncora.token';
const SS_HYPERMEDIA   = 'syncora.apiHypermedia';
const SS_LOGIN_REQ    = 'syncora.loginRequest';
const RESTFUL_JS_PATH = '/v2/js/restful-2.0.1.js';

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

  // Hook restful.js into our session storage. The `token` callback is how
  // restful.js asks us "what's the current token?" and how it stores a new
  // one after a silent refresh.
  await window.$app.restful({
    config: {
      clientId: CONFIG.clientId,
      token: function (value) {
        if (value !== undefined) saveSession(SS_TOKEN, value);
        return loadSession(SS_TOKEN);
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
  const token = loadSession(SS_TOKEN);
  if (!token) return { state: AuthState.Anonymous };

  let hypermedia = loadSession(SS_HYPERMEDIA);
  if (!hypermedia) {
    try {
      hypermedia = await window.$app.restful();
      saveSession(SS_HYPERMEDIA, hypermedia);
    } catch (err) {
      if (err && (err.code === 401 || err.code === 403)) {
        // Token rejected — drop it and show login.
        saveSession(SS_TOKEN, null);
        return { state: AuthState.Anonymous };
      }
      return { state: AuthState.Error, error: prettyErr(err) };
    }
  }

  return {
    state: AuthState.Authenticated,
    user: decodeIdToken(token),
    hypermedia,
  };
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
  saveSession(SS_TOKEN, tokenResult);

  // Prime the hypermedia cache so ACL checks work on first paint.
  const hypermedia = await window.$app.restful();
  saveSession(SS_HYPERMEDIA, hypermedia);
}

/* ============================================================ *
 * logout — revoke token, clear session, reload anonymous        *
 * ============================================================ */
export async function logout() {
  const token = loadSession(SS_TOKEN);
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
  saveSession(SS_TOKEN, null);
  saveSession(SS_HYPERMEDIA, null);
  saveSession(SS_LOGIN_REQ, null);
  location.replace(location.pathname);
}

/* ============================================================ *
 * helpers                                                        *
 * ============================================================ */
export function getApiHypermedia() { return loadSession(SS_HYPERMEDIA); }
export function getToken()         { return loadSession(SS_TOKEN); }

/** Refresh the hypermedia cache after a mutation that may have changed ACL. */
export async function refreshHypermedia() {
  if (IS_MOCK) return null;
  const h = await window.$app.restful();
  saveSession(SS_HYPERMEDIA, h);
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

/* ---- session storage ---- */
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
