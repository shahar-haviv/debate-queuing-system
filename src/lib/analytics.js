/**
 * Operational metrics, computed from the raw ledger.
 *
 * Everything here is pure: give it rows, get numbers back. No Supabase, no
 * clock, no DOM — which keeps the hard part (pairing a move with the room it
 * closed, deciding what counts as "paper") testable without a database.
 *
 * The inputs are the append-only `candidate_events` ledger and the
 * `evaluations` table. A *session* is one stay in one room: an `assigned` event
 * opens it, the next `released`/`completed` for that same room closes it.
 */
import { PERSONAL_INTERVIEW_FORM, flattenQuestions } from './evaluation.js'

export const EVENT = {
  ARRIVED: 'arrived',
  UNARRIVED: 'unarrived',
  ASSIGNED: 'assigned',
  RELEASED: 'released',
  COMPLETED: 'completed',
}

/** A room session longer than this is flagged red on the duration chart. */
export const LONG_SESSION_MINUTES = 20

export const UNKNOWN_ROOM = 'Unknown room'
export const UNATTRIBUTED = 'Unattributed'

/**
 * The rubric's 1–5 questions. Derived from the form rather than hardcoded, so a
 * new rating question is averaged in automatically. `age` and `years_remaining`
 * are numbers too — averaging those into a "score" would be nonsense.
 */
export const SCALE_KEYS = flattenQuestions(PERSONAL_INTERVIEW_FORM)
  .filter((question) => question.type === 'scale')
  .map((question) => question.key)

export function mean(values = []) {
  const clean = values.filter((value) => Number.isFinite(value))
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null
}

/** One decimal, which is all the operational view needs. */
export function round1(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null
}

const minutesBetween = (from, to) => (new Date(to).getTime() - new Date(from).getTime()) / 60000

/**
 * Ledger order. Timestamps can tie — a move writes `released` and `assigned`
 * in the same statement — so the identity column breaks the tie in insertion
 * order. Without it a move read back the wrong way round would look like a
 * candidate entering a room before leaving the previous one.
 */
function ordered(events) {
  return [...events].sort((a, b) => {
    const byTime = new Date(a.at).getTime() - new Date(b.at).getTime()
    if (byTime !== 0) return byTime
    return (Number(a.id) || 0) - (Number(b.id) || 0)
  })
}

/** A candidate key that survives a missing id, e.g. a hand-inserted row. */
const candidateKey = (event) =>
  event.candidate_id ?? `name:${String(event.candidate_name ?? '').trim()}`

/**
 * One entry per closed stay in a room.
 *
 * Only closed sessions are returned: somebody still sitting in a room has no
 * duration yet, and folding a half-finished interview into an average would
 * quietly understate it. A second `assigned` with no close means the ledger
 * never saw the first session end, so the earlier one is dropped rather than
 * paired with the wrong room.
 */
export function buildSessions(events = []) {
  const byCandidate = new Map()
  for (const event of ordered(events)) {
    const key = candidateKey(event)
    if (!byCandidate.has(key)) byCandidate.set(key, [])
    byCandidate.get(key).push(event)
  }

  const sessions = []
  for (const [key, list] of byCandidate) {
    let open = null

    for (const event of list) {
      if (event.event === EVENT.ASSIGNED) {
        open = {
          key,
          candidateId: event.candidate_id ?? null,
          candidateName: event.candidate_name ?? null,
          roomId: event.room_id ?? null,
          roomName: event.room_name ?? null,
          task: event.task ?? null,
          startedAt: event.at,
        }
        continue
      }

      if (!open) continue
      if (event.event !== EVENT.RELEASED && event.event !== EVENT.COMPLETED) continue

      // A close for a different room is not this session's close. The trigger
      // always writes the room the candidate was in, so this only guards
      // against hand-edited rows.
      if (event.room_id && open.roomId && event.room_id !== open.roomId) continue

      const session = open
      open = null
      const minutes = minutesBetween(session.startedAt, event.at)
      if (!Number.isFinite(minutes) || minutes < 0) continue

      sessions.push({
        ...session,
        roomName: session.roomName ?? event.room_name ?? UNKNOWN_ROOM,
        endedAt: event.at,
        minutes,
        completed: event.event === EVENT.COMPLETED,
      })
    }
  }

  return sessions
}

/**
 * Per-room volume and duration.
 *
 * Sorted by volume, then by name, so the busiest room is simply the first row
 * and two rooms with equal volume still have a stable order between renders.
 */
export function roomStatistics(sessions = []) {
  const byRoom = new Map()
  for (const session of sessions) {
    const roomName = session.roomName ?? UNKNOWN_ROOM
    if (!byRoom.has(roomName)) byRoom.set(roomName, [])
    byRoom.get(roomName).push(session)
  }

  return [...byRoom.entries()]
    .map(([roomName, list]) => {
      const durations = list.map((session) => session.minutes)
      return {
        roomName,
        sessions: list.length,
        candidates: new Set(list.map((session) => session.key)).size,
        averageMinutes: round1(mean(durations)),
        minMinutes: round1(Math.min(...durations)),
        maxMinutes: round1(Math.max(...durations)),
      }
    })
    .sort((a, b) => b.sessions - a.sessions || a.roomName.localeCompare(b.roomName))
}

/**
 * How long each candidate waited between arriving and being sent into their
 * first room.
 *
 * Candidates missing either half of the pair are skipped: an arrival with no
 * assignment yet has not finished waiting, and an assignment with no arrival
 * (back-dated data, or a hand edit) has no start to measure from.
 */
export function waitTimes(events = []) {
  const byCandidate = new Map()

  for (const event of ordered(events)) {
    if (!event.candidate_id) continue
    if (!byCandidate.has(event.candidate_id)) {
      byCandidate.set(event.candidate_id, { arrivedAt: null, firstAssignedAt: null })
    }
    const row = byCandidate.get(event.candidate_id)

    if (event.event === EVENT.ARRIVED && !row.arrivedAt) row.arrivedAt = event.at
    if (event.event === EVENT.ASSIGNED && !row.firstAssignedAt) row.firstAssignedAt = event.at
  }

  const waits = []
  for (const row of byCandidate.values()) {
    if (!row.arrivedAt || !row.firstAssignedAt) continue
    const minutes = minutesBetween(row.arrivedAt, row.firstAssignedAt)
    if (Number.isFinite(minutes) && minutes >= 0) waits.push(minutes)
  }
  return waits
}

/** The average of the 1–5 ratings in one filed rubric, or null if none. */
export function rubricScore(scores = {}) {
  return mean(SCALE_KEYS.map((key) => scores?.[key]))
}

/**
 * Who did the interviews, digital or on paper.
 *
 * The two sources answer different questions, so they are counted separately
 * rather than summed blindly:
 *
 *   • a **digital rubric** is one row in `evaluations`, attributed to the name
 *     typed into `interviewer_name`;
 *   • a **manual completion** is a `completed` event with *no* rubric filed for
 *     that candidate and task — the interview happened, the feedback did not
 *     reach the app. Those are credited to the room's panel at the time
 *     (`interviewer`), split on commas so a two-person panel both get credit,
 *     and to `Unattributed` when the room named nobody.
 *
 * Counting the completion as paper only when no rubric exists is what stops a
 * normal digital submission — which also marks the interview complete — from
 * being counted twice.
 */
export function leaderboard(evaluations = [], events = []) {
  const rows = new Map()

  const rowFor = (name) => {
    if (!rows.has(name)) {
      rows.set(name, { interviewer: name, digital: 0, manual: 0, scoreSum: 0, scoreCount: 0 })
    }
    return rows.get(name)
  }

  const filed = new Set()
  for (const evaluation of evaluations) {
    const name = String(evaluation.interviewer_name ?? '').trim() || UNATTRIBUTED
    rowFor(name).digital += 1
    filed.add(`${evaluation.candidate_id}:${evaluation.task}`)

    const score = rubricScore(evaluation.scores)
    if (score !== null) {
      const row = rowFor(name)
      row.scoreSum += score
      row.scoreCount += 1
    }
  }

  for (const event of events) {
    if (event.event !== EVENT.COMPLETED) continue
    if (filed.has(`${event.candidate_id}:${event.task}`)) continue

    const panel = String(event.interviewer ?? '').trim()
    const names = panel ? panel.split(/\s*,\s*/).filter(Boolean) : [UNATTRIBUTED]
    for (const name of new Set(names)) rowFor(name).manual += 1
  }

  return [...rows.values()]
    .map((row) => ({
      interviewer: row.interviewer,
      digital: row.digital,
      manual: row.manual,
      total: row.digital + row.manual,
      averageScore: round1(row.scoreCount ? row.scoreSum / row.scoreCount : null),
    }))
    .sort(
      (a, b) =>
        b.total - a.total || b.digital - a.digital || a.interviewer.localeCompare(b.interviewer),
    )
}

/** Everything the dashboard renders, in one pass. */
export function computeAnalytics({ events = [], evaluations = [] } = {}) {
  const sessions = buildSessions(events)
  const rooms = roomStatistics(sessions)
  const waits = waitTimes(events)
  const busiest = rooms[0] ?? null

  return {
    sessions,
    rooms,
    waits,
    leaderboard: leaderboard(evaluations, events),
    totals: {
      processed: new Set(sessions.map((session) => session.key)).size,
      sessions: sessions.length,
      averageRoomMinutes: round1(mean(sessions.map((session) => session.minutes))),
      averageWaitMinutes: round1(mean(waits)),
      waitedCandidates: waits.length,
      busiestRoom: busiest
        ? { roomName: busiest.roomName, sessions: busiest.sessions, candidates: busiest.candidates }
        : null,
      events: events.length,
      evaluations: evaluations.length,
    },
  }
}
