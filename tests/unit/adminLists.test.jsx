/**
 * The dashboard's three lists, driven directly through the component.
 *
 * `useCandidates` is replaced with a fixture so the sorting and the late-alert
 * can be driven deterministically, and the system clock is faked so the
 * "14:59 vs 15:01" boundary is a real assertion rather than a race with the
 * machine's own clock.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Admin from '../../src/pages/Admin.jsx'

const board = vi.hoisted(() => ({ candidates: [], rooms: [], loading: false, error: null }))

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'admin@example.com' }, signOut: async () => {} }),
}))

vi.mock('../../src/hooks/useCandidates', () => ({
  useCandidates: () => ({
    candidates: board.candidates,
    rooms: board.rooms,
    loading: board.loading,
    error: board.error,
    reload: async () => {},
    patchLocal: () => true,
    addLocal: () => {},
    removeLocal: () => {},
    patchRoomLocal: () => true,
    addRoomLocal: () => {},
    removeRoomLocal: () => {},
  }),
}))

vi.mock('../../src/lib/supabase', () => ({
  isConfigured: true,
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel }
      return channel
    },
    removeChannel: () => {},
  },
}))

/* ------------------------------- fixtures -------------------------------- */

const base = (over = {}) => ({
  id: over.name ?? 'id',
  name: 'X',
  serial_number: null,
  phone_number: null,
  planned_time: null,
  arrival_time: null,
  has_arrived: false,
  debate_interview_completed: false,
  personal_interview_completed: false,
  assigned_room: null,
  current_task_assignment: null,
  interviewer_constraints: [],
  ...over,
})

const waiting = (name, planned_time) => base({ name, planned_time })
const arrived = (name, arrival_time) => base({ name, arrival_time, has_arrived: true })
const done = (name) =>
  base({ name, has_arrived: true, debate_interview_completed: true, personal_interview_completed: true })

const renderAdmin = () => render(
  <MemoryRouter>
    <Admin />
  </MemoryRouter>,
)

/** The candidate names in a column, in the order the column renders them. */
const orderIn = (title) => {
  const section = screen.getByRole('heading', { name: title }).closest('section')
  return [...section.querySelectorAll('article')].map((article) => {
    const label = article.querySelector('p.font-semibold')
    return label ? label.textContent : '?'
  })
}

const cardFor = (name) => {
  const label = screen.getByText(name, { selector: 'p' })
  return label.closest('article')
}

const at = (h, m) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 17, h, m, 0))
}

/* --------------------------- List A — Not Arrived ------------------------- */

describe('List A — Not Arrived', () => {
  it('sorts by planned time, earliest first, whatever order the rows arrive in', () => {
    at(8, 0)
    board.candidates = [waiting('Carol', '11:00'), waiting('Alice', '09:00'), waiting('Bob', '10:00')]
    renderAdmin()

    expect(orderIn('Not Arrived')).toEqual(['Alice', 'Bob', 'Carol'])
  })

  it('flags exactly the candidates more than 15 minutes late, and tints their card', () => {
    at(12, 0)
    board.candidates = [waiting('On time', '12:00'), waiting('Ten late', '11:50'), waiting('Sixteen late', '11:44')]
    renderAdmin()

    expect(orderIn('Not Arrived')).toEqual(['Sixteen late', 'Ten late', 'On time'])
    expect(cardFor('Sixteen late').className).toContain('border-destructive/40')
    expect(cardFor('Sixteen late')).toHaveTextContent('LATE')
    expect(cardFor('Ten late').className).not.toContain('border-destructive/40')
    expect(cardFor('Ten late')).not.toHaveTextContent('LATE')
  })

  it('keeps an unplanned candidate at the bottom rather than at the top', () => {
    at(8, 0)
    board.candidates = [waiting('No time', null), waiting('Early', '09:00')]
    renderAdmin()

    expect(orderIn('Not Arrived')).toEqual(['Early', 'No time'])
  })

  it('keeps a stable order for two candidates with the identical planned time', () => {
    at(8, 0)
    board.candidates = [waiting('First', '09:30'), waiting('Second', '09:30')]
    renderAdmin()

    expect(orderIn('Not Arrived')).toEqual(['First', 'Second'])
    expect(orderIn('Not Arrived')).toHaveLength(2)
  })

  it('preserves the incoming order for a tie, whichever way round the rows arrive', () => {
    // The tie-break is "the order the rows came back in" (a stable sort, which
    // is the order realtime/the initial fetch delivered). Flipping the input
    // must flip the output — a sort that merely happens to leave a fixture
    // alone is not the same thing.
    at(8, 0)
    board.candidates = [waiting('Second', '09:30'), waiting('First', '09:30')]
    renderAdmin()

    expect(orderIn('Not Arrived')).toEqual(['Second', 'First'])
  })

  it('keeps the incoming order for a tie between two late candidates as well', () => {
    // Both take the late branch, so the tie is decided by the planned-time
    // comparison alone — which is 0, so stability decides again.
    at(12, 0)
    board.candidates = [waiting('Zed', '11:00'), waiting('Abe', '11:00')]
    renderAdmin()

    expect(orderIn('Not Arrived')).toEqual(['Zed', 'Abe'])
    expect(cardFor('Zed')).toHaveTextContent('LATE')
    expect(cardFor('Abe')).toHaveTextContent('LATE')
  })

  it('never flags a candidate with no planned time, however late the board runs', () => {
    at(23, 30)
    board.candidates = [waiting('No plan', null), waiting('Very late', '09:00')]
    renderAdmin()

    expect(orderIn('Not Arrived')).toEqual(['Very late', 'No plan'])
    expect(cardFor('No plan')).not.toHaveTextContent('LATE')
    expect(cardFor('Very late')).toHaveTextContent('LATE')
  })

  it('reacts to the clock crossing the threshold, without a reload', () => {
    at(14, 59)
    // 14:44 is exactly 15 minutes before 14:59 — not yet late.
    board.candidates = [waiting('Borderline', '14:44')]
    renderAdmin()

    expect(cardFor('Borderline')).not.toHaveTextContent('LATE')

    act(() => {
      vi.advanceTimersByTime(30_000) // 15:00 — still exactly 15 minutes late
    })
    expect(cardFor('Borderline')).not.toHaveTextContent('LATE')

    act(() => {
      vi.advanceTimersByTime(30_000) // 15:01 — now past the threshold
    })
    expect(cardFor('Borderline')).toHaveTextContent('LATE')
    expect(cardFor('Borderline').className).toContain('border-destructive/40')
  })

  it('re-sorts when a candidate arrives and lands in List B instead', () => {
    at(8, 0)
    board.candidates = [waiting('Alice', '09:00'), waiting('Bob', '10:00'), arrived('Carol', '2026-10-17T08:30:00Z')]
    renderAdmin()

    expect(orderIn('Not Arrived')).toEqual(['Alice', 'Bob'])
  })
})

/* ----------------------------- List B — Arrived --------------------------- */

describe('List B — Arrived / In Progress', () => {
  it('sorts by arrival time, oldest first', () => {
    at(12, 0)
    board.candidates = [
      arrived('Late arrival', '2026-10-17T10:00:00Z'),
      arrived('First arrival', '2026-10-17T09:00:00Z'),
      arrived('Middle arrival', '2026-10-17T09:30:00Z'),
    ]
    renderAdmin()

    expect(orderIn('Arrived')).toEqual(['First arrival', 'Middle arrival', 'Late arrival'])
  })

  it('holds everyone who has arrived but not finished, room or no room', () => {
    at(12, 0)
    board.candidates = [arrived('Waiting', '2026-10-17T09:00:00Z'), arrived('Seated', '2026-10-17T09:10:00Z')]
    board.candidates[1].assigned_room = 'a206'
    board.candidates[1].current_task_assignment = 'Debate Interview'
    renderAdmin()

    expect(orderIn('Arrived')).toEqual(['Waiting', 'Seated'])
  })

  it('keeps the incoming order for two identical arrival times', () => {
    at(12, 0)
    board.candidates = [arrived('Second', '2026-10-17T09:00:00Z'), arrived('First', '2026-10-17T09:00:00Z')]
    renderAdmin()

    expect(orderIn('Arrived')).toEqual(['Second', 'First'])
  })

  it('drops a candidate the moment both interviews are done', () => {
    at(12, 0)
    board.candidates = [arrived('Still going', '2026-10-17T09:00:00Z'), done('Finished')]
    renderAdmin()

    expect(orderIn('Arrived')).toEqual(['Still going'])
    expect(orderIn('Finished')).toEqual(['Finished'])
  })
})

/* ----------------------------- List C — Finished -------------------------- */

describe('List C — Finished', () => {
  it('sorts alphabetically', () => {
    at(12, 0)
    board.candidates = [done('Zoe'), done('Adam'), done('Mona')]
    renderAdmin()

    expect(orderIn('Finished')).toEqual(['Adam', 'Mona', 'Zoe'])
  })

  it('sorts Hebrew names alphabetically too', () => {
    at(12, 0)
    board.candidates = [done('בני'), done('אבי'), done('גדי')]
    renderAdmin()

    expect(orderIn('Finished')).toEqual(['אבי', 'בני', 'גדי'])
  })

  it('ignores arrival order entirely', () => {
    at(12, 0)
    const a = done('Bea')
    a.arrival_time = '2026-10-17T11:00:00Z'
    const b = done('Ami')
    b.arrival_time = '2026-10-17T08:00:00Z'
    board.candidates = [a, b]
    renderAdmin()

    expect(orderIn('Finished')).toEqual(['Ami', 'Bea'])
  })

  it('keeps both rows for two candidates who share a name', () => {
    // Identical sort keys make `localeCompare` return 0, so the stable sort has
    // to keep both — a naive "sort unique by name" would silently lose one.
    // Distinct ids, because two real rows can share a name but never an id.
    at(12, 0)
    const first = done('Noa')
    first.id = 'n1'
    const second = done('Noa')
    second.id = 'n2'
    board.candidates = [first, second]
    renderAdmin()

    expect(orderIn('Finished')).toEqual(['Noa', 'Noa'])
    expect(screen.getAllByText('Noa')).toHaveLength(2)
  })
})

/* ------------------------------- structure -------------------------------- */

describe('the board as a whole', () => {
  it('places each candidate in exactly one list', () => {
    at(12, 0)
    board.candidates = [
      waiting('Not here yet', '09:00'),
      arrived('In a room', '2026-10-17T09:00:00Z'),
      done('All done'),
    ]
    renderAdmin()

    expect(orderIn('Not Arrived')).toEqual(['Not here yet'])
    expect(orderIn('Arrived')).toEqual(['In a room'])
    expect(orderIn('Finished')).toEqual(['All done'])
  })

  it('shows the live counts in each column header', () => {
    at(12, 0)
    board.candidates = [waiting('A', '09:00'), waiting('B', '09:10'), arrived('C', '2026-10-17T09:00:00Z')]
    renderAdmin()

    const header = (title) => screen.getByRole('heading', { name: title }).closest('section')
    expect(header('Not Arrived')).toHaveTextContent('2')
    expect(header('Arrived')).toHaveTextContent('1')
  })

  it('places every late candidate above every on-time one', () => {
    // The column promises "late pinned to top". Note this is belt-and-braces:
    // "late" means planned time < now-15, so a late candidate necessarily has an
    // earlier planned time than every on-time one, and the time ordering alone
    // would already float them. The invariant is still worth asserting, because
    // it is what the header claims and what a future change to the threshold or
    // the sort key could quietly break.
    at(12, 0)
    board.candidates = [
      waiting('Not late', '11:50'),
      waiting('Late sixteen', '11:44'),
      waiting('On the dot', '12:00'),
      waiting('Late two hours', '10:00'),
    ]
    renderAdmin()

    const order = orderIn('Not Arrived')
    const isLate = order.map((name) => cardFor(name).textContent.includes('LATE'))
    const lastLate = isLate.lastIndexOf(true)
    const firstOnTime = isLate.indexOf(false)

    expect(order).toEqual(['Late two hours', 'Late sixteen', 'Not late', 'On the dot'])
    expect(lastLate).toBeGreaterThanOrEqual(0)
    expect(lastLate).toBeLessThan(firstOnTime)
  })

  it('explains an empty board instead of showing nothing', () => {
    at(12, 0)
    board.candidates = []
    renderAdmin()

    expect(screen.getByText('No candidates waiting to check in.')).toBeInTheDocument()
    expect(screen.getByText('No interviews in progress.')).toBeInTheDocument()
    expect(screen.getByText('No candidates finished yet.')).toBeInTheDocument()
  })

  it('filters every list through the search box', async () => {
    vi.useRealTimers()
    board.candidates = [waiting('Alice', '09:00'), waiting('Bob', '09:10'), done('Alicia')]
    renderAdmin()

    expect(orderIn('Not Arrived')).toEqual(['Alice', 'Bob'])

    await userEvent.type(screen.getByPlaceholderText('Search name…'), 'Ali')
    expect(orderIn('Not Arrived')).toEqual(['Alice'])
    expect(orderIn('Finished')).toEqual(['Alicia'])

    await userEvent.clear(screen.getByPlaceholderText('Search name…'))
    expect(orderIn('Not Arrived')).toEqual(['Alice', 'Bob'])
  })

  it('filters by serial number and phone number as well as name', async () => {
    vi.useRealTimers()
    const alice = waiting('Alice', '09:00')
    alice.serial_number = '77'
    const bob = waiting('Bob', '09:10')
    bob.phone_number = '0501234567'
    board.candidates = [alice, bob]
    renderAdmin()

    await userEvent.type(screen.getByPlaceholderText('Search name…'), '77')
    expect(orderIn('Not Arrived')).toEqual(['Alice'])

    await userEvent.clear(screen.getByPlaceholderText('Search name…'))
    await userEvent.type(screen.getByPlaceholderText('Search name…'), '0501')
    expect(orderIn('Not Arrived')).toEqual(['Bob'])
  })
})
