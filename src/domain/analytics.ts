/**
 * Operational metrics, computed from the raw ledger.
 *
 * Everything here is pure: give it rows, get numbers back. No Supabase, no
 * clock, no DOM - which keeps the hard part (pairing a move with the room it
 * closed, deciding what counts as "paper") testable without a database.
 *
 * Inputs are the append-only `candidate_events` ledger and `evaluations`.
 * A *session* is one stay in one room: an `assigned` event opens it, the next
 * `released`/`completed` for that same room closes it.
 */
import type {
  AnalyticsSummary,
  CandidateEvent,
  Evaluation,
  EventKind,
  InterviewerStat,
  RecentEvent,
  RoomSession,
  RoomStat,
  Scores,
} from '../core/types'
import { LONG_SESSION_MINUTES, UNATTRIBUTED, UNKNOWN_ROOM } from '../core/constants'
import { PERSONAL_INTERVIEW_FORM, flattenQuestions } from './evaluation'

export const EVENT = {
  ARRIVED: 'arrived',
  UNARRIVED: 'unarrived',
  ASSIGNED: 'assigned',
  RELEASED: 'released',
  COMPLETED: 'completed',
} as const satisfies Record<string, EventKind>

/** A room session longer than this is flagged red on the duration chart. */
export { LONG_SESSION_MINUTES, UNKNOWN_ROOM, UNATTRIBUTED }

/**
 * The rubric's 1-5 questions. Derived from the form rather than hardcoded, so a
 * new rating question is averaged in automatically. `age` and `years_remaining`
 * are numbers too - averaging those into a "score" would be nonsense.
 */
export const SCALE_KEYS: string[] = flattenQuestions(PERSONAL_INTERVIEW_FORM)
  .filter((question) => question.type === 'scale')
  .map((question) => question.key)

export function mean(values: Array<number | null | undefined> = []): number | null {
  const clean = values.filter((value): value is number => Number.isFinite(value))
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null
}

/** One decimal, which is all the operational view needs. */
export function round1(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? Math.round((value as number) * 10) / 10 : null
}

const minutesBetween = (from: string, to: string): number =>
  (new Date(to).getTime() - new Date(from).getTime()) / 60000

/**
 * Ledger order. Timestamps can tie - a move writes `released` and `assigned` in
 * the same statement - so the identity column breaks the tie in insertion order.
 */
function ordered(events: CandidateEvent[]): CandidateEvent[] {
  return [...events].sort((a, b) => {
    const byTime = new Date(a.at).getTime() - new Date(b.at).getTime()
    if (byTime !== 0) return byTime
    return (Number(a.id) || 0) - (Number(b.id) || 0)
  })
}

/** A candidate key that survives a missing id, e.g. a hand-inserted row. */
const candidateKey = (event: CandidateEvent): string =>
  event.candidate_id ?? `name:${String(event.candidate_name ?? '').trim()}`

interface OpenSession {
  key: string
  candidateId: string | null
  candidateName: string | null
  roomId: string | null
  roomName: string | null
  task: RoomSession['task']
  startedAt: string
}

/**
 * One entry per closed stay in a room.
 *
 * Only closed sessions are returned: somebody still sitting in a room has no
 * duration yet, and folding a half-finished interview into an average would
 * quietly understate it. A second `assigned` with no close means the ledger
 * never saw the first session end, so the earlier one is dropped.
 */
export function buildSessions(events: CandidateEvent[] = []): RoomSession[] {
  const byCandidate = new Map<string, CandidateEvent[]>()
  for (const event of ordered(events)) {
    const key = candidateKey(event)
    if (!byCandidate.has(key)) byCandidate.set(key, [])
    byCandidate.get(key)?.push(event)
  }

  const sessions: RoomSession[] = []
  for (const [key, list] of byCandidate) {
    let open: OpenSession | null = null

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
      // always writes the room the candidate was in; this guards hand edits.
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
export function roomStatistics(sessions: RoomSession[] = []): RoomStat[] {
  const byRoom = new Map<string, RoomSession[]>()
  for (const session of sessions) {
    const roomName = session.roomName ?? UNKNOWN_ROOM
    if (!byRoom.has(roomName)) byRoom.set(roomName, [])
    byRoom.get(roomName)?.push(session)
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
 * first room. Candidates missing either half of the pair are skipped.
 */
export function waitTimes(events: CandidateEvent[] = []): number[] {
  const byCandidate = new Map<string, { arrivedAt: string | null; firstAssignedAt: string | null }>()

  for (const event of ordered(events)) {
    if (!event.candidate_id) continue
    if (!byCandidate.has(event.candidate_id)) {
      byCandidate.set(event.candidate_id, { arrivedAt: null, firstAssignedAt: null })
    }
    const row = byCandidate.get(event.candidate_id)
    if (!row) continue

    if (event.event === EVENT.ARRIVED && !row.arrivedAt) row.arrivedAt = event.at
    if (event.event === EVENT.ASSIGNED && !row.firstAssignedAt) row.firstAssignedAt = event.at
  }

  const waits: number[] = []
  for (const row of byCandidate.values()) {
    if (!row.arrivedAt || !row.firstAssignedAt) continue
    const minutes = minutesBetween(row.arrivedAt, row.firstAssignedAt)
    if (Number.isFinite(minutes) && minutes >= 0) waits.push(minutes)
  }
  return waits
}

/** The average of the 1-5 ratings in one filed rubric, or null if none. */
export function rubricScore(scores: Scores = {}): number | null {
  return mean(SCALE_KEYS.map((key) => {
    const value = scores?.[key]
    return typeof value === 'number' ? value : null
  }))
}

/**
 * Who did the interviews, digital or on paper.
 *
 *   • a **digital rubric** is one row in `evaluations`, attributed to the name
 *     typed into `interviewer_name`;
 *   • a **manual completion** is a `completed` event with *no* rubric filed for
 *     that candidate and task - credited to the room's panel at the time,
 *     split on commas, and to `Unattributed` when the room named nobody.
 */
export function leaderboard(evaluations: Evaluation[] = [], events: CandidateEvent[] = []): InterviewerStat[] {
  const rows = new Map<
    string,
    { interviewer: string; digital: number; manual: number; scoreSum: number; scoreCount: number }
  >()

  const rowFor = (name: string) => {
    if (!rows.has(name)) {
      rows.set(name, { interviewer: name, digital: 0, manual: 0, scoreSum: 0, scoreCount: 0 })
    }
    return rows.get(name) as {
      interviewer: string
      digital: number
      manual: number
      scoreSum: number
      scoreCount: number
    }
  }

  const filed = new Set<string>()
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

/**
 * The last few rows, newest first, for the dashboard's movement log.
 *
 * Useful precisely when there is not enough history for a session yet: it shows
 * that the ledger is recording, and what it recorded.
 */
export function recentEvents(events: CandidateEvent[] = [], limit = 20): RecentEvent[] {
  return ordered(events)
    .slice(-limit)
    .reverse()
    .map((event) => ({
      id: event.id,
      at: event.at,
      event: event.event,
      candidateName: event.candidate_name ?? '',
      roomName: event.room_name ?? '',
      task: event.task ?? '',
      interviewer: event.interviewer ?? '',
    }))
}

/** Everything the dashboard renders, in one pass. */
export function computeAnalytics({
  events = [],
  evaluations = [],
}: {
  events?: CandidateEvent[]
  evaluations?: Evaluation[]
} = {}): AnalyticsSummary {
  const sessions = buildSessions(events)
  const rooms = roomStatistics(sessions)
  const waits = waitTimes(events)
  const busiest = rooms[0] ?? null

  return {
    sessions,
    rooms,
    waits,
    recent: recentEvents(events),
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
