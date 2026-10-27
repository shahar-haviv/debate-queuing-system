/**
 * Auto-Assign, driven through the real wand button.
 *
 * `autoAssign.test.js` proves the decision itself. What was never tested is the
 * wiring around it in `Admin.jsx`: that the button reads the queue from the
 * database, that the two dead ends ("no such room" vs "every such room is
 * restricted") produce *different* messages, and that a successful pick lands on
 * the board with the toast naming the room.
 *
 * So the board is a live store and the "database" answers the two queries the
 * click really makes — the seated-candidate read and the update — which makes
 * this an integration test of the dispatch path rather than of a pure function.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Admin from '../../src/pages/Admin'

const board = vi.hoisted(() => {
  const listeners = new Set()
  const state = {
    candidates: [],
    rooms: [],
    loading: false,
    error: null,
    version: 0,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    snapshot() {
      return state.version
    },
    push() {
      state.version += 1
      listeners.forEach((fn) => fn())
    },
    reset(candidates = [], rooms = []) {
      state.candidates = candidates
      state.rooms = rooms
    },
  }
  return state
})

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'admin@example.com' }, signOut: async () => {} }),
}))

vi.mock('../../src/hooks/useCandidates', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useCandidates: () => {
      useSyncExternalStore(board.subscribe, board.snapshot, board.snapshot)
      return {
        candidates: board.candidates,
        rooms: board.rooms,
        loading: board.loading,
        error: board.error,
        reload: async () => {},
        patchLocal: (id, patch) => {
          board.candidates = board.candidates.map((row) => (row.id === id ? { ...row, ...patch } : row))
          board.push()
          return true
        },
        addLocal: () => {},
        removeLocal: () => {},
        patchRoomLocal: () => true,
        addRoomLocal: () => {},
        removeRoomLocal: () => {},
      }
    },
  }
})

/**
 * A tiny PostgREST stand-in.
 *
 * `from('candidates').select('id, assigned_room').not('assigned_room','is',null)`
 * is the queue read; `from('candidates').update(patch).eq('id',id).select().single()`
 * echoes the merged row. Both are what the click actually issues.
 */
vi.mock('../../src/services/supabase', () => {
  const query = (state) => {
    const settle = () => {
      if (state.op === 'update') {
        const row = board.candidates.find((candidate) => candidate.id === state.id) ?? { id: state.id }
        return { data: { ...row, ...state.patch }, error: null }
      }
      if (state.op === 'insert') return { data: state.values, error: null }
      if (state.op === 'delete') return { data: null, error: null }
      if (state.id) {
        const row = board.candidates.find((candidate) => candidate.id === state.id) ?? null
        return { data: state.single ? row : row ? [row] : [], error: null }
      }
      // The un-filtered read: who is sitting in a room right now.
      return {
        data: board.candidates
          .filter((candidate) => candidate.assigned_room)
          .map((candidate) => ({ id: candidate.id, assigned_room: candidate.assigned_room })),
        error: null,
      }
    }
    const api = {
      select: () => api,
      eq: (column, value) => {
        if (column === 'id') state.id = value
        return api
      },
      not: () => api,
      order: () => api,
      limit: () => api,
      single: () => {
        state.single = true
        return Promise.resolve(settle())
      },
      maybeSingle: () => {
        state.single = true
        return Promise.resolve(settle())
      },
      then: (resolve, reject) => Promise.resolve(settle()).then(resolve, reject),
    }
    return api
  }

  const client = {
    from: () => ({
      select: () => query({ op: 'select' }),
      update: (patch) => query({ op: 'update', patch }),
      insert: (values) => query({ op: 'insert', values }),
      delete: () => query({ op: 'delete' }),
    }),
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel }
      return channel
    },
    removeChannel: () => {},
  }

  return {
    getSupabaseClient: () => client,
    createSupabaseClient: () => client,
    resetSupabaseClient: () => {},
  }
})

/* ------------------------------- fixtures -------------------------------- */

const room = (id, room_name, over = {}) => ({ id, room_name, room_type: 'Debate', interviewers: [], ...over })

const person = (id, name, over = {}) => ({
  id,
  name,
  serial_number: null,
  phone_number: null,
  planned_time: '09:00',
  arrival_time: '2026-10-17T09:00:00Z',
  has_arrived: true,
  debate_interview_completed: false,
  personal_interview_completed: false,
  assigned_room: null,
  current_task_assignment: null,
  room_entry_time: null,
  interviewer_constraints: [],
  ...over,
})

/** Three debate rooms, tenanted so the loads are A206:1, A207:0, A320:2. */
const LOP_SIDED_BOARD = () => [
  room('a206', 'A206'),
  room('a207', 'A207'),
  room('a320', 'A320'),
]

const renderAdmin = () =>
  render(
    <MemoryRouter>
      <Admin />
    </MemoryRouter>,
  )

const cardFor = (name) => screen.getByText(name, { selector: 'p' }).closest('article')

const wandFor = (name) => within(cardFor(name)).getByRole('button', { name: /Auto-assign/ })

async function pressWand(name) {
  await act(async () => {
    fireEvent.click(wandFor(name))
  })
}

const nextButton = () => screen.getByRole('button', { name: /Call next/ })

async function pressCallNext() {
  await act(async () => {
    fireEvent.click(nextButton())
  })
}

/** The room the card is showing, read off the (disabled-until-arrived) select. */
const assignedRoom = (name) => within(cardFor(name)).getByLabelText('Assigned room').value

beforeEach(() => {
  vi.useRealTimers()
  board.reset()
})

describe('Auto-Assign — the load-balancing decision, end to end', () => {
  it('sends the candidate to the empty room, not the busy ones', async () => {
    board.reset(
      [
        person('x', 'Tenant One', { assigned_room: 'a206' }),
        person('y', 'Tenant Two', { assigned_room: 'a320' }),
        person('z', 'Tenant Three', { assigned_room: 'a320' }),
        person('me', 'Dana', { assigned_room: null }),
      ],
      LOP_SIDED_BOARD(),
    )
    renderAdmin()

    await pressWand('Dana')

    expect(screen.getByText('Candidate assigned to A207 for Debate Interview.')).toBeInTheDocument()
    expect(board.candidates.find((row) => row.id === 'me').assigned_room).toBe('a207')
    expect(assignedRoom('Dana')).toBe('a207')
  })

  it('breaks a three-way tie on the room name, so the same board always agrees', async () => {
    board.reset(
      [
        person('x', 'Tenant One', { assigned_room: 'a206' }),
        person('y', 'Tenant Two', { assigned_room: 'a207' }),
        person('z', 'Tenant Three', { assigned_room: 'a320' }),
        person('me', 'Dana'),
      ],
      LOP_SIDED_BOARD(),
    )
    renderAdmin()

    await pressWand('Dana')

    expect(screen.getByText('Candidate assigned to A206 for Debate Interview.')).toBeInTheDocument()
  })

  it('does not count the candidate who is being moved, so their own room can win', async () => {
    // Dana is already in CL05, so CL05 holds only her (load 0 from her side) and
    // ties with the empty SL103 — the name tie-break keeps it at CL05. Without
    // the exclusion CL05 would read as 1 and SL103 would win instead.
    board.reset(
      [
        person('me', 'Dana', { assigned_room: 'cl05', current_task_assignment: 'Personal Interview', debate_interview_completed: true }),
        person('x', 'Tenant', { assigned_room: 'sl101' }),
      ],
      [
        room('cl05', 'CL05', { room_type: 'Personal' }),
        room('sl101', 'SL101', { room_type: 'Personal' }),
        room('sl103', 'SL103', { room_type: 'Personal' }),
      ],
    )
    renderAdmin()

    await pressWand('Dana')

    expect(screen.getByText('Candidate assigned to CL05 for Personal Interview.')).toBeInTheDocument()
    expect(board.candidates.find((row) => row.id === 'me').assigned_room).toBe('cl05')
  })

  it('routes to the personal rooms once the debate is done', async () => {
    board.reset(
      [
        person('me', 'Dana', { debate_interview_completed: true }),
        person('x', 'Tenant', { assigned_room: 'cl05' }),
      ],
      [
        room('a206', 'A206'),
        room('cl05', 'CL05', { room_type: 'Personal' }),
        room('sl101', 'SL101', { room_type: 'Personal' }),
      ],
    )
    renderAdmin()

    await pressWand('Dana')

    expect(screen.getByText('Candidate assigned to SL101 for Personal Interview.')).toBeInTheDocument()
  })
})

/*
 * The bottleneck regression.
 *
 * The old rule sent every both-interviews candidate to Debate, so a debate queue
 * could grow to forty while personal rooms stood empty. A candidate who owes both
 * interviews must now be routed to whichever track is actually idle.
 */
describe('Auto-Assign — global throughput, not blind debate priority', () => {
  const MIXED_BOARD = () => [
    room('a206', 'A206'),
    room('a207', 'A207'),
    room('cl05', 'CL05', { room_type: 'Personal' }),
    room('peb30', 'PEB30', { room_type: 'Personal' }),
  ]

  it('sends a both-interviews candidate to an empty personal room rather than a long debate queue', async () => {
    board.reset(
      [
        person('t1', 'Tenant One', { assigned_room: 'a206' }),
        person('t2', 'Tenant Two', { assigned_room: 'a206' }),
        person('t3', 'Tenant Three', { assigned_room: 'a207' }),
        person('me', 'Dana'),
      ],
      MIXED_BOARD(),
    )
    renderAdmin()

    await pressWand('Dana')

    // The old behaviour would have been "A206/A207 for Debate Interview".
    expect(screen.getByText('Candidate assigned to CL05 for Personal Interview.')).toBeInTheDocument()
    expect(board.candidates.find((row) => row.id === 'me').assigned_room).toBe('cl05')
    expect(board.candidates.find((row) => row.id === 'me').current_task_assignment).toBe('Personal Interview')
  })

  it('still prefers the debate when the two tracks are equally busy', async () => {
    board.reset(
      [
        person('t1', 'Tenant One', { assigned_room: 'a206' }),
        person('t2', 'Tenant Two', { assigned_room: 'cl05' }),
        person('me', 'Dana'),
      ],
      MIXED_BOARD(),
    )
    renderAdmin()

    // a207 and peb30 are both empty — the tie-break keeps it on the debate track.
    await pressWand('Dana')

    expect(board.candidates.find((row) => row.id === 'me').assigned_room).toBe('a207')
    expect(screen.getByText('Candidate assigned to A207 for Debate Interview.')).toBeInTheDocument()
  })

  it('sends a forced candidate down their own track even when the other track is idle', async () => {
    board.reset(
      [
        person('t1', 'Tenant One', { assigned_room: 'cl05' }),
        person('me', 'Dana', { debate_interview_completed: true }),
      ],
      MIXED_BOARD(),
    )
    renderAdmin()

    // Debate is completely empty, but Dana's debate is finished: personal it is.
    await pressWand('Dana')

    expect(screen.getByText('Candidate assigned to PEB30 for Personal Interview.')).toBeInTheDocument()
  })

  it('routes Call next the same way, so the line drains through the idle track', async () => {
    board.reset(
      [
        person('t1', 'Tenant One', { assigned_room: 'a206' }),
        person('t2', 'Tenant Two', { assigned_room: 'a207' }),
        person('me', 'Dana', { arrival_time: '2026-10-17T08:00:00Z' }),
      ],
      MIXED_BOARD(),
    )
    renderAdmin()

    await pressCallNext()

    expect(board.candidates.find((row) => row.id === 'me').assigned_room).toBe('cl05')
    expect(board.candidates.find((row) => row.id === 'me').current_task_assignment).toBe('Personal Interview')
    expect(screen.getByText("Dana — you're up. Assigned to CL05 for Personal Interview.")).toBeInTheDocument()
  })
})

describe('Auto-Assign — the dead ends, and the two different messages', () => {
  it('says there is no room of the needed type when the track they are forced onto has none', async () => {
    // Personal rooms only, and Dana's debate is behind her — so Personal is the
    // only path and there is nothing to walk it on.
    board.reset([person('me', 'Dana', { debate_interview_completed: true })], [room('a206', 'A206')])
    renderAdmin()

    await pressWand('Dana')

    expect(screen.getByText('No Personal or General room is available for a Personal Interview.')).toBeInTheDocument()
    // Nothing was assigned, so the card is untouched.
    expect(board.candidates.find((row) => row.id === 'me').assigned_room).toBeNull()
  })

  it('names both tracks when neither of them has a room at all', async () => {
    board.reset([person('me', 'Dana')], [])
    renderAdmin()

    await pressWand('Dana')

    expect(screen.getByText('No room is available for a Debate or Personal interview.')).toBeInTheDocument()
    expect(board.candidates.find((row) => row.id === 'me').assigned_room).toBeNull()
  })

  it('says the rooms are all restricted, not that they are missing', async () => {
    board.reset(
      [person('me', 'Dana', { interviewer_constraints: ['daniel'] })],
      [room('a206', 'A206', { interviewers: [{ name: 'daniel', phone: '123' }] }),
       room('a207', 'A207', { interviewers: [{ name: 'daniel', phone: null }] })],
    )
    renderAdmin()

    await pressWand('Dana')

    expect(
      screen.getByText('Auto-Assign Failed: All applicable rooms have a restricted interviewer for this candidate.'),
    ).toBeInTheDocument()
    expect(board.candidates.find((row) => row.id === 'me').assigned_room).toBeNull()
  })

  it('still finds a room when only the panel member is restricted', async () => {
    board.reset(
      [person('me', 'Dana', { interviewer_constraints: ['daniel'] })],
      [
        room('a206', 'A206', { interviewers: [{ name: 'daniel', phone: null }, { name: 'Romi', phone: null }] }),
        room('a207', 'A207', { interviewers: [{ name: 'Yael', phone: null }] }),
      ],
    )
    renderAdmin()

    await pressWand('Dana')

    expect(screen.getByText('Candidate assigned to A207 for Debate Interview.')).toBeInTheDocument()
    expect(board.candidates.find((row) => row.id === 'me').assigned_room).toBe('a207')
  })

  it('refuses a General room that is staffed by a restricted interviewer', async () => {
    board.reset(
      [person('me', 'Dana', { interviewer_constraints: ['Jane Smith'] })],
      [room('g1', 'G1', { room_type: 'General', interviewers: [{ name: 'Jane Smith', phone: '123' }] })],
    )
    renderAdmin()

    await pressWand('Dana')

    expect(
      screen.getByText('Auto-Assign Failed: All applicable rooms have a restricted interviewer for this candidate.'),
    ).toBeInTheDocument()
  })
})

/* ----------------------------- the line ----------------------------------- */
/*
 * The dispatcher's own queue: whoever arrived first is served first. Planned
 * time has no say — the moment somebody walks in, their arrival is their time.
 */

const lineRooms = () => [
  room('a206', 'A206'),
  room('a207', 'A207'),
  room('a320', 'A320'),
]

describe('Call next — arrival order is the dispatch order', () => {
  it('sends the earliest arrival, not the first row on the board', async () => {
    board.reset(
      [
        person('later', 'Later', { arrival_time: '2026-10-17T10:00:00Z' }),
        person('earlier', 'Earlier', { arrival_time: '2026-10-17T09:00:00Z' }),
      ],
      lineRooms(),
    )
    renderAdmin()

    await pressCallNext()

    expect(screen.getByText("Earlier — you're up. Assigned to A206 for Debate Interview.")).toBeInTheDocument()
    expect(board.candidates.find((row) => row.id === 'earlier').assigned_room).toBe('a206')
    expect(board.candidates.find((row) => row.id === 'later').assigned_room).toBeNull()
  })

  it('ignores the planned time entirely — the early planner who arrives last waits', async () => {
    board.reset(
      [
        person('planned-early', 'PlannedEarly', {
          planned_time: '08:00',
          arrival_time: '2026-10-17T10:00:00Z',
        }),
        person('planned-late', 'PlannedLate', {
          planned_time: '11:00',
          arrival_time: '2026-10-17T08:00:00Z',
        }),
      ],
      lineRooms(),
    )
    renderAdmin()

    // The card for the 11:00 plan is not even flagged late — planned time only
    // matters to the not-arrived list.
    await pressCallNext()

    expect(board.candidates.find((row) => row.id === 'planned-late').assigned_room).toBe('a206')
    expect(board.candidates.find((row) => row.id === 'planned-early').assigned_room).toBeNull()
  })

  it('numbers the line by arrival, whatever order the rows come in', async () => {
    board.reset(
      [
        person('c', 'Third', { arrival_time: '2026-10-17T10:00:00Z' }),
        person('a', 'First', { arrival_time: '2026-10-17T09:00:00Z' }),
        person('b', 'Second', { arrival_time: '2026-10-17T09:30:00Z' }),
      ],
      lineRooms(),
    )
    renderAdmin()

    expect(cardFor('First')).toHaveTextContent('1st in line')
    expect(cardFor('Second')).toHaveTextContent('2nd in line')
    expect(cardFor('Third')).toHaveTextContent('3rd in line')
  })

  it('names the next person on the button, and counts the rest', async () => {
    board.reset(
      [
        person('a', 'First', { arrival_time: '2026-10-17T09:00:00Z' }),
        person('b', 'Second', { arrival_time: '2026-10-17T09:30:00Z' }),
        person('c', 'Third', { arrival_time: '2026-10-17T10:00:00Z' }),
      ],
      lineRooms(),
    )
    renderAdmin()

    expect(nextButton()).toHaveTextContent('Call next — First')
    expect(nextButton()).toHaveTextContent('+2 waiting')
  })

  it('does not count somebody who is already in a room as waiting', async () => {
    board.reset(
      [
        person('seated', 'Seated', { assigned_room: 'a206', current_task_assignment: 'Debate Interview' }),
        person('here', 'Here', { arrival_time: '2026-10-17T09:00:00Z' }),
      ],
      lineRooms(),
    )
    renderAdmin()

    expect(nextButton()).toHaveTextContent('Call next — Here')
    expect(cardFor('Seated')).not.toHaveTextContent('in line')
  })

  it('disables itself and offers nothing when nobody is waiting', async () => {
    board.reset(
      [person('seated', 'Seated', { assigned_room: 'a206', current_task_assignment: 'Debate Interview' })],
      lineRooms(),
    )
    renderAdmin()

    const button = nextButton()
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Call next')
    expect(button.textContent).not.toContain('—')
  })
})

describe('Call next — strict FIFO, and the reasons it stops', () => {
  it('refuses to promote the second in line past a blocked head of line', async () => {
    // The head of the line is restricted from every Debate room; the person
    // behind them is fine. Arrival order must win, so we name the head and stop
    // rather than quietly sending somebody else.
    board.reset(
      [
        person('head', 'Head', { arrival_time: '2026-10-17T08:00:00Z', interviewer_constraints: ['daniel'] }),
        person('second', 'Second', { arrival_time: '2026-10-17T09:00:00Z' }),
      ],
      [
        room('a206', 'A206', { interviewers: [{ name: 'daniel', phone: null }] }),
        room('a207', 'A207', { interviewers: [{ name: 'daniel', phone: null }] }),
      ],
    )
    renderAdmin()

    await pressCallNext()

    expect(
      screen.getByText('Head is first in line, but every applicable room has a restricted interviewer for them.'),
    ).toBeInTheDocument()
    expect(board.candidates.find((row) => row.id === 'head').assigned_room).toBeNull()
    expect(board.candidates.find((row) => row.id === 'second').assigned_room).toBeNull()
  })

  it('explains a missing room type by naming the head of the line', async () => {
    // Head has finished their debate, so Personal is the only path — and the
    // board has no personal room to walk it on.
    board.reset(
      [person('head', 'Head', { arrival_time: '2026-10-17T08:00:00Z', debate_interview_completed: true })],
      [room('a206', 'A206')],
    )
    renderAdmin()

    await pressCallNext()

    expect(
      screen.getByText('Head is first in line, but no Personal or General room is available for a Personal Interview.'),
    ).toBeInTheDocument()
    expect(board.candidates.find((row) => row.id === 'head').assigned_room).toBeNull()
  })

  it('names both tracks when the board has no room at all', async () => {
    board.reset([person('head', 'Head', { arrival_time: '2026-10-17T08:00:00Z' })], [])
    renderAdmin()

    await pressCallNext()

    expect(
      screen.getByText('Head is first in line, but no room is available for a Debate or Personal interview.'),
    ).toBeInTheDocument()
    expect(board.candidates.find((row) => row.id === 'head').assigned_room).toBeNull()
  })

  it('still works the head of the line when somebody else is blocked further back', async () => {
    board.reset(
      [
        person('head', 'Head', { arrival_time: '2026-10-17T08:00:00Z' }),
        person('blocked', 'Blocked', { arrival_time: '2026-10-17T09:00:00Z', interviewer_constraints: ['daniel'] }),
      ],
      [
        room('a206', 'A206', { interviewers: [{ name: 'daniel', phone: null }] }),
        room('a207', 'A207'),
      ],
    )
    renderAdmin()

    await pressCallNext()

    // Head is unrestricted, so even the room staffed by "daniel" is fine for
    // them: A206 is empty and sorts first.
    expect(board.candidates.find((row) => row.id === 'head').assigned_room).toBe('a206')
    expect(board.candidates.find((row) => row.id === 'blocked').assigned_room).toBeNull()
  })
})

