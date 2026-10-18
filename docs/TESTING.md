# Testing

Four layers, because the system has four different kinds of truth in it. Each
layer tests the thing that can only be tested there, and nothing is tested twice
just to make a number look better.

| Layer | Runner | Files | What it can prove | Speed |
| --- | --- | --- | --- | --- |
| **Logic** | Vitest | `tests/unit/*.test.js` | Sorting, lateness, timers, the Auto-Assign decision, conflict matching (including over a panel), CSV parsing, the in-room queue order, and the rubric's own wording and validation | ~1s |
| **Components** | Vitest + React Testing Library | `tests/unit/*.test.jsx` | The three lists, the card's locked state, the blocked room options, the room's interviewer panel, the public page's payload, and the in-room rubric from blank form to filed evaluation | ~17s |
| **Database** | plain Node | `tests/db/*.test.mjs` | Rules 1–7 (triggers), and exactly what an anonymous visitor can read and write — including the evaluation table they cannot touch at all | ~15s |
| **End-to-end** | Playwright | `tests/e2e/*.spec.js` | The real UI against the real board, in a real browser | ~60s |

```bash
npm test          # logic + components    (295 tests, ~18s)
npm run test:db   # live database          (86 assertions)
npm run test:e2e  # browser                (22 tests; 2 opt-in, 3 data-gated)
npm run test:all  # all three
```

`npm run test:coverage` writes an HTML report to `coverage/`.

---

## 1. Logic — `tests/unit/*.test.js`

Pure functions, no DOM, no network. This is where the rules that were *most*
likely to be quietly wrong are pinned down.

### `time.test.js` — the clock, and the 15-minute alert

The boundary is the interesting part, not the middle:

- **14:59 is not late, 15:00 is not late, 15:01 is late.** The rule is "more than
  15 minutes", so a candidate exactly 15 minutes late is *not* flagged. This is
  asserted at all three points, because an off-by-one here silently nags a
  candidate who is on time.
- `minutesInRoom` counts whole minutes, and flags "running long" at **exactly 20**
  — 19 minutes is fine, 20 is not.
- A server clock ahead of the browser must never render `-1m`: a future stamp
  clamps to `0`.
- `75` formats as `1h 15m`, not `1h 5m`.
- Junk (`''`, `null`, `'24:00'`, `'09:60'`) returns `null` rather than `NaN`.

### `autoAssign.test.js` — the wand button

The decision is asserted piece by piece, then as a whole:

1. **Paths** — `neededTasks` returns the set of valid paths: one for a forced
   candidate, two for a candidate who still owes both, none once they are done
   (or before they arrive). The debate is listed first, so it is the *default*
   interview — never the only one.
2. **Eligibility** — a Debate path may use Debate or General rooms, a Personal
   path Personal or General rooms. Never the wrong type.
3. **Conflicts** — a room with a **panel member** on the candidate's restricted
   list is removed *before* anything is counted, so a blocked room can neither be
   chosen **nor skew its track's load** — the test that pins this is a blocked
   empty room next to a usable occupied one.
4. **Global load** — the placement with the fewest occupants wins, across *both*
   tracks; the debate decides only exact ties. Each of the four conditions is
   asserted on its own:
   - Condition A — an empty room on either track is taken before anything
     occupied, and an empty room on each track resolves to the debate;
   - Condition B — the shorter queue wins even when it is not the debate;
   - Condition C — equal tracks resolve to the debate;
   - the **reported bottleneck** itself: 40-deep on debate beside idle personal
     rooms must route to Personal, where the old rule sent them to Debate.
5. **Fallbacks** — a track with no rooms at all, or with every room blocked for
   this candidate, hands over to the other track rather than failing.
6. **The wildcard** — a `General` room is counted **once**, as one placement
   serving either interview, and a dedicated room is kept in reserve over an
   equally idle General one.

The awkward ones are covered too: a shuffled input array must still pick the same
room, a missing load counts as empty, `pools` reports each track's emptiest room
(and a null pool for a track with no usable room) so the decision can be logged,
and the candidate being moved is excluded from the count (so pressing the wand
twice is a genuine no-op).

### The line — `isWaiting`, `waitingInLine`, `queuePositions`

Once somebody has arrived, the planned time they were given has no say: the line
is by arrival.

- **The pinning test**: one candidate planned `08:00` who walked in at 10:00, and
  one planned `11:00` who walked in at 09:00. The early arrival goes first — the
  early *planner* waits.
- `isWaiting` is exactly "arrived, still owes an interview, **not standing in a
  room**" — so "call next" can never pull somebody out of an interview — and it is
  false for a candidate who has not arrived, one who is done, and a `null` row.
- **An unstamped arrival sorts last, never first**, and two unstamped rows keep
  their incoming order rather than producing a `NaN` comparison and a random pick.
- Two identical arrival stamps keep the incoming order; positions number from 1;
  a seated candidate has no position at all.

### `conflicts.test.js` — Rule 7's matching

- Case and surrounding whitespace are ignored on **both** sides: a panel member
  named `  DANIEL ` conflicts with a candidate who restricted `daniel`.
- The spec's own example: `["John Doe", "Jane Smith"]` blocks a room whose panel
  contains `Jane Smith`, in any casing.
- **A panel is checked in full**: one restricted member disqualifies the room
  wherever they sit in the array, and `conflictingInterviewers` reports exactly
  who the problem is — never the rest of the panel.
- A room with an **empty panel can never conflict** — nobody recorded means
  "nobody in particular", not "everybody".
- `Dana` does not block `daniel`; `danny` does not either.
- `roomInterviewers` reads a panel safely: it drops blanks, collapses
  case-insensitive duplicates (first spelling wins), accepts a bare string as a
  name, and returns an empty panel — rather than throwing — for a half-migrated
  row.
- The modal's parser splits on commas and newlines, trims, drops blanks and
  collapses case-insensitive duplicates while keeping the first spelling — and
  survives a parse → render → parse round trip with no drift. `cleanInterviewerRows`
  applies the same tidying to the panel editor's rows, with an empty phone stored
  as `null` to match the database.

### `csv.test.js` — the Hebrew import

- `מס"ד`, `מס״ד`, `מס ד` and `מסד` all resolve to the serial column, with the
  typographic quote variants the spec calls out.
- A 9-digit phone number gets its leading `0` restored; an already-correct number
  is left alone.
- Rows without a name are counted as skipped, not imported as blanks.
- A blank column can never shadow a populated one, and a BOM on the first header
  does not break the mapping.

### `rooms.test.js` — who is in a room, and who is first

This ordering decides **whose evaluation is open on screen**, so it is worth
pinning down precisely:

- The **in-room clock wins** where it exists; a row that predates the column falls
  back to its arrival stamp, and whichever stamp is earlier is the longer wait.
- **An unknown clock sorts last, never first** — a row with neither stamp must
  never jump ahead of a known wait.
- **The answer does not depend on the order the rows arrive in**: the same board
  fed forwards and backwards produces the same queue, and a genuine tie is broken
  by name so "the first one" is stable.
- A missing room id, a missing board and a room with nobody in it all yield an
  empty queue rather than throwing; `longestWaitingOccupant` answers `null`, not
  `undefined`, so the page can test it directly.

### `evaluation.test.js` — the rubric's own wording

The Hebrew in `evaluation.js` is the club's questionnaire, not UI copy: if a word
changes there, nobody notices until an interviewer reads a subtly different
question mid-interview. So these assertions are the **literal strings, in order**,
rather than regexes:

- All **22 questions**, in the order they are asked, exactly as written.
- The interviewer's notes on the questions that carry one — the subtexts under
  *years remaining*, *Monday conflicts*, *free time*, the follow-up prompts, the
  optional-loss caveat, the English-level reassurance and the closing free text.
- The part-2 and part-4 headers, verbatim, with parts 1 and 3 asserted to have no
  intro of their own.
- The 1 and 5 anchor labels for all three ratings.
- **Which twelve questions are mandatory** — asserted as an exact list, so moving
  a field between mandatory and optional is a deliberate edit that shows up in
  review, plus the three that are deliberately optional (`gender`, `age`, and the
  competitiveness rating the club marked as not required).
- **The types**: text, number, textarea and 1–5 scale for each question, matching
  what was specified field by field.
- Prefill: the name and serial come from the board; *"מי מראיין?"* is filled
  **only** when the room names exactly one interviewer, and never invented
  otherwise.
- Validation: a complete form passes; missing mandatory fields are reported in the
  form's own order with the label attached; whitespace counts as blank; a rating
  outside 1–5 or a non-numeric age is refused, while `1.5` years is a real answer
  and a blank optional field is not an error.
- The saved `scores` object: numbers as numbers, text trimmed, **every key
  present** with `null` for blanks, and a round trip back into the form for
  editing that does not turn `null` into the string `"null"`.
- The recap rows: every question with its answer, a skipped one flagged as blank,
  and a rating of **1** treated as an answer rather than as absent.

---

## 2. Components — `tests/unit/*.test.jsx`

### `adminLists.test.jsx` — the three lists

`useCandidates` is replaced with a fixture and **the system clock is faked**, so
the late-alert boundary is a real assertion rather than a race against the
machine's own clock.

- **List A (Not Arrived)** sorts by planned time whatever order rows arrive in;
  an unplanned candidate sorts **last**, not first; two candidates with an
  identical planned time both survive in a stable order.
- **Ties are decided by stability alone**, so the tests feed the tie *both ways
  round*: a fixture that happens to come out in order proves nothing, while
  reversing the input must reverse the output. Asserted for a planned-time tie, a
  tie between two **late** candidates (same branch, so the same rule applies), two
  identical **arrival times**, and two **identical names** — the last one because
  a "sort unique by name" would silently lose a candidate.
- **A candidate with no planned time is never flagged late**, however late the
  board runs — an unplanned row is not an overdue one.
- **The 14:59 → 15:00 → 15:01 sequence.** The board is rendered at 14:59 for a
  candidate planned at 14:44. Advancing the clock 30 seconds at a time — the same
  interval the dashboard uses — the card must stay unflagged at 15:00 and gain
  `LATE`, plus the red tint, at 15:01. No reload, no refetch.
- **List B (Arrived)** sorts by arrival time, oldest first, and a candidate drops
  out the moment both interviews are complete.
- **List C (Finished)** is alphabetical — asserted for English *and* Hebrew
  (`אבי`, `בני`, `גדי`).
- Every candidate lands in exactly one list, the header counts match, an empty
  board explains itself instead of showing nothing, and the search box filters by
  name, serial number and phone number.
- **"Late pinned to top" is asserted as an invariant** — every `LATE` card sits
  above every card that is not — across a mixed board. Worth knowing: the pin is
  *implied* by the threshold (a late candidate's planned time is necessarily
  earlier than an on-time one's), so the sort's late branch is belt-and-braces.
  The invariant is asserted anyway, because it is what the column header promises
  and what a future change to the threshold could quietly break.

### `dashboardSync.test.jsx` — an edit actually reaches the screen

The list specs render a fixed fixture. This one wires `useCandidates` to a **live
store** (`useSyncExternalStore`), so an action travels the real path —

```
modal → saveCandidate → (server echo) → patchLocal → re-render
```

— and the assertions are about what an admin sees afterwards. This is the only
honest way to check "the lists re-sort and the late alert recalculates without a
refresh", because it drives the component's own render path instead of a
hand-built array.

- **Editing a planned time through the real modal** re-sorts List A immediately:
  pushing a plan into the future moves the card down the list; pulling it back
  past the threshold re-flags it `LATE` with the red tint. `reload()` is asserted
  **never** to have been called — the change comes back through the board, not
  through a refetch.
- The **15-minute boundary reached through an edit**: at 12:20 a plan of 12:05 is
  exactly 15 minutes late and must clear the flag; one clock tick later the *same
  row* is 16 minutes late and must flag again, with no further edit.
- **Editing the plan leaves the other two lists untouched.**
- Ticking **Arrived** moves a candidate out of List A and into List B; ticking the
  last outstanding interview moves them into List C **and frees the room at once**
  — the queue reads `Empty queue` in the same pass, before the server answers,
  and the row's `assigned_room`, `current_task_assignment` and `room_entry_time`
  are all `null`. Un-ticking *Arrived* on a candidate holding state puts them back
  to a clean blank.

### `roomsPanel.test.jsx` — the clock and the live queue

`time.test.js` proves the arithmetic; this proves it is *rendered*. The system
clock is faked so the boundary is an assertion, not a race.

- The `⏱️` counter shows whole minutes since the stored entry time, and is
  **not red at 19 minutes but is red at exactly 20**, with the `⚠️` and a
  "running long" tooltip — then keeps counting (`21m`, still red) instead of
  sticking at 20.
- **No clock means no counter** rather than `0m`; a server clock ahead of the
  browser clamps to `0m` and never shows a negative.
- The room's **active queue lists exactly the occupants** the board says are in
  it, with the task abbreviated, and nobody from another room — **longest-waiting
  first**, and identically whichever order the rows are delivered in.
- **The queue empties the instant the room is released**: re-rendering with the
  row an interview-completion produces (no room, no task, no clock) turns
  `1 active` into `Empty queue` and removes the counter. A room with nobody in it
  says `Empty queue` rather than showing a blank box.
- The card renders the **whole panel inline** — every member listed, one
  tap-to-call link per number that exists and no link for a member without one —
  or the `+ Add interviewer` affordance when the panel is empty.
- Retyping a room through the select reports `{ room_type }` upward; an empty
  board explains itself. Each card also carries its own **link into the room view**
  (`Open interview room A206`), named for the room so a screen-reader user can
  tell two of them apart.

### `autoAssignUi.test.jsx` — the wand, through the real button

`autoAssign.test.js` proves the decision. This proves the wiring around it in
`Admin.jsx`, which had no coverage at all: that the button reads the **live**
queue from the database, that the two dead ends produce **different** messages,
and that a pick lands on the board.

- **Load balancing end to end**: with loads `A206: 1 · A207: 0 · A320: 2`, the
  candidate lands on **A207**, the card's room select updates, and the toast reads
  `Candidate assigned to A207 for Debate Interview.`
- **Global throughput, not blind debate priority** — the regression for the
  reported bottleneck, on a board with both kinds of room: a both-interviews
  candidate on a board with a busy debate track and an **empty personal room** is
  sent to Personal (and told so), where the old rule would have queued them for
  Debate; a board whose two tracks are **equally busy** still resolves to the
  debate; a candidate **forced** onto one track is not lured onto an idle other
  one; and **Call next** routes down the idle track the same way.
- A **three-way tie** resolves to the alphabetically first room, so the same board
  always produces the same answer.
- The candidate **being moved is not counted** in their own room's load — the
  subtle one: without the exclusion the answer changes.
- A restricted **panel member** is enough to disqualify a `General` room.
- **The two failures are distinguished** and now have to be judged across *both*
  tracks: a candidate forced onto a track with no rooms gets `No Personal or
  General room is available for a Personal Interview.`, an empty board gets
  `No room is available for a Debate or Personal interview.`, and a board where
  every applicable room is blocked gets
  `Auto-Assign Failed: All applicable rooms have a restricted interviewer…`.
  All three are asserted to leave the candidate unassigned rather than half-moved.

### The Call next button — arrival order is the dispatch order

The same file drives the **Call next** control, which is where "first to arrive
goes first" becomes real:

- It sends the **earliest arrival**, not the first row on the board — and it
  **ignores the planned time entirely**: a candidate planned `08:00` who arrived
  at 10:00 waits behind one planned `11:00` who arrived at 08:00.
- The cards carry **`1st in line` / `2nd in line` / `3rd in line`** by arrival,
  whatever order the rows come in, and the button names the head of the line and
  counts the rest (`+2 waiting`).
- Somebody already **in a room is not counted as waiting**, and is given no place
  in line; with nobody waiting the button is disabled and offers no name.
- **Strict FIFO is enforced**: when the head of the line is restricted from every
  room of the type they need, the button names *them* and stops — the person
  behind them, who could have been placed, is deliberately left alone. A blocked
  candidate further back does not hold up the head of the line.

### `candidateCard.test.jsx` — one row of the board

- The **arrival lock**: interviews and the room picker are disabled until
  *Arrived* is ticked, with the 🔒 hint explaining why.
- Un-ticking *Arrived* on a candidate who holds state asks for confirmation first
  (and does nothing if the answer is no); on an empty candidate it does not nag.
- The **wand** is absent before arrival, names the interview it will find a room
  for, and disappears once both interviews are done.
- A **blocked room** renders as `A207 · Debate (Blocked: Conflict)` and is
  `disabled`; unrestricted candidates see no blocked options at all, and a
  candidate's restrictions are shown on the card in the admin's own casing.
- **A partial panel conflict blocks the room too**, and the sitting-in-conflict
  warning names only the panel member who is actually restricted — never the rest
  of the panel.
- The **task follows the room**: picking a Debate room sends
  `current_task_assignment: 'Debate Interview'` along with the room; the task
  dropdown only appears for a `General` room, which implies nothing; choosing it
  leaves an existing choice untouched; clearing the room clears both.
- The room chip reads `A206 · Debate`, and a late candidate gets `LATE` and the
  red border.

### `interviewerModal.test.jsx` — the room's panel

- Opening a room **lists every interviewer** with no click needed, one entry each,
  with tap-to-call on the numbers that exist and a plain "no phone" where none
  does; the header states how many are in the panel.
- An empty panel says so and offers to add somebody, rather than showing a blank
  box; with no room open the modal renders nothing at all.
- It opens **read-only** — a stray click cannot change a phone number — and
  *Edit* then adds a row, removes a row and edits a name in place.
- Saving sends the **cleaned** panel: names trimmed, blank rows dropped,
  case-insensitive duplicates collapsed, an empty phone sent as `null`.
- A failed save keeps the form open with an explanation; *Cancel* discards the
  edits, *Escape* closes the modal, and a save in flight disables the button.

### `candidateView.test.jsx` — the public page

The public page is the only surface a stranger can open, so two things are
asserted separately: what it **asks the API for**, and what it **renders**.

- The candidate query is asserted **character for character** against the seven
  fields the page needs — and must not contain `serial_number`, `phone_number`,
  `room_entry_time`, `interviewer_constraints` or the word `interviewer`.
- The rooms query is exactly `id, room_name, room_type`.
- The mock deliberately answers with a **fatter row than requested** (serial,
  phone, `room_entry_time`, constraints). None of it may reach the DOM — so the
  page stays safe even if somebody widens the query later.
- The queue / proceed / all-done / not-found states, the Pending–Done badges, and
  the absence of a logo, debug panel and admin links.

### `roomEvaluation.test.jsx` — the in-room rubric, from blank form to filed row

`evaluation.test.js` proves the questionnaire. This drives the **real page**:
`useCandidates` is a live store and the "database" answers the three queries the
page makes (the room's filed evaluations on mount, the evaluation upsert, and the
`personal_interview_completed` update that releases the room).

- **The form is keyed to the task.** A candidate in a Personal Interview gets the
  rubric; a Debate Interview gets a plain explanation instead of a form, and an
  empty room says nobody is there. A deleted room explains itself rather than
  rendering a broken page.
- The form renders **`dir="rtl"`** on itself (Hebrew content inside English
  chrome), all four parts with their headers, and both closing buttons by their
  exact labels.
- **Prefill from the board**: name and serial number arrive filled in; the
  interviewer is filled only when the room names exactly one.
- **The rubric is about the longest-waiting occupant**: with two people in the
  room, the earlier one's name is in the form and the later one is listed as next
  in the room.
- **A half-filled form cannot be filed**: nothing is written, no release is
  issued, the missing fields are marked `שדה חובה`, and the mark clears when the
  field is answered.
- **Filing it saves the answers and releases the room**: the upsert carries the
  candidate, room, task, interviewer and submitting admin; numbers are stored as
  numbers and blanks as `null`; the release is exactly
  `personal_interview_completed: true`, which is what lets Rule 3 clear the room.
- **The confirmation survives the release.** The bug this caught: filing a rubric
  empties the room, and the reset that follows was wiping the recap at the moment
  the interviewer most needs it. The recap is deliberately kept when the room
  empties, and dropped when a *different* candidate turns up.
- **Skip releases without filing anything** — and only asks for confirmation when
  the interviewer has typed something beyond the prefilled name and serial, so an
  untouched form does not nag.
- Already-filed rubrics for the room are listed collapsed, filtered to that room,
  and expandable in place with skipped answers marked `לא הוזן`.

---

## 3. Database — `tests/db/*.test.mjs`

Rules 1–7 live in Postgres triggers, and the privacy guarantee lives in an RLS
policy plus column privileges. Neither can be faked, so these tests talk to the
**real** project in `.env` over the REST API — the same way a misbehaving client
would.

Every row they create is named `ZZQA-…` and deleted in a `finally` block, and
both scripts assert that no `ZZQA-` rows survive. A crashed run leaves the board
exactly as it found it.

### `rules.test.mjs` — 50 assertions

| Rule | What is asserted |
| --- | --- |
| **1 — arrival is a precondition** | Un-ticking *Arrived* clears the room, the task, the clock, the arrival stamp **and both interview results** — a clean reset, not a half one. |
| **2 — arrival stamping** | Ticking *Arrived* stamps the server clock; so does inserting an already-arrived row. |
| **3 — auto-release** | Completing either interview clears the room, the task and the clock. |
| **4 — no orphan state** | A task without a room is normalised away; deleting a room clears the paired task and clears the occupant. |
| **5 — the in-room clock** | Assigning starts it; a forged `room_entry_time: '2020-01-01'` is **ignored**; re-assigning the *same* room does **not** restart it (asserted with a real 1.1 s gap); moving to a different room does restart it; leaving clears it. |
| **6 — the task follows the room** | A client claiming `Personal Interview` while being put in a Debate room is overruled — on the **update path and the insert path**. A `General` room keeps the admin's choice. Retyping a room re-derives the task for whoever is standing in it. |
| **7 — interviewer conflicts** | A conflicting assignment is refused with HTTP 400 and the message `Conflict of interest: …`, the row is left untouched, matching is case-insensitive (the constraint list is stored uppercase, the panel's name lowercase), the **insert** path is refused as well, a room with an empty panel is always allowed, a panel of strangers is allowed, a lookalike (`Danny` vs `daniel`) is not a conflict, a **partial panel conflict** is still refused and the error names the offending member, a `General` room is filtered too, the panel is tidied on the way in (blanks and duplicates do not survive, the first spelling keeps its phone), and **releasing a room is never blocked** — even when the conflict appeared around a candidate already seated. |

### `privacy.test.mjs` — 36 assertions

This is the "Strict Privacy Verification" requirement, answered as "what could a
candidate actually do with the publishable key?", not "what does our page ask
for?".

- Anonymous visitors **can** read `id, room_name, room_type`.
- Anonymous visitors **cannot** read `interviewers` — alone, or smuggled in
  beside a public column, or via `select=*`. All of them return
  `401 permission denied for table rooms`. The retired singular columns
  (`interviewer_name`, `interviewer_phone`) no longer exist at all.
- Even the allowed read is checked for the panel: none of the room rows an
  anonymous visitor receives carries an `interviewers` key.
- The public page's exact candidate query, run as an anonymous visitor, returns
  **exactly seven fields** and no serial number, phone number, `room_entry_time`
  or constraint list.
- Anonymous visitors cannot write anything: create/update/delete on rooms and
  candidates all leave the row unchanged. (RLS filters an unpermitted write
  *silently* — `204` with zero rows changed — so these assertions check the row,
  not the status code, which is the mistake that lets a real hole through.)
- Anonymous visitors cannot read the `allowed_admins` list.
- **Evaluations are unreachable, in every direction.** The rubric names the
  candidate, their serial number and what the club thought of them, and the anon
  key ships in the bundle every candidate downloads — so the checks are done on the
  wire: `select=*`, `select=scores`, a smuggled
  `select=candidate_id,scores` and a filtered single-row read all come back
  `401`/`403`; an insert is refused; and against a real evaluation created with the
  privileged key, an anonymous `PATCH` leaves both the interviewer name and the
  score untouched and an anonymous `DELETE` leaves the row in place. That last
  pair asserts the *row*, not the status code, because RLS filters an unpermitted
  write silently.
- **Signed-in admins are unaffected**: they can still read and edit the panel,
  `select=*` still works for them, and the same session can read the rubrics the
  room view fetches on mount.

---

## 4. End-to-end — `tests/e2e/*.spec.js`

Playwright drives the real app in Chromium against the real board. The default
run is **read-only**: nothing is created, edited or deleted, so it can be run
against production at any time, including mid-event.

```bash
npm run test:e2e
$env:CQ_E2E_MUTATIONS="1"; npx playwright test tests/e2e/conflict-ui.spec.js tests/e2e/room-rubric.spec.js   # opt-in writing scenarios
```

### `public-privacy.spec.js`

The page is loaded in a browser while every `/rest/v1/` request and response is
recorded.

- No request URL mentions `interviewer`, and every `rooms` request asks for
  `select=id,room_name,room_type` — verified from the actual network traffic, not
  from reading the source.
- No response body contains `interviewers`, `interviewer_name`,
  `interviewer_phone` or `room_entry_time`, and a real candidate's phone number
  appears nowhere.
- Replaying the request by hand with the publishable key returns `401` — for
  `select=interviewers`, for `select=room_name,interviewers`, and for `select=*` —
  while the three legitimate columns still return `200`.
- Across several real candidates: no `<img>`, no debug panel, and no `#serial`.

### `admin-dashboard.spec.js`

Signs in and inspects the live board. Where the expected value depends on the
data, **the expectation is computed from the page itself** rather than hardcoded,
so the suite keeps working as the event goes on:

- The three columns and their subtitles render.
- **The Call next button offers the earliest arrival**: the waiting set is
  recomputed from the DOM (empty room picker + a wand), and the name on the
  button must match the earliest `arrived HH:MM` among them; with nobody waiting
  it must be disabled.
- List A's planned times are non-decreasing.
- **The late flag matches the rule on every single card** — each visible card's
  `LATE` chip is compared against `now > planned + 15`, computed in the browser.
  This is the real board, the real clock and the real data.
- List C is alphabetically sorted (Hebrew collation).
- **Every in-room timer is checked against the database**: the seated candidates
  and their real `room_entry_time` are fetched over REST, and each rendered `⏱️`
  is asserted to be red (with `⚠️`) exactly when it is ≥ 20 minutes and not
  otherwise, and to agree with the stored entry time to within the minute the
  page may be behind by. A stale or mis-parsed timer cannot pass this.
- No candidate appears in two lists at once, and the lock hint appears on exactly
  the cards that have not arrived.
- The search box narrows the lists and clearing it restores them.
- The rooms panel renders with the inline interviewer affordance — no click
  required to see who is interviewing.
- Opening a room's panel shows the size of it in the header and **lists every
  interviewer** in the room, and the empty state explains itself rather than
  showing a blank box; *Edit* then grows the panel in place (without saving).

The finished-list and ordering assertions skip themselves when the board does not
have the data to judge (e.g. nothing has finished yet) rather than failing.

### `conflict-ui.spec.js`

- **Always runs:** the *Add Candidate* modal has an **Interviewer conflicts**
  field with the explanatory copy, it keeps free text as typed, and it closes
  without saving. Editing an existing candidate round-trips their restrictions.
- **Opt-in (`CQ_E2E_MUTATIONS=1`):** the full round trip — create a candidate
  restricted from `daniel`, tick *Arrived*, confirm the A320 option is
  `disabled` and labelled `(Blocked: Conflict)`, confirm a free room is still
  available, press the wand, confirm the toast names a **different** room and the
  candidate was not sent to A320, then delete the row. It cleans up before and
  after, so a failure cannot leave data behind.

### `room-rubric.spec.js`

Two things are worth proving against live data, and nothing more.

- **The gate, always:** `/room/:id` shows one candidate's name and the scores the
  club gave them, so an anonymous visitor must land on the sign-in wall — not the
  rubric, not a half-rendered form — and the sign-in link must remember which room
  was asked for so an interviewer ends up back there. The five rubric columns are
  probed directly with the publishable key and must be refused.
- **The wiring, signed in:** the room opens from the rooms panel and names the
  room; an occupied-Personal-Interview room shows the Hebrew form (asserted to be
  `dir="rtl"` when such a pair exists, and skipped when the board has none); a room
  nobody is in never offers the form.
- **Opt-in (`CQ_E2E_MUTATIONS=1`), the whole thing for real:** a scratch room and a
  candidate seated in a Personal Interview, the rubric filled through the real
  form (including the 1–5 chips), then the database checked — one evaluation row
  with the right task, room, interviewer and submitting admin, numbers stored as
  numbers and the untouched rating as `null`, and the candidate released with room,
  task and clock all cleared. It then reloads the room to confirm the form is gone
  and the filed rubric is still readable read-only. Everything it creates lives in
  a scratch room of its own and is swept before and after.

---

## Coverage

Measured with `npm run test:coverage` (v8, jsdom):

| File | Statements | Branches |
| --- | --- | --- |
| `src/lib/time.js` | 100% | 100% |
| `src/lib/conflicts.js` | 100% | 98% |
| `src/lib/autoAssign.js` | 100% | 95% |
| `src/lib/rooms.js` | 100% | 89% |
| `src/lib/evaluation.js` | 100% | 90% |
| `src/lib/csv.js` | 98% | 74% |
| `src/components/EvaluationForm.jsx` | 100% | 87% |
| `src/components/InterviewerModal.jsx` | 100% | 96% |
| `src/components/CandidateCard.jsx` | 100% | 96% |
| `src/components/RoomsPanel.jsx` | 93% | 87% |
| `src/pages/CandidateView.jsx` | 98% | 91% |
| `src/pages/RoomView.jsx` | 93% | 79% |
| `src/pages/Admin.jsx` | 74% | 81% |

The business logic — the part that can be silently wrong — is effectively fully
covered. `Admin.jsx` is lower because it is largely a controller: its CSV-import,
QR and toast handlers are not unit-tested, deliberately. The parts that carry a
rule — the three lists, the optimistic patches and the Auto-Assign click — *are*
covered (`dashboardSync.test.jsx`, `autoAssignUi.test.jsx`), and everything else
is covered from the other direction by the Rule 1–7 suite (which drives the same
API calls) and by the end-to-end specs. `RoomView.jsx` sits at 93% for the same
reason: its uncovered branches are the loading/error paths and the Debate-placeholder
card, which the end-to-end spec exercises instead.

---

## Traceability — requested scenario → the test that answers it

Every behaviour that was asked for in the QA review, and exactly where it is
pinned down.

| # | Scenario | Where it is proven |
| --- | --- | --- |
| 1 | List A orders by *Planned_Time* | `adminLists.test.jsx` (mixed input order); `admin-dashboard.spec.js` (non-decreasing times on the live board) |
| 1 | List B orders by *Arrival_Time*; List C alphabetically | `adminLists.test.jsx` (English + Hebrew); `admin-dashboard.spec.js` (live Hebrew collation) |
| 1 | Two candidates with the **same** planned time | `adminLists.test.jsx` — the tie is fed **both ways round**, plus ties between two late candidates, identical arrival times and identical names |
| 1 | 14:59 vs 15:01 visual alert | `time.test.js` (pure boundary); `adminLists.test.jsx` (renders at 14:59, ticks to 15:00 and 15:01); `admin-dashboard.spec.js` (every live card vs the rule) |
| 1 | The alert applies **without a refresh** | `adminLists.test.jsx` advances the clock mid-render; **every** `dashboardSync.test.jsx` case asserts `reload()` was never called |
| 1 | Editing *Planned_Time* re-sorts and recalculates | `dashboardSync.test.jsx` — through the real modal, into a live store, asserting list order and the `LATE` chip in both directions |
| 2 | Timer accuracy from `Room_Entry_Time` | `time.test.js` (`minutesInRoom`); `roomsPanel.test.jsx` (rendered); `admin-dashboard.spec.js` (against the stored value over REST) |
| 2 | Red text at **exactly** 20 minutes | `time.test.js` (19/20/21); `roomsPanel.test.jsx` (19 calm → tick → 20 red + ⚠️ → 21 still red); `admin-dashboard.spec.js` (live) |
| 2 | Completing an interview clears the clock and the queue | `rules.test.mjs` Rule 3 (the database); `dashboardSync.test.jsx` (`Empty queue` in the same pass); `roomsPanel.test.jsx` (re-render with the released row) |
| 3 | Debate before Personal | `autoAssign.test.js` (`neededTasks` lists the debate first); `autoAssignUi.test.jsx` (a forced candidate routes to the Personal rooms once the debate is done) |
| 3 | **Arrival order is the dispatch order, planned time has no say** | `autoAssign.test.js` (`waitingInLine`, the early-planner-waiting case); `autoAssignUi.test.jsx` (Call next picks the earliest arrival); `admin-dashboard.spec.js` (live: the button names the earliest arrival) |
| 3 | Call next is strict FIFO and explains when it stalls | `autoAssignUi.test.jsx` — a blocked head of line is named and the next person is *not* promoted |
| 3 | Load balancing (A=1, B=0, C=2 → B) | `autoAssign.test.js` (`pickPlacement`); `autoAssignUi.test.jsx` (the real button, the toast names A207) |
| 3 | **Global throughput — no idle room while a candidate could use it** | `autoAssign.test.js` (Conditions A/B/C each asserted alone, the 40-deep debate queue beside idle personal rooms, a track that is empty or fully blocked handing over to the other, the `General` wildcard counted once); `autoAssignUi.test.jsx` (busy debate + empty personal → Personal, through both the wand and Call next; a forced candidate not lured onto an idle other track) |
| 3 | The debate preference survives as a **tie-break only** | `autoAssign.test.js` (equal tracks resolve to the debate; a dedicated room is kept over an equally idle `General` one) |
| 3 | The all-equal tie-break | `autoAssign.test.js` and `autoAssignUi.test.jsx` — alphabetically first room, deterministic |
| 3 | No room of the required type | `autoAssignUi.test.jsx` — the graceful `No … room is available` toast (naming one track, or both when neither has a room), candidate left unassigned |
| 4 | COI array matching (`["John Doe","Jane Smith"]` vs a panel of `Jane Smith`) | `conflicts.test.js` (the spec's own example); `rules.test.mjs` Rule 7 (refused, error names the member); `candidateCard.test.jsx` (dropdown locked out) |
| 4 | One restricted panel member is enough | `conflicts.test.js` (partial panel); `rules.test.mjs` (partial panel refused); `candidateCard.test.jsx`; `autoAssignUi.test.jsx` (a blocked `General` room is bypassed) |
| 4 | Auto-Assign bypasses a blocked room | `autoAssign.test.js` (filtered before counting); `autoAssignUi.test.jsx` (picks the unblocked room, and the distinct "all restricted" toast) |
| 4 | The panel never reaches a candidate's browser | `privacy.test.mjs` (anon gets `401` for the column, for a smuggled select and for `select=*`); `public-privacy.spec.js` (no request mentions it, no response body contains it, the replay fails); `candidateView.test.jsx` (a deliberately fat mock row never reaches the DOM) |
| 5 | The rubric opens for `Current_Task_Assignment = 'Personal Interview'` | `roomEvaluation.test.jsx` (a Personal Interview shows the form, a Debate Interview does not, an empty room says so); `room-rubric.spec.js` (live, opt-in, and the read-only state checks); `evaluation.test.js` (`PERSONAL_INTERVIEW`) |
| 5 | The exact Hebrew wording, instructions and 1–5 anchors | `evaluation.test.js` — every label, note and anchor asserted as a literal string, in order |
| 5 | Required fields enforced; name and serial pre-filled | `evaluation.test.js` (the mandatory list, validation, prefill rules); `roomEvaluation.test.jsx` (a half-filled form writes nothing); `room-rubric.spec.js` (live prefills) |
| 5 | RTL, scrollable, with the two closing buttons pinned to the bottom | `roomEvaluation.test.jsx` (`dir="rtl"`, both buttons by label, all four parts); `EvaluationForm.jsx`'s `sticky bottom-0` bar; `room-rubric.spec.js` (live `dir="rtl"`) |
| 5 | Submitting stores the scores **and** releases the room | `roomEvaluation.test.jsx` (the upsert and the `personal_interview_completed` write); `rules.test.mjs` Rule 3 (the release itself); `room-rubric.spec.js` (live: the row, the types, and the cleared room/task/clock) |
| 5 | Skipping releases without storing anything | `roomEvaluation.test.jsx` (no upsert, the release still issued, confirmation only when there is typing to lose) |
| 5 | The evaluation stays **discreet** — admin-facing only | `privacy.test.mjs` (anon cannot read, filter, insert, edit or delete); `public-privacy.spec.js` (the public page never touches it); `room-rubric.spec.js` (an anonymous visit to `/room/:id` lands on the sign-in wall) |

---

## Manual exploratory testing

Automation checks what was thought of in advance. A human session checks whether
the thing is actually *usable* on the day. Run this before each event, on the
deployed URL, with real data on the board.

**Charter:** *act as the dispatcher on a busy day, with candidates arriving in
bursts, and try to lose control of the board.*

Test with a phone in one hand: the dispatcher is usually standing up.

### A. Check-in (the fastest path in the app)

1. Scan a QR code with a real phone. The page must load in under two seconds and
   show *"Please wait, you are in the queue."*
2. Tick a candidate's *Arrived* on the dashboard. The phone must say
   *"Please proceed to …"* within a couple of seconds — **watch the phone, not
   the laptop**.
3. Assign a room, then immediately unassign it. The phone must go back to the
   queue message. Do it twice quickly — a stale message here is the most
   embarrassing possible failure.
4. Try to tick an interview checkbox or use the room dropdown **before** ticking
   *Arrived*. Both must refuse.
5. Tick *Arrived*, then un-tick it on a candidate who already has a room. Confirm
   the warning appears, cancel, and check nothing changed. Then accept it and
   check the candidate is a clean blank — no room, no task, no interview ticks.

### B. The three lists

6. Compare List A's order against the plan printed on paper. Anyone more than 15
   minutes late must be red, on top and visibly *late*.
7. Edit a candidate's planned time in the modal and watch the list re-sort
   without a refresh.
8. Search a partial Hebrew name, then a serial number, then a phone fragment.
   Clear the box and confirm every list comes back.
9. On a narrow window (or a phone), check the three columns stack and the lists
   scroll rather than running off the page.

### C. Rooms and timers

10. Watch one room's `⏱️` counter for two minutes: it must tick up and never go
    backwards.
11. Leave an interview running past 20 minutes: the counter must turn red with
    the ⚠️, at 20, not at 21.
12. Open a room's panel and add a second interviewer, then remove one. The card
    must list exactly the panel you saved — a name with no phone, a phone with no
    name, and a blank row must each tidy away rather than being stored. Give two
    members the same name in different casing and confirm only one survives.
13. Re-assign a candidate to the room they are already in. The timer must keep
    running, not restart.
14. Move a candidate to a different room. The timer must restart from zero.
15. Rename a room and retype it. Anyone standing in a Debate room that becomes
    Personal must have their task follow.
16. Delete a room with somebody in it. Their card must clear cleanly.

### D. Auto-Assign and the line

17. **Watch that no room sits idle.** Fill every Debate room with three or four
    people, leave a Personal room empty, and arrive a fresh candidate who owes
    both interviews. Auto-Assign must send them to the **empty Personal room** and
    say `Personal Interview` — the debate is only a tie-break now. Repeat with an
    empty Debate room and full Personal ones: it must go the other way.
18. Make the two tracks **equally busy** (one person in a Debate room, one in a
    Personal room, an empty room of each kind). Now the tie-break applies: the
    candidate must go to the **Debate** room.
19. Take a candidate who has already done their debate and put them on a board
    whose Personal rooms are all busy while the Debate rooms are empty. They must
    still go to Personal — an idle track you are not eligible for must not lure the
    wand.
20. Press the wand on three arrived candidates in a row with the room list
    visible. Each must go to a *different* room, and the empty ones must go
    first.
21. Press it twice in a row on the same candidate. The second press must not move
    them or restart their timer.
22. Do this with another admin signed in on a second device, both pressing at
    once, and confirm the board converges.
23. Give a candidate who has **finished their debate** nowhere to go: temporarily
    retype every Personal and General room to Debate. The wand must refuse with
    *"No Personal or General room is available for a Personal Interview."* — the
    **empty-board** message, clearly different from the all-restricted one in E32.
    Put the types back. (Do the same with no rooms at all to see the message that
    names *both* tracks.)
24. **Check the line against the door, not the diary.** Walk in somebody whose
    planned time was two hours ago, before somebody else who was planned for
    later. The **Call next** button must name the person who *walked in* first,
    and their card must read `1st in line`. The planned time must have no say.
25. Place the head of the line into a room. The button must move on to the next
    arrival, and the seated candidate must lose their `Nth in line` badge —
    somebody mid-interview is not in the queue.
26. Press *Call next* when nobody has arrived. The button must be disabled and
    offer no name, and pressing it must do nothing at all.
27. Restrict the head of the line from every room they are eligible for, then
    press *Call next*. It must name **them** and refuse — it must **not** quietly
    send the person behind them, even though that person could be placed.
    Un-restrict them afterwards.
28. Inside a room card, the occupants must be listed longest-waiting first: send
    two people in a few minutes apart and confirm the earlier one stays on top.
29. Search for a name, then clear the box. The `Nth in line` numbers must not
    change while the board is filtered — a place in the queue is a fact about the
    queue, not about what is on screen.

### E. Conflict of interest

30. Add a candidate with a restricted interviewer matching a staffed room. The
    room dropdown must show that room greyed out with `(Blocked: Conflict)`, and
    the card must show `🚫 no …`.
31. Put two interviewers in one room, one of them restricted. The room must still
    be blocked — a partial conflict is a conflict — and the warning on the card
    must name only the interviewer who is actually the problem.
32. Make the only *empty* room of one track the blocked one. Auto-Assign must not
    treat that track as free: it must weigh the remaining usable rooms and send the
    candidate wherever there is genuinely space — never to the blocked room.
33. Restrict a candidate from *every* room they are eligible for (temporarily).
    The wand must refuse with the explicit *"All applicable rooms have a
    restricted interviewer"* message, **not** the empty-board one from D23.
34. Move a candidate off a room they should not be in, and confirm the warning
    disappears.
35. Try the same assignment through the REST API by hand, with the publishable
    key. It must be refused by the database.

### F. Failure and recovery

36. Kill the network (DevTools → offline) on the dashboard and click something.
    An error toast must appear and the board must not be left showing a change
    that did not happen. Restore the network and confirm it resyncs.
37. Reload the dashboard mid-session; the state must match the other admin's
    screen.
38. Open the Debug panel (Ctrl+Shift+D) after a burst of activity and check for
    `ERROR` entries — and open it after a couple of auto-assigns to read the
    `debateMin` / `personalMin` figures, which should explain the choice that was
    made.
39. On the public page, open the network tab and search for `interviewer` and the
    candidate's own phone number. Both must be absent — including the panel
    itself, not just the old singular fields.

### G. The in-room rubric (Personal Interviews)

40. Open a room card's **Open** link. The room view must name the room, show who
    is in it and for how long, and load the **Hebrew form** the moment the
    occupant's task is a Personal Interview. The whole page must still be behind
    the admin gate if you open the URL in a private window.
41. Check the form reads right-to-left and that the four parts are separated, the
    two closing buttons are visible without scrolling to the bottom, and the
    candidate's **name and serial number are already filled in**.
42. Put a second interviewer in that room's panel (E12) and reload the room: the
    *"מי מראיין?"* field must fill in only when the panel has exactly one member.
43. Press **Submit** with fields missing. Nothing must be written, the missing
    fields must be marked `שדה חובה`, and the first one must take focus.
44. Fill everything mandatory (skip the optional ones), press **Submit**, and
    confirm: the answers shown back are what you typed, the toast confirms, and the
    room empties. Reload the page — the form must be gone because nobody is in the
    room.
45. Check the *Filed in this room* list: your evaluation must be there, expandable,
    with the questions you skipped marked `לא הוזן`. A rating of **1** must show as
    `1`, not as blank.
46. Reload the dashboard and confirm the candidate is out of the room, has the
    Personal Interview ticked, and that the **room's `⏱️` counter is gone** — the
    release is a real release, not just a redrawn page.
47. Open the same room on a second device, file a rubric, and confirm the first
    device shows the room as empty within a few seconds and can read the filed
    rubric on reload.
48. Press **Skip Digital Feedback & Release Room** without typing anything: it must
    not nag, and must release the room. Then type one answer and press it again —
    now it must warn before discarding.
49. In the public `/candidate/:id` page's network tab, search for `evaluations`.
    There must be no such request and no scores in any response.

### H. The day after

50. Export/import a CSV in the original Hebrew format and confirm the serial,
    name, phone and time all land in the right columns.
51. Delete a test candidate and confirm the row disappears without disturbing the
    others.

---

## Deliberately out of scope

- **`supabase.js`, `logger.js`, `monitoring.js`** are not unit-tested. They are
  side-effectful plumbing whose correctness shows up as working features
  elsewhere; the Debug panel and error toasts are checked by hand.
- **Concurrent writers.** Two admins assigning the same candidate at the same
  instant is last-write-wins by design. It is exercised by hand (checklist D22),
  not automated, because the outcome is intentionally non-deterministic.
- **The `allowed_admins` bootstrap**, which requires the service role and is
  covered by `npm run db:push`'s own verification step.
- **Load and performance.** 49 candidates and 7 rooms render instantly; the
  design target is a few hundred, and no profiling has been done.
- **The `evaluations` table is not on the realtime publication.** The room view
  fetches the room's filed rubrics on mount, after a submit and after a skip, so a
  rubric filed by somebody else appears on reload rather than instantly. Deliberate
  for now: one more always-on subscription per room buys little over a reload.
- **Reporting over `scores`.** The rows are stored per question and the shape is
  fixed, but there is no aggregate/export surface (rankings, averages, CSV) yet —
  only the per-room read-only recap. Ask and it can be added as a view.
- **Cross-browser.** Playwright runs Chromium only. The app is plain React and
  Tailwind with no engine-specific CSS, but Firefox/Safari have not been checked.
