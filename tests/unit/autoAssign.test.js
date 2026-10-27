import { describe, expect, it } from 'vitest'
import {
  DEBATE_INTERVIEW,
  PERSONAL_INTERVIEW,
  isWaiting,
  neededTasks,
  pickPlacement,
  queuePositions,
  roomLoads,
  roomTypeForTask,
  roomsForTask,
  waitingInLine,
} from '../../src/domain/autoAssign'

/** A room with an optional one-person panel: `room('a206', 'A206', 'Debate', 'daniel')`. */
const room = (id, room_name, room_type, interviewer = null) => ({
  id,
  room_name,
  room_type,
  interviewers: interviewer ? [{ name: interviewer, phone: null }] : [],
})

const DEBATE_ROOMS = [
  room('a206', 'A206', 'Debate'),
  room('a207', 'A207', 'Debate'),
  room('a320', 'A320', 'Debate'),
]
const PERSONAL_ROOMS = [
  room('cl05', 'CL05', 'Personal'),
  room('peb30', 'PEB30', 'Personal'),
]

const candidate = (over = {}) => ({
  id: 'c1',
  name: 'Dana',
  has_arrived: true,
  debate_interview_completed: false,
  personal_interview_completed: false,
  assigned_room: null,
  interviewer_constraints: [],
  ...over,
})

describe('neededTasks — the valid paths, debate first', () => {
  it('offers both interviews while both are outstanding, debate first', () => {
    expect(neededTasks(candidate())).toEqual([DEBATE_INTERVIEW, PERSONAL_INTERVIEW])
    expect(neededTasks(candidate({ has_arrived: true }))).toEqual([DEBATE_INTERVIEW, PERSONAL_INTERVIEW])
  })

  it('is forced to one path once the other interview is done', () => {
    expect(neededTasks(candidate({ debate_interview_completed: true }))).toEqual([PERSONAL_INTERVIEW])
    expect(neededTasks(candidate({ personal_interview_completed: true }))).toEqual([DEBATE_INTERVIEW])
  })

  it('is empty once both are done', () => {
    expect(neededTasks(candidate({ debate_interview_completed: true, personal_interview_completed: true }))).toEqual([])
  })

  it('is empty for somebody who has not arrived', () => {
    expect(neededTasks(candidate({ has_arrived: false }))).toEqual([])
    expect(neededTasks(candidate({ has_arrived: false, debate_interview_completed: true }))).toEqual([])
  })

  it('is safe on a missing candidate', () => {
    expect(neededTasks(null)).toEqual([])
    expect(neededTasks(undefined)).toEqual([])
  })
})

describe('roomTypeForTask', () => {
  it('maps each interview to its room type', () => {
    expect(roomTypeForTask(DEBATE_INTERVIEW)).toBe('Debate')
    expect(roomTypeForTask(PERSONAL_INTERVIEW)).toBe('Personal')
  })

  it('has no type for an unknown task', () => {
    expect(roomTypeForTask('Coffee')).toBe(null)
    expect(roomTypeForTask(null)).toBe(null)
  })
})

describe('roomsForTask — which rooms can host it', () => {
  it('pairs a debate target with debate rooms only', () => {
    const rooms = [...DEBATE_ROOMS, ...PERSONAL_ROOMS]
    expect(roomsForTask(DEBATE_INTERVIEW, rooms).map((r) => r.room_name)).toEqual(['A206', 'A207', 'A320'])
  })

  it('pairs a personal target with personal rooms only', () => {
    const rooms = [...DEBATE_ROOMS, ...PERSONAL_ROOMS]
    expect(roomsForTask(PERSONAL_INTERVIEW, rooms).map((r) => r.room_name)).toEqual(['CL05', 'PEB30'])
  })

  it('treats a General room as a wildcard for either interview', () => {
    const rooms = [room('g1', 'G1', 'General')]
    expect(roomsForTask(DEBATE_INTERVIEW, rooms)).toHaveLength(1)
    expect(roomsForTask(PERSONAL_INTERVIEW, rooms)).toHaveLength(1)
  })

  it('returns nothing for a task with no room type', () => {
    expect(roomsForTask('Coffee', DEBATE_ROOMS)).toEqual([])
    expect(roomsForTask(null, DEBATE_ROOMS)).toEqual([])
  })

  it('returns nothing when there are no rooms at all', () => {
    expect(roomsForTask(DEBATE_INTERVIEW, [])).toEqual([])
    expect(roomsForTask(DEBATE_INTERVIEW)).toEqual([])
  })
})

describe('roomsForTask — conflict of interest filter', () => {
  it('drops a debate room staffed by a restricted interviewer', () => {
    const rooms = [room('a206', 'A206', 'Debate', 'daniel'), room('a207', 'A207', 'Debate', 'Dana')]
    const c = candidate({ interviewer_constraints: ['daniel'] })
    expect(roomsForTask(DEBATE_INTERVIEW, rooms, c).map((r) => r.room_name)).toEqual(['A207'])
  })

  it('keeps a room with no interviewer recorded', () => {
    const rooms = [room('a206', 'A206', 'Debate', null)]
    expect(roomsForTask(DEBATE_INTERVIEW, rooms, candidate({ interviewer_constraints: ['daniel'] }))).toHaveLength(1)
  })

  it('filters the wildcard General room too', () => {
    const rooms = [room('g1', 'G1', 'General', 'daniel')]
    const c = candidate({ interviewer_constraints: ['DANIEL'] })
    expect(roomsForTask(DEBATE_INTERVIEW, rooms, c)).toEqual([])
    expect(roomsForTask(PERSONAL_INTERVIEW, rooms, c)).toEqual([])
  })

  it('is a no-op when no candidate is supplied', () => {
    const rooms = [room('a206', 'A206', 'Debate', 'daniel')]
    expect(roomsForTask(DEBATE_INTERVIEW, rooms)).toHaveLength(1)
    expect(roomsForTask(DEBATE_INTERVIEW, rooms, null)).toHaveLength(1)
  })

  it('disqualifies a room when one member of a panel is restricted', () => {
    const panelRoom = {
      id: 'a206',
      room_name: 'A206',
      room_type: 'Debate',
      interviewers: [
        { name: 'Romi', phone: null },
        { name: 'daniel', phone: '050-1' },
      ],
    }
    const strangerRoom = {
      id: 'a207',
      room_name: 'A207',
      room_type: 'Debate',
      interviewers: [{ name: 'Romi', phone: null }, { name: 'Yael', phone: null }],
    }
    const c = candidate({ interviewer_constraints: ['daniel'] })
    expect(roomsForTask(DEBATE_INTERVIEW, [panelRoom, strangerRoom], c).map((r) => r.room_name)).toEqual(['A207'])
  })
})

describe('roomLoads — how busy each room is', () => {
  const seated = (id, name, assigned_room) => ({ id, name, assigned_room })

  it('counts candidates per room and ignores the unassigned', () => {
    const loads = roomLoads([
      seated('c1', 'A', 'a206'),
      seated('c2', 'B', 'a206'),
      seated('c3', 'C', 'a207'),
      seated('c4', 'D', null),
    ])
    expect(loads).toEqual({ a206: 2, a207: 1 })
  })

  it('excludes the candidate being moved, so the room they are leaving is not over-counted', () => {
    const loads = roomLoads([seated('c1', 'A', 'a206'), seated('c2', 'B', 'a206')], 'c1')
    expect(loads).toEqual({ a206: 1 })
  })

  it('is empty for an empty board', () => {
    expect(roomLoads([])).toEqual({})
    expect(roomLoads()).toEqual({})
  })
})

describe('pickPlacement — the track comparison', () => {
  // A candidate who owes both interviews can be sent down either track, so the
  // choice is made across the whole board: whichever room is least busy wins,
  // and the debate is only a tie-break.
  const both = (over = {}) => candidate({ id: 'me', ...over })
  const debateOnly = both({ personal_interview_completed: true })
  const personalOnly = both({ debate_interview_completed: true })

  it('sends a forced candidate down their track, ignoring the idle other track', () => {
    // Only Personal is outstanding and it is the busy track. The idle debate
    // rooms must not tempt the algorithm off the path the candidate must walk.
    const rooms = [...DEBATE_ROOMS, ...PERSONAL_ROOMS]
    const loads = { a206: 0, a207: 0, a320: 0, cl05: 7, peb30: 5 }
    const pick = pickPlacement(personalOnly, rooms, loads)
    expect(pick.task).toBe(PERSONAL_INTERVIEW)
    expect(pick.room.room_name).toBe('PEB30')
  })

  it('prefers the debate when the two tracks are equally idle (Condition C)', () => {
    const rooms = [...DEBATE_ROOMS, ...PERSONAL_ROOMS]
    const loads = { a206: 3, a207: 3, a320: 3, cl05: 3, peb30: 3 }
    const pick = pickPlacement(both(), rooms, loads)
    expect(pick.task).toBe(DEBATE_INTERVIEW)
    expect(pick.room.room_name).toBe('A206')
  })

  it('takes an empty room on either track before anything occupied (Condition A)', () => {
    const rooms = [...DEBATE_ROOMS, ...PERSONAL_ROOMS]
    const loads = { a206: 2, a207: 2, a320: 2, cl05: 0, peb30: 4 }
    const pick = pickPlacement(both(), rooms, loads)
    expect(pick.task).toBe(PERSONAL_INTERVIEW)
    expect(pick.room.room_name).toBe('CL05')
  })

  it('prefers the debate when both tracks have an empty room (Condition A tie)', () => {
    const rooms = [...DEBATE_ROOMS, ...PERSONAL_ROOMS]
    const loads = { a206: 0, a207: 4, a320: 4, cl05: 0, peb30: 3 }
    const pick = pickPlacement(both(), rooms, loads)
    expect(pick.task).toBe(DEBATE_INTERVIEW)
    expect(pick.room.room_name).toBe('A206')
  })

  it('sends them to the shorter queue even when it is not the debate (Condition B)', () => {
    // The reported bottleneck: a deep debate queue beside an idle personal one.
    const rooms = [...DEBATE_ROOMS, ...PERSONAL_ROOMS]
    const loads = { a206: 20, a207: 21, a320: 19, cl05: 1, peb30: 2 }
    const pick = pickPlacement(both(), rooms, loads)
    expect(pick.task).toBe(PERSONAL_INTERVIEW)
    expect(pick.room.room_name).toBe('CL05')
  })

  it('sends a debate-heavy candidate to an empty personal room rather than join the queue', () => {
    // The exact shape of the reported failure: 40 deep on debate, personal idle.
    const rooms = [...DEBATE_ROOMS, ...PERSONAL_ROOMS]
    const loads = { a206: 14, a207: 13, a320: 13, cl05: 0, peb30: 0 }
    const pick = pickPlacement(both(), rooms, loads)
    expect(pick.task).toBe(PERSONAL_INTERVIEW)
    expect(pick.room.room_name).toBe('CL05')
  })

  it('falls back to the other track when one track has no rooms at all', () => {
    const pick = pickPlacement(both(), PERSONAL_ROOMS, { cl05: 9, peb30: 9 })
    expect(pick.task).toBe(PERSONAL_INTERVIEW)
    expect(pick.room.room_name).toBe('CL05')
  })

  it('falls back to the other track when every room on one track is blocked', () => {
    // Every debate room is staffed by somebody this candidate must avoid, so the
    // personal track is the only way through — even though it is busier.
    const rooms = [
      room('a206', 'A206', 'Debate', 'daniel'),
      room('a207', 'A207', 'Debate', 'daniel'),
      room('cl05', 'CL05', 'Personal'),
      room('peb30', 'PEB30', 'Personal'),
    ]
    const pick = pickPlacement(both({ interviewer_constraints: ['daniel'] }), rooms, {
      a206: 0,
      a207: 0,
      cl05: 5,
      peb30: 5,
    })
    expect(pick.task).toBe(PERSONAL_INTERVIEW)
    expect(pick.room.room_name).toBe('CL05')
  })

  it("never lets a blocked room skew its track's load", () => {
    // a206 is empty but off-limits; a207 has somebody in it. The usable debate
    // room is the occupied one, so the comparison is 1 vs 0 and personal wins.
    const rooms = [room('a206', 'A206', 'Debate', 'daniel'), room('a207', 'A207', 'Debate'), room('cl05', 'CL05', 'Personal')]
    const pick = pickPlacement(both({ interviewer_constraints: ['daniel'] }), rooms, { a206: 0, a207: 1, cl05: 0 })
    expect(pick.task).toBe(PERSONAL_INTERVIEW)
    expect(pick.room.room_name).toBe('CL05')
  })

  it('picks the emptiest room within the chosen track, naming ties deterministically', () => {
    const loads = { a206: 4, a207: 2, a320: 2 }
    expect(pickPlacement(debateOnly, DEBATE_ROOMS, loads).room.room_name).toBe('A207')

    const shuffled = [DEBATE_ROOMS[2], DEBATE_ROOMS[0], DEBATE_ROOMS[1]]
    expect(pickPlacement(debateOnly, shuffled, loads).room.room_name).toBe('A207')
  })

  it('treats a missing count as empty', () => {
    expect(pickPlacement(debateOnly, DEBATE_ROOMS, {}).room.room_name).toBe('A206')
    expect(pickPlacement(debateOnly, DEBATE_ROOMS).room.room_name).toBe('A206')
  })

  it('counts a General room once, as a wildcard for either track', () => {
    // G1 is empty and can host either interview. It must be chosen, and it must
    // arrive as a single placement rather than being counted twice.
    const rooms = [room('g1', 'G1', 'General'), ...DEBATE_ROOMS, ...PERSONAL_ROOMS]
    const loads = { a206: 1, a207: 1, a320: 1, cl05: 1, peb30: 1, g1: 0 }
    const pick = pickPlacement(both(), rooms, loads)
    expect(pick.room.room_name).toBe('G1')
    expect(pick.task).toBe(DEBATE_INTERVIEW)
  })

  it('keeps a dedicated room in reserve over an equally idle General one', () => {
    const rooms = [room('g1', 'G1', 'General'), room('a206', 'A206', 'Debate')]
    expect(pickPlacement(both(), rooms, { g1: 0, a206: 0 }).room.room_name).toBe('A206')
  })

  it("reports each track's emptiest room, so the decision can be explained", () => {
    const rooms = [...DEBATE_ROOMS, ...PERSONAL_ROOMS]
    const pick = pickPlacement(both(), rooms, { a206: 4, a207: 6, a320: 5, cl05: 0, peb30: 2 })
    expect(pick.pools).toEqual({ [DEBATE_INTERVIEW]: 4, [PERSONAL_INTERVIEW]: 0 })
  })

  it('reports a null pool for a track with no usable room', () => {
    const pick = pickPlacement(both(), DEBATE_ROOMS, { a206: 1, a207: 2, a320: 3 })
    expect(pick.pools[DEBATE_INTERVIEW]).toBe(1)
    expect(pick.pools[PERSONAL_INTERVIEW]).toBe(null)
  })

  it('returns null when there is nowhere to go at all (the Auto-Assign Failed case)', () => {
    const rooms = [room('a206', 'A206', 'Debate', 'daniel'), room('a320', 'A320', 'Debate', 'daniel')]
    expect(pickPlacement(both({ interviewer_constraints: ['daniel'] }), rooms, { a206: 0, a320: 0 })).toBe(null)
  })

  it('returns null when no room of the needed type exists (the no-rooms case)', () => {
    expect(pickPlacement(personalOnly, DEBATE_ROOMS, {})).toBe(null)
    expect(pickPlacement(debateOnly, PERSONAL_ROOMS, {})).toBe(null)
    expect(pickPlacement(both(), [], {})).toBe(null)
  })

  it('returns null for a candidate with nothing left to do', () => {
    const done = both({ debate_interview_completed: true, personal_interview_completed: true })
    expect(pickPlacement(done, [...DEBATE_ROOMS, ...PERSONAL_ROOMS], {})).toBe(null)
  })
})

describe('the two end-to-end scenarios from the spec', () => {
  it('sends a both-interviews candidate to the emptiest room anywhere on the board', () => {
    const rooms = [...DEBATE_ROOMS, ...PERSONAL_ROOMS]
    const board = [
      candidate({ id: 'x', assigned_room: 'a206' }),
      candidate({ id: 'y', assigned_room: 'cl05' }),
      candidate({ id: 'z', assigned_room: 'peb30' }),
    ]
    const me = candidate({ id: 'me' })
    const pick = pickPlacement(me, rooms, roomLoads(board, me.id))
    // One person in a206, cl05 and peb30; a207 and a320 are empty. The two
    // empties are both debate rooms, so the debate tie-break is not even needed.
    expect(pick.task).toBe(DEBATE_INTERVIEW)
    expect(pick.room.room_name).toBe('A207')
  })

  it('falls through to the personal rooms once the debate is done', () => {
    const rooms = [...DEBATE_ROOMS, ...PERSONAL_ROOMS]
    const me = candidate({ id: 'me', debate_interview_completed: true, assigned_room: 'a206' })
    const board = [me, candidate({ id: 'y', assigned_room: 'cl05' })]
    const pick = pickPlacement(me, rooms, roomLoads(board, me.id))
    expect(pick.task).toBe(PERSONAL_INTERVIEW)
    expect(pick.room.room_name).toBe('PEB30')
  })
})

/* ------------------------------ the line ---------------------------------- */
/*
 * Once somebody has arrived, the line is their arrival time. The planned time
 * they were given stops mattering the minute they walk in: whoever is in the
 * building first is served first.
 */

const AWAITING = {
  id: 'c1',
  name: 'Dana',
  has_arrived: true,
  arrival_time: '2026-10-17T09:00:00Z',
  debate_interview_completed: false,
  personal_interview_completed: false,
  assigned_room: null,
  interviewer_constraints: [],
}

const waiting = (over = {}) => ({ ...AWAITING, ...over })

describe('isWaiting — who the dispatcher still has to place', () => {
  it('is somebody who has arrived and still owes an interview', () => {
    expect(isWaiting(waiting())).toBe(true)
    expect(isWaiting(waiting({ debate_interview_completed: true }))).toBe(true)
  })

  it('is nobody who has not arrived yet', () => {
    expect(isWaiting(waiting({ has_arrived: false }))).toBe(false)
  })

  it('is nobody who is already standing in a room', () => {
    // Someone in a room is being interviewed, not queuing. "Call next" must
    // never pull them out of it.
    expect(isWaiting(waiting({ assigned_room: 'a206' }))).toBe(false)
  })

  it('is nobody who has finished both interviews', () => {
    expect(isWaiting(waiting({ debate_interview_completed: true, personal_interview_completed: true }))).toBe(false)
  })

  it('copes with a missing row', () => {
    expect(isWaiting(null)).toBe(false)
    expect(isWaiting(undefined)).toBe(false)
  })
})

describe('waitingInLine — arrival order, and nothing else', () => {
  it('puts the earliest arrival at the head of the line', () => {
    const line = waitingInLine([
      waiting({ id: 'late', name: 'Late', arrival_time: '2026-10-17T10:00:00Z' }),
      waiting({ id: 'early', name: 'Early', arrival_time: '2026-10-17T09:00:00Z' }),
      waiting({ id: 'middle', name: 'Middle', arrival_time: '2026-10-17T09:30:00Z' }),
    ])
    expect(line.map((c) => c.name)).toEqual(['Early', 'Middle', 'Late'])
  })

  it('ignores the planned time completely — the early planner who arrives last goes last', () => {
    // This is the whole point. The first candidate *planned* 08:00; the second
    // planned 11:00. The second walked in first, so the second goes first.
    const line = waitingInLine([
      waiting({ id: 'planned-early', name: 'PlannedEarly', planned_time: '08:00', arrival_time: '2026-10-17T10:00:00Z' }),
      waiting({ id: 'planned-late', name: 'PlannedLate', planned_time: '11:00', arrival_time: '2026-10-17T09:00:00Z' }),
    ])
    expect(line.map((c) => c.name)).toEqual(['PlannedLate', 'PlannedEarly'])
  })

  it('puts a candidate with no arrival stamp at the back, never the front', () => {
    const line = waitingInLine([
      waiting({ id: 'unstamped', name: 'Unstamped', arrival_time: null }),
      waiting({ id: 'stamped', name: 'Stamped', arrival_time: '2026-10-17T09:00:00Z' }),
    ])
    expect(line.map((c) => c.name)).toEqual(['Stamped', 'Unstamped'])
  })

  it('keeps the incoming order for two identical arrival times', () => {
    const line = waitingInLine([
      waiting({ id: 'second', name: 'Second', arrival_time: '2026-10-17T09:00:00Z' }),
      waiting({ id: 'first', name: 'First', arrival_time: '2026-10-17T09:00:00Z' }),
    ])
    expect(line.map((c) => c.name)).toEqual(['Second', 'First'])
  })

  it('does not stall on two rows that both lack a stamp', () => {
    const line = waitingInLine([
      waiting({ id: 'a', name: 'A', arrival_time: null }),
      waiting({ id: 'b', name: 'B', arrival_time: null }),
    ])
    expect(line.map((c) => c.name)).toEqual(['A', 'B'])
  })

  it('leaves out the people already in a room, the ones who are done and the ones not here yet', () => {
    const line = waitingInLine([
      waiting({ id: 'in-room', name: 'InRoom', assigned_room: 'a206' }),
      waiting({ id: 'done', name: 'Done', debate_interview_completed: true, personal_interview_completed: true }),
      waiting({ id: 'not-arrived', name: 'NotArrived', has_arrived: false }),
      waiting({ id: 'waiting', name: 'Waiting' }),
    ])
    expect(line.map((c) => c.name)).toEqual(['Waiting'])
  })

  it('is empty when nobody is waiting', () => {
    expect(waitingInLine([])).toEqual([])
    expect(waitingInLine([waiting({ has_arrived: false })])).toEqual([])
  })
})

describe('queuePositions — the number shown on the card', () => {
  it('numbers the line from one, by arrival', () => {
    const positions = queuePositions([
      waiting({ id: 'c', name: 'C', arrival_time: '2026-10-17T10:00:00Z' }),
      waiting({ id: 'a', name: 'A', arrival_time: '2026-10-17T09:00:00Z' }),
      waiting({ id: 'b', name: 'B', arrival_time: '2026-10-17T09:30:00Z' }),
    ])
    expect(positions.get('a')).toBe(1)
    expect(positions.get('b')).toBe(2)
    expect(positions.get('c')).toBe(3)
  })

  it('gives no position to somebody who is not waiting', () => {
    const positions = queuePositions([
      waiting({ id: 'seated', name: 'Seated', assigned_room: 'a206' }),
      waiting({ id: 'here', name: 'Here' }),
    ])
    expect(positions.has('seated')).toBe(false)
    expect(positions.get('here')).toBe(1)
  })
})

