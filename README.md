# Candidate Queue & Dispatch Management

A real-time, full-stack queue and dispatch system for candidate interviews.

- **Frontend:** React 19 + Vite + Tailwind CSS v4
- **Backend:** Supabase (Postgres, Auth, Realtime)
- **Hosting:** works on any static host with a free tier (Vercel, Netlify, Cloudflare Pages)

---

## Features

| Area | What it does |
| --- | --- |
| **Auth** | Email/password **or** magic link. Only emails in `allowed_admins` may enter `/admin`. |
| **Admin dashboard** | Header with live counters, a name search, and three live columns: *Not Arrived*, *Arrived*, *Finished*. |
| **Rooms panel** | Always-visible grid above the lists. Inline type editing, delete, and a live **active status** showing exactly which candidates are in each room right now. |
| **Interviewer panels** | A room can host a whole panel. Each room card lists **every** interviewer's name and phone **inline** — no click needed — with tap-to-call on each number. Click the room name or the ✎ to open the panel and add, edit or remove members. |
| **Time in room** | Candidates sitting in a room show a live `⏱️ 12m` counter that recalculates every minute. Past **20 minutes** it turns red and gains a ⚠️ to flag an interview running long. |
| **Late alert** | Candidates whose planned time is **> 15 min** in the past turn red and jump to the top of *Not Arrived*. |
| **Arrival lock** | Interview checkboxes + room assignment stay locked until *Arrived* is ticked. |
| **Arrival stamp** | Ticking *Arrived* stamps the server time into `arrival_time`. |
| **Automatic task** | Choosing a room is enough — the interview is implied by the room's type and set server-side. The task dropdown only appears for a `General` room, which implies nothing. |
| **Auto-assign** | A wand button on every arrived candidate sends them to the least-busy room *anywhere* they can use — whichever of their remaining interviews that happens to be, so no room sits idle — then tells you where they went. A slight preference for the debate decides only exact ties. Hidden once both interviews are done. |
| **The line** | Once somebody arrives, their planned time stops mattering. Every waiting candidate is numbered `1st in line`, `2nd in line` … by arrival, and a **Call next** button dispatches the head of the line (strict FIFO) — somebody mid-interview is never in it. |
| **Conflict of interest** | A candidate can carry a list of restricted interviewers. If **any** member of a room's panel is on it, the whole room is blocked — `(Blocked: Conflict)` and disabled by hand, skipped by Auto-assign, and refused by the database as a backstop. |
| **Auto-release** | Completing either interview instantly clears the room + task assignment. |
| **CSV import** | Hebrew headers (`מס"ד`, `שם מלא`, `טלפון`, `שעה`) are mapped automatically. |
| **Manual CRUD** | Add / Edit / Delete candidates from modals. |
| **QR codes** | Each row can show a QR linking to the public `/candidate/:id` page. |
| **Public page** | Read-only, no auth, live via realtime — shows "proceed to room" or "you are in the queue". |

---

## 1. Apply the database schema

Your project URL and publishable key are already in `.env`.

Now add **one** credential to `.env` so the schema can be applied automatically:

| Option | What to add | Where to get it |
| --- | --- | --- |
| **Access token** *(recommended)* | `SUPABASE_ACCESS_TOKEN=sbp_…` | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) |
| **DB password** | `SUPABASE_DB_PASSWORD=…` | Set when the project was created — *Project Settings → Database* |

Then run:

```bash
npm run db:push
```

This applies [`supabase/schema.sql`](./supabase/schema.sql) — tables, enums,
triggers, RLS policies, the realtime publication, and seed rows — then verifies
the tables are reachable through the REST API.

> **Prefer to do it by hand?** Open **SQL Editor → New query** in the dashboard,
> paste the contents of `supabase/schema.sql`, and click **Run**.

## 2. Admin account

`npm run db:push` creates the admin login for you, using the `ADMIN_EMAIL` and
`ADMIN_PASSWORD` values in `.env`. The account is created **pre-confirmed**, so
no verification email is needed, and the schema seed adds the same address to
`allowed_admins`.

**Current admin:** `idc.debate@gmail.com`

To add more admins later:

1. **Authentication → Users → Add user** — create the email + password.
2. **Table Editor → `allowed_admins`** — insert a row with that same email.

## 3. Run locally

```bash
npm install
npm run dev
```

| Route | Purpose |
| --- | --- |
| `/login` | Staff sign in |
| `/admin` | Dispatch dashboard (protected) |
| `/candidate/:id` | Public live status page (no auth) |

---

## CSV format

Any of these headers are recognised (quotes and whitespace are ignored, so
`מס"ד`, `מס״ד`, and `מס ד` all work):

```csv
מס"ד,שם מלא,טלפון,שעה
1,ישראל ישראלי,050-1234567,09:30
2,דנה כהן,0529876543,09:45
```

English headers (`serial`, `name`, `phone`, `planned time`) also work as a fallback.
Rows without a name are skipped, and 9-digit phone numbers automatically get
their leading `0` restored.

---

## Deploying for free

### Vercel (recommended)

1. Push this folder to a GitHub repository.
2. Import it at [vercel.com](https://vercel.com) — the Vite preset is detected automatically.
3. (Optional) Add `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` in
   **Settings → Environment Variables**. This is not required — the values fall
   back to the defaults hardcoded in `src/lib/supabase.js`.
4. Add a **rewrite** so client-side routes work. Create `vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

### Netlify

Build command `npm run build`, publish directory `dist`, plus a `public/_redirects`
file containing `/* /index.html 200`.

### Cloudflare Pages

Build command `npm run build`, output directory `dist`. SPA routing is handled
automatically when you set the project to a single-page app.

> **Note on free tiers:** Supabase pauses idle projects after ~1 week of
> inactivity (just un-pause from the dashboard) and Vercel/Netlify/Cloudflare
> Pages free tiers are generous for this kind of internal tool.

---

## How the realtime + automation works

Every business rule lives in the database, so it holds even if a client
misbehaves or rows are edited straight through the REST API:

- **Rule 1 — arrival is a precondition.** While `has_arrived` is false the
  candidate cannot hold a room, a task or interview results; a trigger wipes
  them. Un-ticking "Arrived" therefore performs a clean reset (the UI asks for
  confirmation first).
- **Rule 2 — arrival stamping.** Ticking "has arrived" stamps the server clock
  into `arrival_time` (on insert too).
- **Rule 3 — auto-release.** Completing either interview clears the room and
  task assignment instantly.
- **Rule 4 — no orphan state.** A task without a room is normalised away, and
  deleting a room also clears the paired task.
- **Rule 5 — the in-room clock.** `room_entry_time` is written by the server the
  moment a candidate is put in a room — and restarted if they are moved to a
  different one — then cleared the moment they leave, whether that is an
  auto-release, un-ticking "Arrived", or their room being deleted. Because the
  column is derived on the server, a client cannot backdate it; that is what
  makes the admin's ⏱️ counter trustworthy.
- **Rule 6 — the task follows the room.** The interview a candidate is there for
  is a property of the room, not a separate choice: a `Debate` room means a
  Debate Interview, a `Personal` room a Personal Interview. The server sets it
  on assignment (and on insert) and ignores a client that claims otherwise, so
  the two can never disagree. A `General` room is the one case the database
  cannot infer, so there the admin's own choice is left untouched and the card
  keeps its task dropdown. Changing a room's *type* re-derives the task for
  everyone standing in it.
- **Rule 7 — interviewers a candidate must not meet.** `interviewer_constraints`
  holds the names a candidate is barred from. A room holds a **panel** —
  `rooms.interviewers`, a JSON array of `{ name, phone }` — and a single member
  on the candidate's list disqualifies the whole room. The match is trimmed and
  case-insensitive (`  DANIEL ` blocks `daniel`, but `Dana` does not), and a room
  with an empty panel can never conflict — nobody recorded means "nobody in
  particular", not "everybody". The panel is tidied on the way into the table
  (names trimmed, blanks dropped, duplicates collapsed case-insensitively, an
  empty phone stored as null, entries ordered by name), so the rule only ever
  compares clean names. The rule is enforced on **insert as well as update** and
  simply refuses the row, so it still holds for a client that bypasses the
  greyed-out dropdown and PATCHes the REST API directly. Releasing a candidate
  from a room is never blocked.

On the client, `useCandidates` subscribes to `postgres_changes` on `candidates`
and `rooms`, and takes its initial snapshot *after* the channel reports
`SUBSCRIBED` — fetching earlier would leave a window where a row inserted by
another admin is neither streamed nor fetched. The public page additionally
polls every 30s as a safety net.

## Auto-assign

Each arrived candidate still owing an interview has a **wand button** on their
card. One click sends them to the room the board can best afford to use, and a
toast reports where they went: *"Candidate assigned to A206 for Debate Interview."*

The decision is a small pure function in `src/lib/autoAssign.js`, so the rules can
be read (and tested) without a database or a browser:

1. **Which interviews could they take?** `neededTasks` returns the set of valid
   paths. A candidate with only one interview left is *forced* down that track. A
   candidate who still owes both can be sent down **either**, and that is the
   whole point of the algorithm.
2. **Which rooms may host each of those?** A *Debate* path may use `Debate` rooms,
   a *Personal* path `Personal` ones; a `General` room counts for either, since it
   has no specialism of its own. Rooms with a panel member on the candidate's
   `interviewer_constraints` list are dropped *before anything is counted*, so a
   blocked room can neither be picked nor distort how busy its track looks.
3. **Which placement is best?** One linear pass over every room of every track
   they need, keeping the best seen. Best means, in order:

   1. **Fewest people already in the room** — an empty room (0) beats any occupied
      one, and otherwise the shortest queue does. *No room is left idle while a
      candidate could be sitting in it.*
   2. **Debate before Personal** — the only tie-break that favours the debate, and
      it is only consulted when the two tracks are *equally* busy.
   3. **A dedicated room before a `General` one** — the wildcard serves either
      interview, so it is worth keeping in reserve.
   4. **Room name** — so the same board always produces the same pick rather than
      depending on the order rows happened to arrive in.

Comparing *rooms* across both tracks is the same comparison as comparing the two
tracks' minimum queue lengths (the minimum over a union is the smaller of the
minimums), but it also gets two things right that per-track minimums cannot: a
blocked room simply is not a placement, and a `General` room is one room serving
either interview rather than being double-counted in both pools.

> **Why this matters.** The earlier rule always sent a both-interviews candidate
> to the debate, "because the debate comes first", which let a debate queue grow
> to forty while personal rooms stood empty. Global throughput now wins: only the
> tie-break remembers the debate.

If *both* tracks are dead the click is refused, with a message that says which
kind of dead end it is:

- no room of the needed kind exists at all → *"No Debate or General room is
  available for a Debate Interview."* (or, when both tracks are affected, *"No
  room is available for a Debate or Personal interview."*)
- rooms exist but every one is off-limits → *"Auto-Assign Failed: All applicable
  rooms have a restricted interviewer for this candidate."* — a blocked
  assignment must never hide behind a generic "no rooms" message.

The queue is counted from the database at click time, not from the last realtime
snapshot, because the point of the button is to balance the load that actually
exists — another admin may have assigned somebody a second ago. The candidate
being moved is excluded from the count: they are on their way out of their
current room, so counting them would make the room they are leaving look busier
than it is. That also makes the button safe to press twice — landing in the room
they are already in is a genuine no-op, and their ⏱️ timer keeps running.

The choice is logged with both tracks' minimums (`debateMin` / `personalMin`), so
a look at the Debug panel explains *why* a track won.

### The line: first to arrive is first to go

**Planned time decides nothing once somebody has walked in.** It orders the *Not
Arrived* list (who is expected, who is late) and it stops there. The moment a
candidate arrives, the server stamps their arrival time (Rule 2), and from then on
their arrival is their time.

The *Arrived* column is sorted by arrival (oldest first), every waiting candidate
carries their place in the line — `1st in line`, `2nd in line` … — and the
**Call next** button above the lists dispatches the head of the line:

- The button names who is next (`Call next — Yossi Cohen`) and how many are behind
  them, and it is disabled when nobody is waiting.
- *Waiting* means arrived, still owing an interview, and **not standing in a
  room**. Somebody mid-interview is never pulled out of it.
- It is **strict FIFO**. If the head of the line cannot be placed — no room of the
  type they need, or every such room has a restricted interviewer — the button
  names them and stops rather than quietly promoting somebody who arrived later.
  The per-candidate wand is still there when the admin wants to override.
- A row with no arrival stamp sorts **last**, never first: unknown must not jump
  the queue.

The computational part is `waitingInLine` / `queuePositions` / `isWaiting` in
`src/lib/autoAssign.js`; positions are computed from the *whole* board, so
searching does not renumber who is actually next. Inside each room card the
occupants are listed longest-waiting first, so the interviewer can see who has
been in that room the longest without doing sums.

If no room of the needed type exists you get an error toast instead. Two admins
clicking at the same instant can still pick the same room; the assignment is
last-write-wins, exactly as if they had used the room dropdown by hand.

## Logging & debugging

A small dependency-free logger (`src/lib/logger.js`) plus a Supabase
middleware (`src/lib/supabase.js`) trace everything that happens:

```
15:14:10.906 DEBUG auth      verify admin (initial) (223ms)
15:14:10.680 DEBUG db        → candidates · select(*) → order(created_at)
15:14:11.106 DEBUG db        ✓ candidates · select(*) → order(created_at) (226ms, 49 rows)
15:14:10.907 INFO  admin     dashboard mounted     { user: "idc.debate@gmail.com" }
15:14:12.041 ERROR admin     patch failed — reloading to resync  { code: "42501", … }
```

- **Scopes**: `app`, `db`, `db:<table>`, `auth`, `data`, `route`, `admin`, `csv`,
  `crash`, `global`.
- **In-app Debug panel**: the button in the bottom-left corner (or
  <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd>) opens a live log with level and
  text filters, pause, copy and clear. It is hidden on the public
  `/candidate/:id` page.
- **Level control, no rebuild**: add `?log=debug` to the URL (also
  `info`/`warn`/`error`/`silent`), or set `cq:logLevel` in `localStorage`, or run
  `cq.log.setLevel('debug')` in the browser console.
- **Crash safety net**: an `ErrorBoundary` plus `window.onerror` /
  `unhandledrejection` handlers log to the same buffer, and the boundary offers
  a "Copy diagnostics" button (stack trace + the full log).

## Testing

```bash
npm test          # logic + components          (237 tests, jsdom)
npm run test:db   # live database               (Rules 1–7 + strict privacy)
npm run test:e2e  # real browser                (Playwright, read-only by default)
npm run test:all  # all four layers
```

Four layers, because the rules live in four different places: pure functions and
components under Vitest + React Testing Library, Rules 1–7 and the anonymous-read
guarantees against the **real** database, and Playwright for the real UI. The
business logic is at ~100% statement coverage.

The full strategy, the coverage table and a step-by-step **manual exploratory
checklist for event day** are in [`docs/TESTING.md`](./docs/TESTING.md).

## Security notes

- RLS is enabled on every table. Only authenticated users whose email is in
  `allowed_admins` can write (`public.is_admin()`).
- **Interviewer identities are not readable anonymously.** Row-level security
  cannot hide a single column, so the `anon` role's `SELECT` on `rooms` is
  narrowed to the three columns the public page actually renders — `id`,
  `room_name`, `room_type`. Asking for `interviewers` or `*` with the publishable
  key returns `401 permission denied for table rooms`, so a candidate cannot open
  the network tab, replay the request and see who is interviewing them. The whole
  panel lives in one column, which makes this a single, easy thing to keep shut.
  Signed-in admins are unaffected.
- **Anonymous visitors can read the `candidates` table.** This is required for the
  public `/candidate/:id` page and its realtime subscription. It means anyone
  with the anon key could query all candidate rows.
  - For an internal event this is usually acceptable.
  - To harden it, expose a reduced view (or a `security definer` RPC) instead of
    the raw table and enable realtime on that instead. Ask and this can be
    swapped in.
- The public page requests only the columns it renders — `name`, `planned_time`,
  `arrival_time`, the assignment fields and the two interview flags. A
  candidate's **serial number and phone number are never sent to their browser**,
  and the serial is not shown on that page at all.
- The `anon` key is safe to ship in a frontend **only** because RLS restricts
  writes. Never put the `service_role` key in the frontend.

---

## Project structure

```
src/
  components/     Column, CandidateCard, RoomsPanel, InterviewerModal, modals,
                  toast, guards, BrandMark, ErrorBoundary, DebugPanel, RouteLogger
  hooks/          useAuth (session + admin check), useCandidates (data + realtime)
  lib/            supabase client + query middleware, logger, csv, time,
                  autoAssign, conflicts, monitoring
  pages/          Login, Admin, CandidateView
public/
  ru-debate.png   App logo — drop the artwork here (see public/README.md)
scripts/
  apply-schema.mjs  `npm run db:push` — applies the schema from the CLI
supabase/
  schema.sql      One-shot database setup (tables, RLS, automation triggers)
tests/
  unit/           Vitest — pure logic (time, conflicts, autoAssign, csv) and
                  components (Admin's three lists, an edit reaching the screen,
                  the rooms panel clock/queue, the Auto-Assign button,
                  CandidateCard, InterviewerModal, CandidateView)
  db/             Rules 1–7 and the privacy guarantees, against the live project
  e2e/            Playwright — the real UI, read-only unless you opt in
docs/
  TESTING.md      Test strategy, coverage, and the manual exploratory checklist
```

## Branding

Save the society logo as **`public/ru-debate.png`** — no code change needed. It is
used as the favicon, the iOS/Android home-screen icon, the mark on the sign-in
screen and the dashboard header. It is deliberately **not** shown on the public
candidate page, which stays plain. A square image of 512×512 or more is ideal.

If the file is absent the UI falls back to a plain **CQ** badge, so a deploy
without the artwork never shows a broken image.

## Design tokens

The theme is defined in `src/index.css` using Tailwind v4 `@theme`, with the
palette stored as `oklch()` values (warm off-white background, dark-green
primary, mint accent, plus `status-debate` / `status-initial` / `status-arrived`
accents used by the room dots and list headers).

Manrope is the display font — it has no Hebrew glyphs, so Hebrew names fall back
to Heebo via the font stack.
