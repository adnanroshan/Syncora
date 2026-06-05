# Syncora — Real-time + Caching Plan

> Goal: near-real-time updates for **Activities** and **Chat (Discussion)**, plus an
> app-wide **caching** layer.
>
> Decisions (confirmed): **Smart polling** for real-time + **TanStack Query** for caching.

---

## Context (current state)

- **Frontend-only repo**: React 18 + Vite SPA. No backend in-repo — it talks to a
  **Code On Time** generated backend over plain REST (`/v2/...`) with OAuth2/PKCE,
  via the thin wrapper in `src/api.js`.
- **Chat** = `taskmessages` (+ `taskmessagereactions`, `taskmessagementions`,
  `taskmessagereads`). **Activities** = `taskactivity`.
- **Current behavior**: `src/components/ActivityDiscussion.jsx` fetches everything
  *once* when a task is selected. Mutations are optimistic locally, but **nothing
  updates from other users** until the task is reselected. Unread badges
  (`listMyUnread`) only refresh on app load and when the detail panel closes
  (`src/App.jsx:208-219`).
- **No caching layer** today — every task selection refetches from scratch.
- **No WebSocket/SSE/push** anywhere; the backend exposes **REST only**.

That last point is the crux: since the backend is REST-only, "real-time" comes down
to an architecture choice. We chose smart polling because it needs no new infra.

---

## Architecture in one line

Wrap the existing `src/api.js` calls in **TanStack Query** hooks. Query keys give
the cache; `refetchInterval` (tuned per-data-type and gated on tab visibility)
gives near-real-time chat & activity; mutations do optimistic updates and
invalidate the relevant keys. **No changes to `api.js`'s REST calls or the
backend** — we layer on top.

```
Components ──► useQuery / useMutation (new hooks)
                     │
                     ▼
            QueryClient cache  ◄── refetchInterval (polling = "real-time")
                     │
                     ▼
              src/api.js (unchanged REST wrapper)
                     │
                     ▼
        Code On Time backend  /v2/...
```

---

## Phase 1 — Foundation

1. Add deps: `@tanstack/react-query` (+ `@tanstack/react-query-devtools` for dev).
2. Wrap the app in `<QueryClientProvider>` in `src/main.jsx` with a shared
   `QueryClient` (sane defaults: `staleTime`, `gcTime`,
   `refetchOnWindowFocus: true`, retry off for 4xx).
3. New file `src/queryKeys.js` — central key factory so invalidation stays
   consistent, e.g.:
   - `['tasks']`, `['task', id]`
   - `['activity', taskId]`
   - `['messages', taskId]`, `['reactions', taskId]`, `['readMarker', taskId, userId]`
   - `['unread']`, `['lookups']`, `['assignees', taskId]`
4. New file `src/hooks/usePageVisible.js` — tracks `document.hidden` so polling
   pauses when the tab is backgrounded (saves the backend from useless traffic).

## Phase 2 — Caching (covers the whole app)

5. New `src/hooks/queries.js` wrapping the existing `api.js` functions:
   - `useTasks()`, `useLookups()`, `useAllAssignees()` → replace the big
     `loadEverything()` / `reload()` in `src/App.jsx:55`. These get long
     `staleTime` (lookups rarely change).
   - `useUnread()` → replaces `refreshUnread` / `listMyUnread`
     (`src/App.jsx:211`). Light `refetchInterval` (~15–30s) so badges update
     app-wide without reselecting tasks.
   - Benefit immediately: reselecting a task is instant (served from cache),
     background-revalidated.

## Phase 3 — Real-time chat & activity (the core ask)

6. Refactor `src/components/ActivityDiscussion.jsx` (currently one big
   `useEffect`, lines 31–59) into query hooks:
   - `useMessages(taskId)` — `refetchInterval` **~2–4s while the task panel is
     open and tab visible**, paused otherwise.
   - `useReactions(taskId)` — same interval, or piggyback on the messages refetch.
   - `useActivity(taskId)` — slower interval (~8–10s); activity is less
     latency-sensitive than chat.
   - `useReadMarker(taskId, meId)` — no polling needed.
7. **Polling gates** (so it's cheap and respectful):
   - Only poll the **currently open** task (panel mounted).
   - Pause when `document.hidden` (Phase 1 hook).
   - Optionally back off the interval when the window hasn't been focused for a while.

## Phase 4 — Mutations + optimistic reconciliation

8. Convert send/edit/delete/react/read-marker into `useMutation` with `onMutate`
   (optimistic), `onError` (rollback), `onSettled` (invalidate the
   `['messages', taskId]` / `['reactions', taskId]` keys). This preserves the
   optimistic UX already in `ActivityDiscussion.jsx:77-164` but makes it
   cache-aware.
9. **Key correctness detail**: optimistic messages use a temporary negative id
   (`-Date.now()`, line 79). The merge logic when a poll arrives mid-flight must
   not duplicate or drop an in-flight optimistic message — reconcile by id and
   keep pending optimistic rows until their POST resolves. This is the one
   genuinely tricky bit and will be handled explicitly.

## Phase 5 — Polish (optional, recommend at least the first)

10. Keep mock mode working — TanStack Query sits above `api.js`, and `api.js`
    already routes to the mock when `IS_MOCK`. Polling just re-hits the in-memory
    mock, which is fine for dev.
11. Optional niceties polling unlocks cheaply: live unread badge counts (already
    via `useUnread`), a subtle "new messages" indicator, and auto-scroll on new
    inbound messages.

---

## What was deliberately NOT chosen, and why

- **No WebSocket/SSE/long-poll** — the Code On Time backend is REST-only and we
  don't control its server endpoints, so push would mean standing up separate
  infra. Polling gets ~2–4s latency with zero new services. The hook structure
  above means if a realtime service is added later, you swap `refetchInterval`
  for a subscription in *one* place per query — the components don't change.

## Tradeoffs to be aware of

- Polling = extra REST traffic. Mitigated by: visibility gating, polling only the
  open task, and TanStack's request dedupe. Worst case with one task open ≈ one
  small GET every 2–4s.
- "Real-time" latency is the poll interval, not instant. Tunable per data type.

## Rough effort

- Phases 1–2: ~half a day (foundation + app-wide caching).
- Phases 3–4: ~half to one day (chat/activity polling + optimistic mutations,
  mostly reworking `ActivityDiscussion.jsx`).
- Files touched: `package.json`, `src/main.jsx`, `src/App.jsx`,
  `src/components/ActivityDiscussion.jsx`, plus new `src/queryKeys.js` and
  `src/hooks/*`. **`api.js` and the backend stay untouched.**

---

## Suggested rollout

1. **Commit 1** — Phases 1–2 (foundation + caching). Reviewable on its own.
2. **Commit 2** — Phases 3–4 (real-time chat/activity + optimistic mutations).
