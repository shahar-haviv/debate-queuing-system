/**
 * Auto-assign — sending an arrived candidate to the room that suits them best.
 *
 * Small pure functions rather than one click handler, so the rules can be
 * reasoned about (and tested) without a database or a browser in the room.
 *
 * The headline rule is **global throughput**: no room should sit idle while
 * somebody on the board could be sitting in it. A candidate who still owes both
 * interviews can be routed down *either* track, and the choice is made by
 * comparing how busy the tracks actually are — a slight preference for the
 * debate only breaks ties when the two tracks are equally idle. (The older rule
 * always sent a both-interviews candidate to Debate, which is how a debate queue
 * of forty could build up next to empty personal rooms.)
 */

import { hasInterviewerConflict } from './conflicts.js'

export const DEBATE_INTERVIEW = 'Debate Interview'
export const PERSONAL_INTERVIEW = 'Personal Interview'

/** The room type that hosts each interview. */
const TYPE_FOR_TASK = {
  [DEBATE_INTERVIEW]: 'Debate',
  [PERSONAL_INTERVIEW]: 'Personal',
}

/** The room type that hosts an interview, e.g. for error messages. */
export function roomTypeForTask(task) {
  return TYPE_FOR_TASK[task] ?? null
}

/**
 * Which track to prefer when both are equally idle.
 *
 * This is the *only* place the debate gets a thumb on the scale, and it never
 * costs an idle room: it is consulted after the load comparison, never before.
 */
const TASK_RANK = {
  [DEBATE_INTERVIEW]: 0,
  [PERSONAL_INTERVIEW]: 1,
}

/**
 * Step A — the interviews this candidate still owes, debate first. One entry for
 * a forced candidate (only one left), two for one who owes both, none once they
 * are done. This is the set of valid paths, and the first entry is the *default*
 * interview — the one the review labels talk about.
 */
export function neededTasks(candidate) {
  if (!candidate?.has_arrived) return []
  const tasks = []
  if (!candidate.debate_interview_completed) tasks.push(DEBATE_INTERVIEW)
  if (!candidate.personal_interview_completed) tasks.push(PERSONAL_INTERVIEW)
  return tasks
}

/**
 * The rooms that can host this interview. A General room can host either one, so
 * it counts as a match for both.
 *
 * When a candidate is supplied, rooms whose interviewer is on that candidate's
 * restricted list are dropped: a room that is the right type but the wrong
 * person is not a room you can use.
 */
export function roomsForTask(task, rooms = [], candidate = null) {
  const wanted = roomTypeForTask(task)
  if (!wanted) return []
  return rooms.filter(
    (room) =>
      (room.room_type === wanted || room.room_type === 'General') && !hasInterviewerConflict(room, candidate),
  )
}

/** A General room is the wildcard: at equal load, a dedicated room is kept free. */
const generalnessOf = (room) => (room.room_type === 'General' ? 1 : 0)

/**
 * Order two possible placements, best first.
 *
 * 1. **Fewest people already in the room.** An empty room (load 0) always beats
 *    an occupied one, so this one comparison covers both "an empty room wins
 *    outright" and "otherwise the shortest queue does".
 * 2. **Debate before Personal.** Only reached when the two tracks are equally
 *    busy, which is exactly the stated tie-break.
 * 3. **A dedicated room before a General one.** The wildcard can serve either
 *    interview, so it is worth keeping in reserve.
 * 4. **Room name.** So the same board always produces the same answer, however
 *    the rows happened to arrive.
 */
function betterPlacement(a, b) {
  return (
    a.load - b.load ||
    TASK_RANK[a.task] - TASK_RANK[b.task] ||
    generalnessOf(a.room) - generalnessOf(b.room) ||
    (a.room.room_name ?? '').localeCompare(b.room.room_name ?? '')
  )
}

/**
 * Steps B and C — where should this candidate go, across the *whole* board.
 *
 * One linear pass over the rooms of every track they still need, keeping the
 * best placement seen. No sort and no per-track queries, so it is O(rooms) for
 * a pair of rooms or a thousand.
 *
 * Comparing individual rooms across both tracks is the same comparison as
 * comparing the two tracks' minimums — the minimum over a union is the smaller
 * of the minimums — but it also gets two things right that per-track minimums
 * cannot: a room blocked by the candidate's interviewer constraints simply is
 * not a placement (so it cannot drag a track's minimum around), and a General
 * room is one room serving either interview rather than being counted in both
 * pools at once.
 *
 * Returns `{ task, room, load, pools }`, or null when the candidate cannot be
 * placed at all. `pools` reports the emptiest room on each track (null where the
 * track has no usable room) purely so callers can log *why* a track won.
 */
export function pickPlacement(candidate, rooms = [], loads = {}) {
  const pools = { [DEBATE_INTERVIEW]: null, [PERSONAL_INTERVIEW]: null }
  let best = null

  for (const task of neededTasks(candidate)) {
    for (const room of roomsForTask(task, rooms, candidate)) {
      const load = loads[room.id] ?? 0
      if (pools[task] === null || load < pools[task]) pools[task] = load

      const placement = { task, room, load }
      if (best === null || betterPlacement(placement, best) < 0) best = placement
    }
  }

  return best === null ? null : { ...best, pools }
}

/**
 * How busy each room is, from candidate rows. The candidate being assigned is
 * skipped: they are on their way out of their current room, so counting them
 * would make the room they are leaving look busier than it is.
 */
export function roomLoads(candidates = [], movingId = null) {
  const loads = {}
  for (const candidate of candidates) {
    if (!candidate?.assigned_room) continue
    if (candidate.id === movingId) continue
    loads[candidate.assigned_room] = (loads[candidate.assigned_room] ?? 0) + 1
  }
  return loads
}

/* ------------------------------ the queue -------------------------------- */
/*
 * Once somebody has arrived, their planned time stops mattering: they are in
 * the building, and the line is by arrival. A candidate who was due at 09:00
 * but walked in at 11:00 goes behind everybody who arrived before them.
 */

/** Arrival stamp in milliseconds, or null when there is none. */
function arrivalMs(candidate) {
  const value = candidate?.arrival_time
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * Someone the dispatcher still has to place: they have arrived, they owe an
 * interview, and they are not standing in a room already. A candidate in a room
 * is being interviewed, not waiting — pressing "call next" must never pull
 * somebody out of a room mid-interview.
 */
export function isWaiting(candidate) {
  return Boolean(candidate?.has_arrived) && !candidate.assigned_room && neededTasks(candidate).length > 0
}

/**
 * The waiting candidates in the order they should be dispatched: **earliest
 * arrival first**.
 *
 * A row whose arrival stamp is missing sorts last rather than first — an
 * unstamped row is unknown, and unknown must never jump the queue. Ties keep the
 * order they came in (the index is an explicit tie-break, because comparing two
 * missing stamps would otherwise produce `NaN` and leave the order to chance).
 */
export function waitingInLine(candidates = []) {
  return candidates
    .map((candidate, index) => ({ candidate, index, at: arrivalMs(candidate) }))
    .filter((entry) => isWaiting(entry.candidate))
    .sort(
      (a, b) =>
        (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER) || a.index - b.index,
    )
    .map((entry) => entry.candidate)
}

/** 1-based place in line for each waiting candidate, keyed by id. */
export function queuePositions(candidates = []) {
  const positions = new Map()
  waitingInLine(candidates).forEach((candidate, index) => positions.set(candidate.id, index + 1))
  return positions
}
