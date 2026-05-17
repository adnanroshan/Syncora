/* Runtime configuration — sourced from Vite env vars at build time.
 *
 * Set these in:
 *   - `.env` for local dev (gitignored)
 *   - your CI / deploy environment for builds
 *
 * If `backendUrl` is empty, the app runs in *mock mode* — no network calls,
 * uses the in-memory seed dataset, no OAuth handshake. Useful for local UI
 * development without touching your real CodeOnTime backend.
 */

export const CONFIG = {
  /** Base URL of your Code On Time backend (no trailing slash).
   *  e.g. "https://app.example.com"
   *  Empty string → mock mode. */
  backendUrl: stripTrailingSlash(import.meta.env.VITE_BACKEND_URL || ''),

  /** OAuth 2.0 client_id registered in your backend's
   *  /oauth2/v2/apps registry. */
  clientId: import.meta.env.VITE_CLIENT_ID || '',

  /** Scope requested at login. `offline_access` enables refresh_token. */
  scope: import.meta.env.VITE_OAUTH_SCOPE || 'offline_access openid profile email',
};

export const IS_MOCK = !CONFIG.backendUrl || !CONFIG.clientId;

function stripTrailingSlash(s) {
  return s.replace(/\/+$/, '');
}
