# Syncora — Tasks (React + Vite + OAuth 2.0)

A full-shell task-management UI for your Code On Time app. Sidebar, four task views (list / board / calendar / grouped), sliding detail panel, and **production OAuth 2.0 + PKCE** sign-in handled by the platform's built-in authorization server. Builds to a static bundle you can drop anywhere.

When `VITE_BACKEND_URL` + `VITE_CLIENT_ID` are set → real OAuth + real REST calls.
When they're empty → mock mode with seed data and a fake user (great for UI work).

---

## Quick start (mock mode — no backend needed)

```bash
cd syncora-app
npm install
npm run dev
```

Opens `http://localhost:5173`. You'll see a "mock mode" banner and the app pre-populated with 26 demo tasks.

---

## Connecting to Code On Time

### 1. Enable the REST engine

Edit `~/app/touch-settings.json` on your backend (template is in `/uploads/touch-settings.template.json`):

```json
{
  "server": {
    "rest": {
      "enabled": true,
      "authorization": {
        "oauth2": { "accessTokenDuration": 15 }
      }
    }
  }
}
```

Restart the backend. The `/v2` and `/oauth2/v2` endpoints are now live.

### 2. Register Syncora as an OAuth 2.0 client

You need a `client_id` for the SPA. Two ways:

**Via the backend UI (simplest):**
1. Sign in as admin → **Site Content** → **New Content** → **Identity Consumer**
2. Fill in:
   - **Name**: `Syncora`
   - **Author**: your team name
   - **Redirect URI**: where the SPA is hosted, with `#auth` appended.
     - Local dev: `http://localhost:5173/#auth`
     - Production: `https://tasks.example.com/#auth`
   - **Authorization type**: select **Native** (PKCE)
3. Save → copy the **Client Id**.

**Via REST API** (admin role required):

```bash
curl -X POST https://your-backend/oauth2/v2/apps \
  -H "x-api-key: <admin-api-key>" \
  -H "Content-Type: application/json" \
  -d @client-registration.json
```

Template is at `/uploads/client-registration-template.json`. The response includes `client_id`.

### 3. Configure the SPA

```bash
cp .env.example .env
```

Edit `.env`:
```
VITE_BACKEND_URL=https://your-codeontime-backend.com
VITE_CLIENT_ID=<paste the client_id from step 2>
```

### 4. Run it

```bash
npm run dev
```

You'll see the **login screen**. Click **Sign in** → you're redirected to the backend's login page → enter Code On Time credentials → consent screen → redirected back → the app loads with your real tasks.

If the redirect URI in step 2 doesn't match the actual URL (down to the trailing `#auth`), the backend returns `invalid_request`. The `state` parameter is validated on return — any mismatch aborts with a `Forged 'state' detected` error (CSRF defense).

---

## What the OAuth flow looks like in code

| Step | File | What happens |
|---|---|---|
| App starts | `src/main.jsx` | `Boot` component calls `bootstrap()` and shows the right screen for each auth state. |
| Loading | `src/auth.js` → `loadRestfulScript()` | Dynamically loads `https://<backend>/v2/js/restful-2.0.1.js`. |
| Configure | `bootstrap()` | Calls `$app.restful({ config: { clientId, token: <callback> }})` — the callback persists tokens to `localStorage` (stamped with an absolute `expires_at`). |
| User clicks Sign in | `src/components/LoginScreen.jsx` → `login()` | POST `/oauth2/v2/auth/pkce` → save `loginRequest` → redirect to authorize URL. |
| User authenticates | Backend UI | Login + consent screens shown by Code On Time. |
| Redirect back | URL has `#auth` | `bootstrap()` detects the hash, validates `state`, POSTs to `/oauth2/v2/token` with `code_verifier`, saves the token, fetches `/v2` hypermedia for ACL. |
| Authenticated UI | `src/App.jsx` | Receives `user` (decoded id_token) + `hypermedia` as props. |
| API calls | `src/api.js` | Every request goes through `$app.restful` which auto-attaches the Bearer token. A 401 triggers one silent `refresh_token` renewal + retry before any error surfaces. |
| Session keep-alive | `src/auth.js` | A timer renews the access token ~2 min before `expires_at`; returning to a backgrounded tab triggers an immediate renewal check. Only a rejected `refresh_token` logs the user out. |
| Logout | `src/auth.js` → `logout()` | POST `/oauth2/v2/revoke` with `client_id` + `refresh_token` → clear session → reload. |

---

## Project structure

```
syncora-app/
├── package.json
├── vite.config.js              # base: './' so dist/ is relocatable
├── index.html
├── .env.example                # template for your real config
└── src/
    ├── main.jsx                # Boot — chooses login / loading / app / error
    ├── App.jsx                 # Authenticated app shell
    ├── auth.js                 # OAuth 2.0 + PKCE — bootstrap / login / logout
    ├── api.js                  # $app.restful proxy + mock fallback
    ├── config.js               # reads VITE_BACKEND_URL / VITE_CLIENT_ID
    ├── mockData.js             # seed data for `vite dev` without a backend
    ├── preferences.js          # theme/density/accent in localStorage
    ├── styles.css              # design tokens + every view's CSS
    ├── components/
    │   ├── Icons.jsx
    │   ├── Shared.jsx
    │   ├── Sidebar.jsx
    │   ├── TopBar.jsx          # includes user menu (avatar + sign out)
    │   ├── ViewTabs.jsx        # filter chip dropdowns
    │   ├── LoginScreen.jsx     # anonymous / boot / error screens
    │   └── DetailPanel.jsx
    └── views/
        ├── _shared.jsx
        ├── ListView.jsx
        ├── BoardView.jsx
        ├── CalendarView.jsx
        └── GroupedView.jsx
```

---

## REST surface the app consumes

Matches your existing `tasks.html` / `taskdetail.html`. No backend changes beyond enabling the REST engine.

| Operation | Method | URL |
|---|---|---|
| List tasks | `GET` | `~/v2/tasks?count=true&limit=200&page=0` |
| Get task | `GET` | `~/v2/tasks/:id` |
| Create task | `POST` | `~/v2/tasks` |
| Update task | `PATCH` | `~/v2/tasks/:id` *(or `_links.edit.href`)* |
| Delete task | `DELETE` | `~/v2/tasks/:id` *(or `_links.delete.href`)* |
| Lookups | `GET` | `~/v2/organisation`, `~/v2/products`, `~/v2/modules`, `~/v2/taskgroups`, `~/v2/users` |

`api.js` prefers the **hypermedia links** from the user-filtered `/v2` root (saved in session as `syncora.apiHypermedia`) before falling back to the hard-coded URLs above. This means if a user lacks access to `tasks`, the app refuses *before* even calling the endpoint — matching the HATEOAS-driven ACL described in the security guide.

---

## Deployment

### Option A: Same origin as backend (recommended)

1. `npm run build` → `dist/`
2. Copy `dist/*` into `~/Content/syncora/` on your backend.
3. Add an index page at `/syncora/index.html` (Vite already named the entry `index.html` for you).
4. Register the redirect URI as `https://your-backend/syncora/#auth`.
5. CORS is automatically configured for registered client apps.

### Option B: Separate origin

If the SPA is at `tasks.example.com` and the backend at `app.example.com`:
1. Register the redirect URI as `https://tasks.example.com/#auth`.
2. Code On Time auto-creates a CORS entry for that origin during registration.
3. Set `VITE_BACKEND_URL=https://app.example.com` at build time.

---

## Token storage & security

| What | Where | Why |
|---|---|---|
| `access_token` / `refresh_token` / `id_token` | `localStorage` under `syncora.token` | Persistent sign-in: survives tab close and browser restart, shared across tabs. The access token stays short-lived (15 min) — persistence comes from the `refresh_token` (`offline_access` scope), renewed automatically ~2 min before expiry. |
| `apiHypermedia` (the `/v2` root) | `localStorage` under `syncora.apiHypermedia` | Cached to avoid an extra round-trip on each navigation. |
| `loginRequest` (PKCE state) | `sessionStorage` under `syncora.loginRequest` | In-flight only, per-tab — cleared the moment the code-for-token exchange completes. |

Trade-off note: the security guide prefers `sessionStorage` because it's wiped on tab close. We deliberately trade that for persistent sessions (a hard product requirement). Mitigations: tokens remain short-lived opaque tokens, the refresh token is revoked server-side on logout, and a rejected refresh immediately clears local state.

The browser never sees a `client_secret` — PKCE is used instead (per security-guide §4). The platform issues **opaque tokens**, not JWTs, for the Bearer header — JWTs are only present in the `id_token` for identity claims.

---

## Customization

### Brand color

Edit `src/preferences.js`:
```js
const DEFAULTS = {
  accent: '#0F6E56',   // ← your brand color
};
```

Also edit the same value in `src/styles.css` (`:root --accent`) for first-paint correctness.

### Field-name mapping

The app reads these task fields verbatim:
```
taskid, title, description, status, priority, duedate,
taskgroupid, taskgroupname, organisationid, organisationname,
productid, productname, moduleid, modulename,
usersusername, creationdate, lastmodifieddate
```

If your schema differs, search `src/` and rename. Each field appears in 1–2 places.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Stuck on "Couldn't reach the server" | `VITE_BACKEND_URL` wrong or backend down | Open dev tools → Network → check if `/v2/js/restful-2.0.1.js` 200s |
| Login redirect → "invalid_request" | Redirect URI in registration ≠ actual URL | Update the registration to match `<actual-app-url>#auth` exactly |
| Login redirect → "Forged 'state' detected" | Multiple login tabs open; sessionStorage stale | Close other tabs and retry. This is the CSRF guard working as intended. |
| Logged out unexpectedly | `refresh_token` rejected by the backend (revoked, or expired server-side) | Sign back in. The app auto-renews the access token, so a real logout means the refresh token itself died — check the token settings in `touch-settings.json` |
| App loads but tasks 403 | User lacks access to `tasks` controller | Grant the user's role read access to the tasks data controller in Code On Time |
| CORS error on login | The redirect URI's origin isn't registered | Re-save the client app registration — CORS entries auto-generate from the redirect URI |

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `/`   | Focus search |
| `c`   | Create task |
| `Esc` | Close detail panel |
| `j` / `k` | Next / previous task |

---

## What's intentionally NOT done

- **No JWT validation client-side** — per the security guide, we never trust the `id_token` for authorization, only for display (name/email/avatar). Authorization is enforced server-side via the Bearer token and HATEOAS link visibility.
- ~~No localStorage for tokens~~ — tokens now live in `localStorage` to support persistent sessions (see *Token storage & security* above for the trade-off and mitigations).
- **No third-party auth providers** (Auth0, Okta, etc.) — Code On Time *is* the authorization server. If you need to chain to an external IDP, configure that on the backend side.

---

*Built against Code On Time RESTful API Engine + OAuth 2.0 Authorization Server. All security primitives are platform-provided — this repo is just the UI client.*
