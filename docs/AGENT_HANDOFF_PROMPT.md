# Agent Handoff Prompt — Candidate Queue & Dispatch Management

Copy the prompt below into the new agent's first message. It is written for an
agent that has no context from the previous session and will work directly in
this repository.

---

## Prompt

You are taking over **Candidate Queue & Dispatch Management**, a live production
app used to run candidate interviews. It is a React/TypeScript SPA on Netlify
with Supabase Postgres, Auth and Realtime. Treat production data as real: do not
run destructive SQL, do not delete rows you did not create, and do not print or
commit credentials.

### Current state (as of 2026-11-06)

- Multi-event Back Office is shipped, migrated and deployed.
- `main` is clean at `6de03e7` and synchronized with `origin/main`. This handoff
  file may still be untracked until you commit it. The only unrelated untracked
  path is `wedding-rsvp/`, which is user work — do not touch it, and never
  commit it.
- Unit suite: **363 tests passing**. Typecheck and production build pass.
- Live database rule/privacy/ledger suites pass.
- Production has one `Active` event, **Main event**, created by the migration.
  It currently reports **54 candidates and 4 rooms**. At migration time it had
  55 candidates; **Dan Volovsky (#172)** was deleted afterwards and his ledger
  rows remain. Verify current data before treating this as a regression.
- `SUPABASE_ACCESS_TOKEN` in `.env` last returned **401 Invalid access token**
  (checked 2026-11-04). Generate a fresh token before the next `bun run db:push`.
- The owner still needs to revoke the temporary Netlify personal access token
  from the earlier deployment setup.

### First 10 minutes

1. Read `README.md`, `docs/ARCHITECTURE.md` (especially section 10),
   `docs/DEPLOYMENT.md` and `docs/TESTING.md`.
2. Read `supabase/schema.sql`, `src/services/database.ts`,
   `src/services/supabaseDatabase.ts`, `src/App.tsx`,
   `src/hooks/useCurrentEvent.tsx`, `src/pages/EventHub.tsx`,
   `src/pages/EventPlanner.tsx` and `src/hooks/useEventPlanner.ts`.
3. Run `bun run typecheck` and `bun run test`. If Bun/Vitest fails on the
   non-ASCII repository path, use the mirror workaround below.
4. Do not modify production data until you have read the event-scoping and
   testing sections.

### Product map

Public:

- `/candidate/:id` — read-only live status page, no auth.

Staff (all admin-gated):

- `/login` — password or magic link.
- `/admin` — Back Office hub: Upcoming / Active / Past events, counts, and
  `Open Live Queue`, `View Analytics`, `Edit Settings`.
- `/admin/event/new` — three-step planner: details → rooms → CSV roster.
- `/admin/event/:id/queue` — live dispatch board for one event.
- `/admin/event/:id/analytics` — ledger-driven analytics for one event.
- `/room/:roomId` — in-room board and the Personal Interview rubric.

Old `/admin/analytics` is a compatibility redirect to the hub.

Core features: live candidate columns (Not Arrived / Arrived / Finished),
arrival lock and stamp, room-derived interview task, auto-assign, FIFO call
next, interviewer-conflict blocking, QR codes, CSV import, room rubric,
evaluation records, append-only movement ledger, analytics.

### Stack and commands

- React 19, TypeScript strict, Vite 6, Tailwind CSS v4, React Router 7,
  Supabase JS 2.47, Recharts 3, Zod, PapaParse.
- Bun 1.2.19 is the package manager and runtime. Do not introduce npm tooling.
- `bun install`
- `bun run dev`
- `bun run typecheck`
- `bun run test`
- `bun run build` (typecheck first, then Vite build)
- `bun run test:db` (live database rules + privacy + ledger)
- `bun run test:e2e` (Playwright)
- `bun run db:push` (apply `supabase/schema.sql` via Management API)

### Architecture rule

```text
core → domain → services → hooks → components → pages
```

Nothing points backwards.

- `core/` — env, shared types, logging, constants. No React/Supabase.
- `domain/` — pure rules and maths. No I/O.
- `services/` — repository contracts and the Supabase adapter.
- `hooks/` — orchestration, fetching, subscriptions, optimistic writes.
- `components/ui/` — dumb primitives.
- `components/features/` — feature components driven by props/hooks.
- `pages/` — routing composition only.

Supabase table knowledge belongs only in `src/services/supabaseDatabase.ts`.
Hooks use `useServices()`; components never import Supabase. If a rule is pure,
put it in `domain/` and test it there.

### Data model and invariants

- `events`: UUID id, name, date (`YYYY-MM-DD`), status
  `Draft | Active | Completed`, notes, created_at.
- `candidates`, `rooms`, `evaluations` each carry `event_id uuid not null` with
  an FK to `events`.
- `candidate_events` is append-only and has **two different concepts**:
  - `event` — text movement kind (`arrived`, `assigned`, `released`,
    `completed`, …);
  - `event_id` — the interview day the movement belongs to.
  Never confuse them.
- `allowed_admins` drives admin access; RLS is the real security boundary.

Database triggers enforce:

- a candidate or room cannot be moved to another event;
- a candidate cannot be assigned a room from another event;
- an evaluation derives its `event_id` from its candidate and rejects a room
  from another event;
- a ledger row derives its `event_id` from its candidate, even if a caller
  supplies a wrong one;
- an event with ledger history cannot be deleted; a draft with no history can
  be deleted and cascades its rooms/roster.

### Event-scoping contract (critical)

- The URL is the source of truth: `/admin/event/:id/...`.
- `CurrentEventProvider` resolves the event once and exposes
  `{ eventId, event, loading, error }` through `useCurrentEvent()`.
- Every repository **list** method takes an `eventId`; the adapter must add
  `.eq('event_id', eventId)` before other filters.
- Realtime channels must add `filter: event_id=eq.${eventId}`.
- Creating candidates/rooms/imports must pass the event id explicitly.
- Updates use the row's unique id; the database backstops cross-event moves.
- The public room projection must stay `id, room_name, room_type` because anon
  has only those column grants. Staff reads use `findByIdWithEvent`.
- The planner creates the event as `Draft`, then rooms, then roster. Because a
  browser cannot hold one PostgREST transaction, it compensates: on failure it
  deletes the draft event. Do not replace this with silent partial setup.
- The hub groups by lifecycle, not by date. Activating/completing an event is an
  explicit `Edit Settings` action.

### Migration and deployment

- `supabase/schema.sql` is idempotent and additive.
- On a legacy database it creates an `Active` event named `Main event` and
  adopts every existing candidate, room, evaluation and ledger row.
- Apply the schema **before** deploying a client that writes `event_id`. This
  has already been done in production; keep that order for any future schema
  change.
- `bun run db:push` needs a valid `SUPABASE_ACCESS_TOKEN` or
  `SUPABASE_DB_PASSWORD` in `.env`. Credentials are git-ignored; never print or
  commit them.
- Netlify auto-deploys from `main` through `netlify.toml`. After a deploy,
  verify the production bundle contains the new feature strings, then smoke the
  hub, queue, analytics and a room link with no console errors.

### Testing and the Windows caveat

- `tests/unit` is Vitest + Testing Library with fakes; no network.
- `tests/db` talks to the **configured Supabase project** and creates
  `ZZQA-*` scratch rows that clean themselves up. It is not a mock. Be careful;
  never point it at a database you do not intend to touch, and never add a test
  that deletes non-`ZZQA-*` data.
- `tests/e2e` is Playwright against the built app.
- On this Windows machine the repository path contains Hebrew characters and
  Bun/Vitest can mis-handle it. Reliable workaround: mirror the repo to an ASCII
  temp path, exclude `node_modules`, `.git`, `dist` and `wedding-rsvp`, then
  junction `node_modules` to the real repository and run tests there. Example
  destination: `C:\Users\User\AppData\Local\Temp\opencode\cq-test`.
- Before any push: `bun run typecheck`, `bun run test`, `bun run build`.
- After any schema change: `bun run test:db` and a production smoke test.
- Playwright may fail to launch on this Windows host; the desktop browser tool
  can be used for visual smoke tests instead.

### Production facts

- Live app: `https://debate-queuing-system.netlify.app`
- Supabase project ref: `zhfrferzepxshdryuazq`
- Netlify site ID: `8824fb88-f403-490f-a6cd-56f1f17a34e3`
- Admin email: `idc.debate@gmail.com`
- Credentials live in `.env` only. Never commit or echo them.
- Current event: `Main event`, `Active`, created by the migration.
- Current data caveat: 54 candidates / 4 rooms. Dan Volovsky (#172) is the one
  row missing versus the migration-time 55; his ledger rows remain.
- Pending owner actions: refresh the Supabase access token; revoke the temporary
  Netlify PAT.

### Guardrails

- Do not run `DROP`, `TRUNCATE`, bulk `DELETE`, or schema rewrites against
  production without explicit approval and a current backup.
- Do not remove event filters from repositories or realtime channels.
- Do not change the public room column grants or projection without checking
  anonymous access.
- Do not mix `candidate_events.event` with `candidate_events.event_id`.
- Do not edit or commit `wedding-rsvp/`, `.env`, `dist/` or `node_modules/`.
- Preserve the SOLID layering; do not put fetch logic in components or business
  rules in pages.
- If you add a repository method, update the contract, the Supabase adapter and
  every fake used in tests.

### Known follow-ups

- Restore Dan Volovsky only if the deletion is confirmed accidental. His field
  values were captured during the migration comparison; there is no retained
  local backup file.
- Add direct unit tests for `useCandidates` / `useQueueActions` event scoping
  (current tests mostly mock the hooks).
- Exercise the planner end-to-end in production with a scratch event, then
  delete it. A draft event with no ledger history deletes cleanly.
- Refresh the Supabase access token before the next `db:push`.
- Revoke the temporary Netlify token.
- Optional UX polish: the hub card action buttons wrap tightly on narrow cards.

### How to report work

When you finish a change, report:

1. What changed and why.
2. Files touched.
3. Commands run and their results (typecheck, unit, DB, build, deploy).
4. Production verification performed.
5. Any remaining risk, data caveat or credential action.

Do not claim a deploy or migration succeeded without checking the live target.
