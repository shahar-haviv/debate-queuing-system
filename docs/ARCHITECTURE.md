# Architecture

A tour of how this repository is put together, why each layer exists, and where
to put new code. The goal is the boring kind of enterprise-ready: a new
developer can change one thing without reading everything, and swapping the
backend does not touch a single component.

---

## 1. The dependency rule

```text
core  →  domain  →  services  →  hooks  →  components  →  pages
```

An arrow means "may import". Nothing points back.

| Layer | Owns | Must not |
| --- | --- | --- |
| `core/` | env parsing, shared types, constants, logging, monitoring | import React, Supabase, or domain rules |
| `domain/` | pure business rules (time, conflicts, placement, rubric, ledger maths) | import React, Supabase, or anything with I/O |
| `services/` | persistence contracts, the Supabase adapter, dependency injection | import components or hooks |
| `hooks/` | orchestration: load, subscribe, optimistic writes, derive | import Supabase directly, or render JSX |
| `components/ui/` | dumb Tailwind primitives | fetch, subscribe, or know the domain |
| `components/features/` | one feature, wired through props and hooks | reach into another feature's state |
| `pages/` | routing-level composition | contain business rules |

If a rule can be tested with plain values, it belongs in `domain/`. If it needs
`await`, it belongs in `services/` or a hook. If it needs a click, it belongs in
a component.

---

## 2. Commands

Everything is Bun. There is no npm lockfile and no Node-only tooling.

```bash
bun install              # install from bun.lock
bun run dev              # Vite dev server
bun run typecheck        # tsc --noEmit (strict)
bun run build            # typecheck, then vite build into dist/
bun run test             # Vitest unit + component suite (357 tests)
bun run test:coverage    # the same, with a v8 coverage report
bun run test:db          # live database rules + privacy (needs credentials)
bun run test:e2e         # Playwright
bun run test:all         # all four layers
bun run db:push          # apply supabase/schema.sql via the Management API
```

`bun run build` deliberately runs `tsc` first. A type error is a build failure,
not a warning in a log nobody reads.

> **Windows + non-ASCII folder names.** Bun 1.2.19 can fail to resolve
> `node_modules/.bin` when the project path contains Hebrew (or any non-ASCII)
> characters, and Vite/Vitest can mis-handle the same path. If
> `bun run typecheck` says `command not found: tsc`, run the tool through its
> entry point instead (`node node_modules/typescript/bin/tsc --noEmit`) or move
> the checkout to an ASCII path. Netlify (Linux) is unaffected.

---

## 3. Folder tree

```text
src/
  core/
    env.ts             zod schema + getEnv()/envStatus
    types.ts           entities and narrow projections
    constants.ts       task/room names, thresholds
    logger.ts          levelled, timestamped, ring-buffered logging
    monitoring.ts      window.onerror / unhandledrejection
  domain/
    time.ts            clock maths, formatting, lateness
    conflicts.ts       restricted-interviewer rules
    autoAssign.ts      needed tasks, room filtering, placement, FIFO line
    rooms.ts           who is in a room, longest-waiting first
    csv.ts             Hebrew header mapping, dedupe keys
    evaluation.ts      the 22-question Hebrew rubric (verbatim)
    analytics.ts       ledger → KPIs and chart series
    candidateRules.ts  client mirror of the database trigger
  services/
    database.ts        DatabaseService + repository interfaces
    supabase.ts        env-driven client + query-logging proxy
    supabaseDatabase.ts the adapter implementing every interface
    container.tsx      ServicesProvider / useServices / getServices
  hooks/
    useCandidates.ts   live read model + optimistic local mutators
    useQueueActions.ts every write, results or throws
    useQueueLogic.ts   derived columns, search, line positions
    useEvaluations.ts  one room's rubrics + file/release
    useCandidate.ts    the public page's projection
    useAnalytics.ts    ledger loading + aggregates
    useAuth.tsx        session, admin check, sign in/out
  components/
    ui/                Button, Card, Modal, Column, Toast, BrandMark,
                       ConfigBanner, ErrorBoundary, DebugPanel
    features/          CandidateQueueList, CandidateCard, RoomsPanel,
                       InterviewerModal, AddEditCandidateModal, QrModal,
                       EvaluationForm, RequireAdmin, RouteLogger
  pages/               Login, Admin, Analytics, RoomView, CandidateView
  App.tsx              routes + the startup configuration gate
  main.tsx             composition root (providers)
```

---

## 4. Configuration: validated, never hardcoded

`src/core/env.ts` is the only place that reads `import.meta.env`. There are two
entry points on purpose:

```ts
export const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().trim().url('must be the full https://<project>.supabase.co URL'),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(20, 'must be the project publishable (anon) key'),
  VITE_APP_ENV: z.enum(['development', 'preview', 'production']),
  VITE_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
})

// Used by services: throws with a fixable message.
export function getEnv(): AppEnvironment

// Used by main.tsx/App.tsx: never throws, so the app can explain itself.
export const envStatus = parseEnv(import.meta.env as unknown as Record<string, unknown>)
```

- A missing key can never become `fetch("undefined/rest/v1/...")`; the service
  layer calls `getEnv()` and fails immediately.
- `main.tsx` checks `envStatus.ok` *before* constructing any provider and renders
  `ConfigBanner` with the exact zod problems. No white screen.
- `.env.example` is committed with placeholders; `.env` is git-ignored.
- No URL or key appears in a component, a test fixture, or the README.

The publishable key is public by design (row-level security is the access
control), but it is still configuration, and it never belongs in source.

---

## 5. The database seam (Dependency Inversion)

`src/services/database.ts` defines what the app needs, not what Supabase offers:

```ts
export interface CandidateRepository {
  list: () => Promise<Candidate[]>
  listAssignments: () => Promise<CandidateAssignment[]>   // id + assigned_room only
  listDedupeRows: () => Promise<CandidateDedupeRow[]>
  findById: (id: string) => Promise<Candidate | null>
  findPublicById: (id: string) => Promise<PublicCandidate | null>  // no phone/serial
  create: (input: NewCandidate) => Promise<Candidate>
  update: (id: string, patch: CandidatePatch) => Promise<Candidate>
  remove: (id: string) => Promise<void>
  importMany: (rows: NewCandidate[]) => Promise<Candidate[]>
}

export interface DatabaseService {
  candidates: CandidateRepository
  rooms: RoomRepository
  evaluations: EvaluationRepository
  ledger: LedgerRepository
  auth: AuthGateway
  realtime: RealtimeGateway
}
```

`src/services/supabase.ts` builds the client from the validated environment and
wraps every query in a logging proxy:

```ts
export function createSupabaseClient(): SupabaseClient {
  const env = getEnv()
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { ... })
  return withQueryLogging(client)
}
```

`src/services/supabaseDatabase.ts` is the only file that mentions Supabase
tables. `src/services/container.tsx` injects it:

```tsx
<ServicesProvider>          {/* builds the real adapter once */}
  <AuthProvider>
    <App />
  </AuthProvider>
</ServicesProvider>
```

Hooks never import the client; they call `useServices()`:

```ts
const { candidates: candidateRepo } = useServices()
```

That is what makes the tests fast and honest: a test can supply a fake
`DatabaseService` and assert the exact repository calls, or mock the Supabase
client's query builder and let the real adapter run. Swapping in Firebase means
writing one adapter, not touching a component.

---

## 6. The worked example: `CandidateQueueList`

`src/components/features/CandidateQueueList.tsx` is the flagship extraction. It
used to be 230 lines inside `Admin.tsx`, mixed with fetching, toasts, and
imports. It is now a presentation component with a narrow contract:

```ts
export interface CandidateQueueListProps {
  candidates: Candidate[]
  rooms: Room[]
  loading: boolean
  busyIds: ReadonlySet<string>
  onPatch: (id: string, patch: CandidatePatch) => unknown
  onEdit: (candidate: Candidate) => void
  onDelete: (candidate: Candidate) => void
  onShowQr: (candidate: Candidate) => void
  onAutoAssign: (candidate: Candidate) => void
  onCallNext: (head: Candidate | undefined) => void
}
```

**Single Responsibility.** The component owns two things: the search box and the
clock used for the LATE badge. It does not fetch, subscribe, write, or decide
what a click means. `Admin` owns orchestration; `useQueueLogic` owns sorting;
`CandidateCard` owns one row; `domain/autoAssign.ts` owns placement.

**Separation of Concerns.** Derived state is not recomputed by hand:

```ts
const { notArrived, inProgress, finished, waiting, positions, lateCount } =
  useQueueLogic(candidates, query, clock)
```

The page above decides *what* "Call next" means (read the queue, choose a room,
write, toast). The list only reports *who* is at the head. That is why the list
can be rendered in a test with seven plain props and no router, no Supabase, and
no fake timers beyond one clock.

**Open/Closed.** Adding a fourth column, a filter, or a bulk action is a change
in this file's render tree. The page contract does not change, and the card does
not know the column exists. Adding a new kind of card action means adding a prop
and a button; it does not mean editing `Admin`.

**Liskov.** Every entity passed to the list satisfies the `Candidate`/`Room`
interfaces. The analytics screen uses narrower projections (`CandidateAssignment`,
`PublicCandidate`) that are structural subsets, so the same rules apply without
casts.

**Interface Segregation.** The list receives `Candidate[]`, not the whole
`DatabaseService`. The load-balancing path asks the repository for
`id + assigned_room` only (`listAssignments`), and the public page asks for
`PublicCandidate`, which has no phone or serial number at all.

**Dependency Inversion.** The list has no I/O. `Admin` gets its writes from
`useQueueActions()`, whose repository arrives through `useServices()`. Tests
inject a fake, production injects Supabase, and no file in `components/` mentions
either.

---

## 7. Writes: results, not toasts

`useQueueActions()` returns values or throws; it never decides how a failure
looks. `Admin` turns those outcomes into toasts:

```ts
const placement = await actions.choosePlacement(head, rooms)
if (placement.reason === 'no-room') { notify(..., 'error'); return }
if (placement.reason !== 'ok') { ... }
await patchCandidate(head.id, { assigned_room: placement.room.id, ... })
```

Optimistic updates mirror the database trigger in
`domain/candidateRules.ts`, and the server response is applied immediately
afterwards. A superseded response is ignored via a per-candidate sequence
number, so two fast clicks cannot reorder the board.

---

## 8. Tests and the quality gate

- `tests/unit` is Vitest + Testing Library, with `jsdom` and MSW-free fakes.
- Pure rules are tested directly (`tests/unit/autoAssign.test.js`).
- Pages are tested through their real hooks where practical; the fake lives at
  the `services/supabase` seam so the adapter itself is exercised.
- `tests/db` asserts the database invariants (RLS, triggers, ledger) against the
  live project.
- `tests/e2e` is Playwright against the built app.

Before any push: `bun run typecheck`, `bun run test`, `bun run build`. All three
must be green. The app is live, so deployment is not the place to discover a
type error.

---

## 9. Adding a feature (checklist)

1. Write the rule in `domain/` with plain inputs. Add a unit test.
2. Add the method to the narrowest repository interface in `services/database.ts`.
3. Implement it in `supabaseDatabase.ts` (and in fakes used by tests).
4. Expose it through a hook in `hooks/`, not a component.
5. Render it in a `components/features/` component that takes props.
6. Wire it in a page; turn results into toasts there.
7. Run the three commands in section 8.
