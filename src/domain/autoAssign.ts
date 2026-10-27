/**
 * Auto-assign - sending an arrived candidate to the room that suits them best.
 *
 * Small pure functions rather than one click handler, so the rules can be
 * reasoned about (and tested) without a database or a browser in the room.
 *
 * The headline rule is **global throughput**: no room should sit idle while
 * somebody on the board could be sitting in it. A candidate who still owes both
 * interviews can be routed down *either* track, and the choice is made by
 * comparing how busy the tracks actually are - a slight preference for the
 * debate only breaks ties when the two tracks are equally idle.
 */
import type { Candidate, Room, RoomType, TaskAssignment } from '../core/types'
import { DEBATE_INTERVIEW, PERSONAL_INTERVIEW } from '../core/constants'
import { hasInterviewerConflict, type ConstrainedCandidate } from './conflicts'

export { DEBATE_INTERVIEW, PERSONAL_INTERVIEW }

/** The room type that hosts each interview. */
const TYPE_FOR_TASK: Record<TaskAssignment, RoomType> = {
  [DEBATE_INTERVIEW]: 'Debate',
  [PERSONAL_INTERVIEW]: 'Personal',
}

/** The room type that hosts an interview, e.g. for error messages. */
export function roomTypeForTask(task: TaskAssignment | null | undefined): RoomType | null {
  return task ? (TYPE_FOR_TASK[task] ?? null) : null
}

/**
 * Which track to prefer when both are equally idle.
 *
 * This is the *only* place the debate gets a thumb on the scale, and it never
 * costs an idle room: it is consulted after the load comparison, never before.
 */
const TASK_RANK: Record<TaskAssignment, number> = {
  [DEBATE_INTERVIEW]: 0,
  [PERSONAL_INTERVIEW]: 1,
}

/** The fields the queue algorithms need from a candidate. */
export type QueueCandidate = ConstrainedCandidate &
  Partial<
    Pick<
      Candidate,
      | 'id'
      | 'name'
      | 'has_arrived'
      | 'assigned_room'
      | 'debate_interview_completed'
      | 'personal_interview_completed'
      | 'arrival_time'
    >
  > & { id: string }

/**
 * Step A - the interviews this candidate still owes, debate first. One entry for
 * a forced candidate (only one left), two for one who owes both, none once they
 * are done. This is the set of valid paths, and the first entry is the *default*
 * interview - the one the review labels talk about.
 */
export function neededTasks(candidate: QueueCandidate | null | undefined): TaskAssignment[] {
  if (!candidate?.has_arrived) return []
  const tasks: TaskAssignment[] = []
  if (!candidate.debate_interview_completed) tasks.push(DEBATE_INTERVIEW)
  if (!candidate.personal_interview_completed) tasks.push(PERSONAL_INTERVIEW)
  return tasks
}

/** The minimum a room needs for placement. */
export type PlaceableRoom = Pick<Room, 'id' | 'room_name' | 'room_type'> & {
  interviewers?: Room['interviewers'] | unknown
}

/**
 * The rooms that can host this interview. A General room can host either one, so
 * it counts as a match for both.
 *
 * When a candidate is supplied, rooms whose interviewer is on that candidate's
 * restricted list are dropped: a room that is the right type but the wrong
 * person is not a room you can use.
 */
export function roomsForTask<R extends PlaceableRoom>(
  task: TaskAssignment | null | undefined,
  rooms: R[] = [],
  candidate: ConstrainedCandidate | null = null,
): R[] {
  const wanted = roomTypeForTask(task)
  if (!wanted) return []
  return rooms.filter(
    (room) =>
      (room.room_type === wanted || room.room_type === 'General') &&
      !hasInterviewerConflict(room, candidate),
  )
}

export interface Placement<R extends PlaceableRoom> {
  task: TaskAssignment
  room: R
  load: number
  /** The emptiest room on each track, for logging why a track won. */
  pools: Record<TaskAssignment, number | null>
}

/** A General room is the wildcard: at equal load, a dedicated room is kept free. */
const generalnessOf = (room: PlaceableRoom): number => (room.room_type === 'General' ? 1 : 0)

/**
 * Order two possible placements, best first.
 *
 * 1. **Fewest people already in the room.**
 * 2. **Debate before Personal.**
 * 3. **A dedicated room before a General one.**
 * 4. **Room name**, so the same board always produces the same answer.
 */
function betterPlacement<R extends PlaceableRoom>(
  a: Omit<Placement<R>, 'pools'>,
  b: Omit<Placement<R>, 'pools'>,
): number {
  return (
    a.load - b.load ||
    TASK_RANK[a.task] - TASK_RANK[b.task] ||
    generalnessOf(a.room) - generalnessOf(b.room) ||
    (a.room.room_name ?? '').localeCompare(b.room.room_name ?? '')
  )
}

/**
 * Steps B and C - where should this candidate go, across the *whole* board.
 *
 * One linear pass over the rooms of every track they still need, keeping the
 * best placement seen. No sort and no per-track queries, so it is O(rooms).
 */
export function pickPlacement<C extends QueueCandidate, R extends PlaceableRoom>(
  candidate: C,
  rooms: R[] = [],
  loads: Record<string, number> = {},
): Placement<R> | null {
  const pools: Record<TaskAssignment, number | null> = {
    [DEBATE_INTERVIEW]: null,
    [PERSONAL_INTERVIEW]: null,
  }
  let best: Omit<Placement<R>, 'pools'> | null = null

  for (const task of neededTasks(candidate)) {
    for (const room of roomsForTask(task, rooms, candidate)) {
      const load = loads[room.id] ?? 0
      const current = pools[task]
      if (current === null || load < current) pools[task] = load

      const placement: Omit<Placement<R>, 'pools'> = { task, room, load }
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
export function roomLoads(
  candidates: Array<Pick<Candidate, 'id' | 'assigned_room'>> = [],
  movingId: string | null = null,
): Record<string, number> {
  const loads: Record<string, number> = {}
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
function arrivalMs(candidate: { arrival_time?: string | null } | null | undefined): number | null {
  const value = candidate?.arrival_time
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * Someone the dispatcher still has to place: they have arrived, they owe an
 * interview, and they are not standing in a room already.
 */
export function isWaiting(candidate: QueueCandidate): boolean {
  return Boolean(candidate?.has_arrived) && !candidate.assigned_room && neededTasks(candidate).length > 0
}

/**
 * The waiting candidates in the order they should be dispatched: **earliest
 * arrival first**. A row whose arrival stamp is missing sorts last, and ties
 * keep their incoming order (the index is an explicit tie-break).
 */
export function waitingInLine<C extends QueueCandidate>(candidates: C[] = []): C[] {
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
export function queuePositions(candidates: QueueCandidate[] = []): Map<string, number> {
  const positions = new Map<string, number>()
  waitingInLine(candidates).forEach((candidate, index) => positions.set(candidate.id, index + 1))
  return positions
}
