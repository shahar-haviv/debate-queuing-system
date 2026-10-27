/**
 * The analytics maths.
 *
 * The ledger is written by a trigger, so these tests feed the shapes the trigger
 * produces and assert the numbers a coordinator would read off the dashboard.
 * The awkward cases are the point: a move (one room closes, another opens in
 * the same second), a candidate still sitting in a room, a room renamed or
 * deleted, and a paper interview that must not be counted twice because it also
 * happened to file a digital rubric.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  EVENT,
  LONG_SESSION_MINUTES,
  SCALE_KEYS,
  UNATTRIBUTED,
  UNKNOWN_ROOM,
  buildSessions,
  computeAnalytics,
  leaderboard,
  recentEvents,
  roomStatistics,
  round1,
  rubricScore,
  waitTimes,
} from '../../src/domain/analytics'

/** 2026-10-26 17:00 UTC, so "minute 0" reads like the start of screening. */
const BASE = Date.UTC(2026, 9, 26, 17, 0, 0)
const at = (minutes) => new Date(BASE + minutes * 60_000).toISOString()

let sequence = 0
beforeEach(() => {
  sequence = 0
})

/** One ledger row, with the columns the analytics layer actually reads. */
function event(kind, minute, extra = {}) {
  sequence += 1
  return {
    id: sequence,
    at: at(minute),
    event: kind,
    candidate_id: 'c1',
    candidate_name: 'מועמד לדוגמה',
    room_id: 'room-cl05',
    room_name: 'CL05',
    task: 'Personal Interview',
    interviewer: 'דניאל (לדוגמה)',
    ...extra,
  }
}

const CL05 = { room_id: 'room-cl05', room_name: 'CL05' }
const A206 = { room_id: 'room-a206', room_name: 'A206' }

describe('buildSessions', () => {
  it('measures a stay from assigned to released', () => {
    const sessions = buildSessions([
      event(EVENT.ASSIGNED, 0, CL05),
      event(EVENT.RELEASED, 12, CL05),
    ])

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      roomName: 'CL05',
      roomId: 'room-cl05',
      task: 'Personal Interview',
      minutes: 12,
      completed: false,
      candidateId: 'c1',
    })
  })

  it('measures a stay that ended by completing the interview', () => {
    const sessions = buildSessions([
      event(EVENT.ASSIGNED, 0, CL05),
      event(EVENT.COMPLETED, 18.5, CL05),
    ])

    expect(sessions).toHaveLength(1)
    expect(sessions[0].minutes).toBe(18.5)
    expect(sessions[0].completed).toBe(true)
  })

  it('treats a move as one stay ending and another beginning', () => {
    const sessions = buildSessions([
      event(EVENT.ASSIGNED, 0, A206),
      event(EVENT.RELEASED, 10, A206),
      event(EVENT.ASSIGNED, 10, CL05),
      event(EVENT.RELEASED, 25, CL05),
    ])

    expect(sessions.map((session) => [session.roomName, session.minutes])).toEqual([
      ['A206', 10],
      ['CL05', 15],
    ])
  })

  it('orders a tied move by id, not by array order', () => {
    // Same timestamp: only the identity column says which row came first.
    const released = event(EVENT.RELEASED, 10, A206)
    const assigned = event(EVENT.ASSIGNED, 10, CL05)

    const sessions = buildSessions([
      event(EVENT.ASSIGNED, 0, A206),
      assigned,
      released,
    ])

    expect(sessions.map((session) => session.roomName)).toEqual(['A206'])
    expect(sessions[0].minutes).toBe(10)
  })

  it('leaves out a candidate who is still in a room', () => {
    const sessions = buildSessions([event(EVENT.ASSIGNED, 0, CL05)])
    expect(sessions).toEqual([])
  })

  it('ignores a close that belongs to a different room', () => {
    const sessions = buildSessions([
      event(EVENT.ASSIGNED, 0, CL05),
      event(EVENT.RELEASED, 5, A206),
      event(EVENT.RELEASED, 8, CL05),
    ])

    expect(sessions).toHaveLength(1)
    expect(sessions[0].minutes).toBe(8)
  })

  it('drops an earlier stay when a second assignment arrives unclosed', () => {
    const sessions = buildSessions([
      event(EVENT.ASSIGNED, 0, A206),
      event(EVENT.ASSIGNED, 6, CL05),
      event(EVENT.RELEASED, 9, CL05),
    ])

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ roomName: 'CL05', minutes: 3 })
  })

  it('sorts the ledger before pairing, whatever order it arrives in', () => {
    const sessions = buildSessions([
      event(EVENT.RELEASED, 12, CL05),
      event(EVENT.ASSIGNED, 0, CL05),
    ])

    expect(sessions).toHaveLength(1)
    expect(sessions[0].minutes).toBe(12)
  })

  it('falls back to the candidate name when an old row has no id', () => {
    const sessions = buildSessions([
      event(EVENT.ASSIGNED, 0, { candidate_id: null, candidate_name: 'בלי מזהה' }),
      event(EVENT.RELEASED, 4, { candidate_id: null, candidate_name: 'בלי מזהה' }),
    ])

    expect(sessions).toHaveLength(1)
    expect(sessions[0].key).toBe('name:בלי מזהה')
    expect(sessions[0].candidateId).toBeNull()
  })

  it('keeps candidates apart even when they share a room', () => {
    const sessions = buildSessions([
      event(EVENT.ASSIGNED, 0, CL05),
      event(EVENT.ASSIGNED, 1, { ...CL05, candidate_id: 'c2', candidate_name: 'שנייה' }),
      event(EVENT.RELEASED, 5, { ...CL05, candidate_id: 'c2', candidate_name: 'שנייה' }),
      event(EVENT.RELEASED, 9, CL05),
    ])

    expect(sessions.map((session) => session.minutes)).toEqual([9, 4])
  })

  it('names an unknown room rather than rendering a blank', () => {
    const sessions = buildSessions([
      event(EVENT.ASSIGNED, 0, { room_id: null, room_name: null }),
      event(EVENT.RELEASED, 3, { room_id: null, room_name: null }),
    ])

    expect(sessions[0].roomName).toBe(UNKNOWN_ROOM)
  })

  it('returns nothing for an empty ledger', () => {
    expect(buildSessions()).toEqual([])
    expect(buildSessions([])).toEqual([])
  })
})

describe('roomStatistics', () => {
  const sessions = buildSessions([
    // CL05: three stays, 10 / 20 / 30 minutes.
    event(EVENT.ASSIGNED, 0, CL05),
    event(EVENT.RELEASED, 10, CL05),
    event(EVENT.ASSIGNED, 10, { ...CL05, candidate_id: 'c2' }),
    event(EVENT.RELEASED, 30, { ...CL05, candidate_id: 'c2' }),
    event(EVENT.ASSIGNED, 30, { ...CL05, candidate_id: 'c3' }),
    event(EVENT.RELEASED, 60, { ...CL05, candidate_id: 'c3' }),
    // A206: one stay, 8 minutes.
    event(EVENT.ASSIGNED, 60, A206),
    event(EVENT.RELEASED, 68, A206),
  ])

  it('aggregates volume, average, min and max per room', () => {
    const [cl05, a206] = roomStatistics(sessions)

    expect(cl05).toEqual({
      roomName: 'CL05',
      sessions: 3,
      candidates: 3,
      averageMinutes: 20,
      minMinutes: 10,
      maxMinutes: 30,
    })
    expect(a206).toMatchObject({ roomName: 'A206', sessions: 1, averageMinutes: 8 })
  })

  it('puts the busiest room first', () => {
    expect(roomStatistics(sessions).map((room) => room.roomName)).toEqual(['CL05', 'A206'])
  })

  it('counts one candidate once per room even after a move back', () => {
    const moving = buildSessions([
      event(EVENT.ASSIGNED, 0, A206),
      event(EVENT.RELEASED, 4, A206),
      event(EVENT.ASSIGNED, 4, CL05),
      event(EVENT.RELEASED, 8, CL05),
      event(EVENT.ASSIGNED, 8, A206),
      event(EVENT.RELEASED, 12, A206),
    ])

    const a206 = roomStatistics(moving).find((room) => room.roomName === 'A206')
    expect(a206).toMatchObject({ sessions: 2, candidates: 1 })
  })

  it('has nothing to say about an empty ledger', () => {
    expect(roomStatistics([])).toEqual([])
  })
})

describe('waitTimes', () => {
  it('measures arrival to the first assignment only', () => {
    const waits = waitTimes([
      event(EVENT.ARRIVED, 0, { room_id: null, room_name: null }),
      event(EVENT.ASSIGNED, 7, CL05),
      event(EVENT.RELEASED, 17, CL05),
      event(EVENT.ASSIGNED, 40, CL05),
    ])

    expect(waits).toEqual([7])
  })

  it('skips a candidate who has not been sent anywhere yet', () => {
    expect(waitTimes([event(EVENT.ARRIVED, 0, { room_id: null })])).toEqual([])
  })

  it('skips an assignment with no arrival to measure from', () => {
    expect(waitTimes([event(EVENT.ASSIGNED, 0, CL05)])).toEqual([])
  })

  it('ignores a negative gap caused by a badly ordered hand edit', () => {
    const waits = waitTimes([
      event(EVENT.ARRIVED, 10, { room_id: null }),
      event(EVENT.ASSIGNED, 5, CL05),
    ])

    expect(waits).toEqual([])
  })

  it('averages across candidates', () => {
    const waits = waitTimes([
      event(EVENT.ARRIVED, 0, { candidate_id: 'a', room_id: null }),
      event(EVENT.ASSIGNED, 10, { candidate_id: 'a' }),
      event(EVENT.ARRIVED, 100, { candidate_id: 'b', room_id: null }),
      event(EVENT.ASSIGNED, 120, { candidate_id: 'b' }),
    ])

    expect(waits.sort((x, y) => x - y)).toEqual([10, 20])
  })

  it('returns nothing for an empty ledger', () => {
    expect(waitTimes()).toEqual([])
  })
})

describe('rubricScore', () => {
  it('averages the 1–5 questions and nothing else', () => {
    const score = rubricScore({
      rating_availability: 5,
      rating_vibe: 3,
      rating_competitiveness: 1,
      age: 22,
      years_remaining: 4,
      candidate_number: '141',
      interviewer_notes: 'חזק',
    })

    expect(score).toBe(3)
  })

  it('ignores ratings the interviewer left blank', () => {
    expect(rubricScore({ rating_availability: 4, rating_vibe: null })).toBe(4)
    expect(rubricScore({ rating_availability: 4, rating_vibe: '' })).toBe(4)
  })

  it('is null when there is nothing to average', () => {
    expect(rubricScore({})).toBeNull()
    expect(rubricScore({ interviewer_name: 'דניאל' })).toBeNull()
    expect(rubricScore(null)).toBeNull()
  })

  it('derives its keys from the rubric, so a new rating is included', () => {
    expect(SCALE_KEYS).toEqual([
      'rating_availability',
      'rating_vibe',
      'rating_competitiveness',
    ])
  })
})

describe('leaderboard', () => {
  const evaluation = (name, scores, extra = {}) => ({
    candidate_id: 'c1',
    task: 'Personal Interview',
    interviewer_name: name,
    scores,
    ...extra,
  })

  it('counts filed rubrics and averages the score given', () => {
    const rows = leaderboard([
      evaluation('דניאל', { rating_availability: 5, rating_vibe: 4, rating_competitiveness: 3 }),
      evaluation('דניאל', { rating_availability: 2, rating_vibe: 2, rating_competitiveness: 2 }, {
        candidate_id: 'c2',
      }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ interviewer: 'דניאל', digital: 2, averageScore: 3 })
  })

  it('credits a paper completion to every named interviewer in the room', () => {
    const rows = leaderboard(
      [],
      [
        event(EVENT.COMPLETED, 10, {
          candidate_id: 'c9',
          task: 'Personal Interview',
          interviewer: 'רומי, דניאל',
        }),
      ],
    )

    expect(rows.map((row) => [row.interviewer, row.manual])).toEqual([
      ['דניאל', 1],
      ['רומי', 1],
    ])
  })

  it('does not double-count a completion that also filed a rubric', () => {
    const rows = leaderboard(
      [evaluation('דניאל', { rating_vibe: 5 })],
      [event(EVENT.COMPLETED, 10, { candidate_id: 'c1', interviewer: 'דניאל' })],
    )

    expect(rows[0]).toMatchObject({ digital: 1, manual: 0, total: 1 })
  })

  it('counts a completion for the same candidate but the other task as paper', () => {
    const rows = leaderboard(
      [evaluation('דניאל', { rating_vibe: 5 })],
      [
        event(EVENT.COMPLETED, 10, {
          candidate_id: 'c1',
          task: 'Debate Interview',
          interviewer: 'דניאל',
        }),
      ],
    )

    expect(rows[0]).toMatchObject({ digital: 1, manual: 1, total: 2 })
  })

  it('counts a completion with no room panel as unattributed', () => {
    const rows = leaderboard([], [event(EVENT.COMPLETED, 10, { interviewer: null })])

    expect(rows[0]).toMatchObject({ interviewer: UNATTRIBUTED, manual: 1, digital: 0 })
  })

  it('puts whoever handled the most interviews first', () => {
    const rows = leaderboard(
      [evaluation('א', { rating_vibe: 3 }), evaluation('ב', { rating_vibe: 3 }, { candidate_id: 'c2' })],
      [event(EVENT.COMPLETED, 5, { candidate_id: 'c3', interviewer: 'ב' })],
    )

    expect(rows.map((row) => row.interviewer)).toEqual(['ב', 'א'])
  })

  it('leaves the average null for somebody who never scored anything', () => {
    const rows = leaderboard([], [event(EVENT.COMPLETED, 5, { interviewer: 'רותם' })])
    expect(rows[0].averageScore).toBeNull()
  })

  it('has nothing to say about an empty event log', () => {
    expect(leaderboard([], [])).toEqual([])
  })
})

describe('recentEvents', () => {
  it('returns the ledger newest first', () => {
    const rows = recentEvents([
      event(EVENT.ARRIVED, 0),
      event(EVENT.ASSIGNED, 5, CL05),
      event(EVENT.COMPLETED, 20, CL05),
    ])

    expect(rows.map((row) => row.event)).toEqual(['completed', 'assigned', 'arrived'])
  })

  it('caps the list and keeps the newest rows', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      event(EVENT.ARRIVED, index, { candidate_name: `c${index}` }),
    )

    const rows = recentEvents(many, 5)
    expect(rows).toHaveLength(5)
    expect(rows[0].candidateName).toBe('c29')
  })

  it('describes a row with the names snapshotted at the time', () => {
    const [row] = recentEvents([
      event(EVENT.COMPLETED, 10, { ...CL05, interviewer: 'דניאל, רומי' }),
    ])

    expect(row).toMatchObject({
      event: 'completed',
      candidateName: 'מועמד לדוגמה',
      roomName: 'CL05',
      task: 'Personal Interview',
      interviewer: 'דניאל, רומי',
    })
  })

  it('copes with a sparse row and with no rows at all', () => {
    const [row] = recentEvents([event(EVENT.ARRIVED, 0, { candidate_name: null })])
    expect(row.candidateName).toBe('')
    expect(recentEvents([])).toEqual([])
  })
})

describe('computeAnalytics', () => {
  const events = [
    event(EVENT.ARRIVED, 0, { candidate_id: 'c1', room_id: null, room_name: null }),
    event(EVENT.ASSIGNED, 10, { candidate_id: 'c1', ...CL05 }),
    event(EVENT.COMPLETED, 25, { candidate_id: 'c1', ...CL05, interviewer: 'דניאל' }),
    event(EVENT.ARRIVED, 5, { candidate_id: 'c2', room_id: null, room_name: null }),
    event(EVENT.ASSIGNED, 15, { candidate_id: 'c2', ...A206 }),
    event(EVENT.RELEASED, 20, { candidate_id: 'c2', ...A206 }),
  ]

  const evaluations = [
    {
      candidate_id: 'c1',
      task: 'Personal Interview',
      interviewer_name: 'דניאל',
      scores: { rating_availability: 4, rating_vibe: 5, rating_competitiveness: 3 },
    },
  ]

  it('summarises the whole ledger', () => {
    const analytics = computeAnalytics({ events, evaluations })

    expect(analytics.totals).toMatchObject({
      processed: 2,
      sessions: 2,
      averageRoomMinutes: 10,
      averageWaitMinutes: 10,
      waitedCandidates: 2,
      busiestRoom: { roomName: 'A206', sessions: 1, candidates: 1 },
      events: 6,
      evaluations: 1,
    })
  })

  it('fills every table', () => {
    const analytics = computeAnalytics({ events, evaluations })

    expect(analytics.rooms).toHaveLength(2)
    expect(analytics.leaderboard).toHaveLength(1)
    expect(analytics.leaderboard[0]).toMatchObject({
      interviewer: 'דניאל',
      digital: 1,
      manual: 0,
      averageScore: 4,
    })
  })

  it('is safe with no arguments at all', () => {
    expect(computeAnalytics().totals).toMatchObject({
      processed: 0,
      sessions: 0,
      averageRoomMinutes: null,
      averageWaitMinutes: null,
      busiestRoom: null,
      events: 0,
      evaluations: 0,
    })
  })
})

describe('round1', () => {
  it('rounds to one decimal and passes null through', () => {
    expect(round1(12.34)).toBe(12.3)
    expect(round1(12.36)).toBe(12.4)
    expect(round1(null)).toBeNull()
    expect(round1(Number.NaN)).toBeNull()
  })

  it('flags twenty minutes as the long-session threshold', () => {
    expect(LONG_SESSION_MINUTES).toBe(20)
  })
})
