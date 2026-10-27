/**
 * State synchronisation across the dashboard.
 *
 * The list specs render a fixed fixture and check the ordering. This file goes
 * one step further: `useCandidates` is replaced with a *live* store, so an edit
 * made through the real modal travels the real path —
 *
 *   modal → saveCandidate → (server echo) → patchLocal → re-render
 *
 * — and the assertions are about what an admin actually sees afterwards. That is
 * the only way to prove "the lists re-sort and the late alert recalculates
 * without a refresh", because it exercises the component's own render path
 * rather than a hand-built input array.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Admin from '../../src/pages/Admin'

/**
 * A tiny observable board, standing in for `useCandidates`.
 *
 * `useSyncExternalStore` means the component re-renders exactly the way it does
 * in production when a realtime row or an optimistic patch lands.
 */
const board = vi.hoisted(() => {
  const listeners = new Set()
  const state = {
    candidates: [],
    rooms: [],
    loading: false,
    error: null,
    version: 0,
    reloads: 0,
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
      state.reloads = 0
    },
  }
  return state
})

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'admin@example.com' }, signOut: async () => {} }),
}))

vi.mock('../../src/hooks/useCandidates', async () => {
  const { useSyncExternalStore } = await import('react')
  const find = (kind, id) =>
    (kind === 'rooms' ? board.rooms : board.candidates).find((row) => row.id === id) ?? { id }
  return {
    useCandidates: () => {
      useSyncExternalStore(board.subscribe, board.snapshot, board.snapshot)
      return {
        candidates: board.candidates,
        rooms: board.rooms,
        loading: board.loading,
        error: board.error,
        reload: async () => {
          board.reloads += 1
        },
        // Mirrors the real optimistic writers: mutate, then notify.
        patchLocal: (id, patch) => {
          board.candidates = board.candidates.map((row) => (row.id === id ? { ...row, ...patch } : row))
          board.push()
          return true
        },
        addLocal: (row) => {
          board.candidates = [...board.candidates, row]
          board.push()
        },
        removeLocal: (id) => {
          board.candidates = board.candidates.filter((row) => row.id !== id)
          board.push()
        },
        patchRoomLocal: (id, patch) => {
          board.rooms = board.rooms.map((row) => (row.id === id ? { ...row, ...patch } : row))
          board.push()
          return true
        },
        addRoomLocal: (row) => {
          board.rooms = [...board.rooms, row]
          board.push()
        },
        removeRoomLocal: (id) => {
          board.rooms = board.rooms.filter((row) => row.id !== id)
          board.push()
        },
      }
    },
  }
})

/**
 * The database, as the write paths use it. `update(...).eq(...).select().single()`
 * echoes the merged row — exactly what PostgREST returns — so the component's
 * post-write reconciliation (`patchLocal(id, data)`) is exercised too.
 */
vi.mock('../../src/services/supabase', () => {
  const merged = (patch) => ({ ...board.candidates.find((row) => row.id === patch.__id), ...patch })
  const selectAfterUpdate = (patch) => ({
    single: async () => ({ data: merged(patch), error: null }),
  })
  const client = {
    from: () => ({
      update: (patch) => ({
        eq: (column, value) => {
          patch.__id = value
          return { select: () => selectAfterUpdate(patch) }
        },
      }),
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        not: async () => ({ data: [], error: null }),
      }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
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

const base = (over = {}) => ({
  id: over.id ?? 'id',
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
  room_entry_time: null,
  interviewer_constraints: [],
  ...over,
})

const at = (h, m) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 17, h, m, 0))
}

beforeEach(() => {
  vi.useRealTimers()
  board.reset()
})

const renderAdmin = () =>
  render(
    <MemoryRouter>
      <Admin />
    </MemoryRouter>,
  )

const orderIn = (title) => {
  const section = screen.getByRole('heading', { name: title }).closest('section')
  return [...section.querySelectorAll('article')].map((article) => article.querySelector('p.font-semibold')?.textContent)
}

const cardFor = (name) => screen.getByText(name, { selector: 'p' }).closest('article')

const hasLateChip = (name) => within(cardFor(name)).queryByText('LATE') !== null

/** Drive the real Edit modal: open it, set the planned time, save. */
async function editPlannedTime(name, value) {
  fireEvent.click(within(cardFor(name)).getByRole('button', { name: 'Edit candidate' }))
  const field = screen.getByLabelText('Planned time')
  fireEvent.change(field, { target: { value } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  })
}

describe('editing a planned time re-sorts the board and re-reads the late rule', () => {
  it('moves the card and applies the red LATE flag, with no reload', async () => {
    at(12, 0)
    board.reset([base({ id: 'c1', name: 'Dana', planned_time: '11:50' }), base({ id: 'c2', name: 'Gil', planned_time: '11:55' })])

    renderAdmin()
    expect(orderIn('Not Arrived')).toEqual(['Dana', 'Gil'])
    expect(hasLateChip('Dana')).toBe(false)
    expect(hasLateChip('Gil')).toBe(false)

    // Push Dana's plan into the future: the list must re-sort, and she must
    // still not be late.
    await editPlannedTime('Dana', '12:30')

    expect(orderIn('Not Arrived')).toEqual(['Gil', 'Dana'])
    expect(hasLateChip('Dana')).toBe(false)
    expect(board.candidates.find((row) => row.id === 'c1').planned_time).toBe('12:30')
    expect(screen.getByText('Candidate updated.')).toBeInTheDocument()
    // The change came back through the board, not through a full refetch.
    expect(board.reloads).toBe(0)

    // Now pull Gil's plan back: he crosses the threshold and is flagged, and
    // the pin puts him at the top.
    await editPlannedTime('Gil', '11:00')

    expect(orderIn('Not Arrived')).toEqual(['Gil', 'Dana'])
    expect(hasLateChip('Gil')).toBe(true)
    expect(cardFor('Gil').className).toContain('border-destructive/40')
    expect(hasLateChip('Dana')).toBe(false)
    expect(board.reloads).toBe(0)
  })

  it('recalculates against the current clock, so a nudge forward never flags', async () => {
    at(12, 20)
    board.reset([base({ id: 'c1', name: 'Dana', planned_time: '11:00' })])

    renderAdmin()
    expect(hasLateChip('Dana')).toBe(true)

    // 12:20 planned at 12:05 is 15 minutes late — exactly at the limit, so the
    // flag must clear. This is the same boundary the clock test asserts, but
    // reached through an edit rather than through time passing.
    await editPlannedTime('Dana', '12:05')

    expect(hasLateChip('Dana')).toBe(false)
    expect(cardFor('Dana').className).not.toContain('border-destructive/40')

    // One minute later the same row is 16 minutes late and must flag again,
    // without another edit.
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(hasLateChip('Dana')).toBe(true)
  })

  it('leaves the other lists alone when only the plan changes', async () => {
    at(12, 0)
    board.reset([
      base({ id: 'c1', name: 'Dana', planned_time: '11:50' }),
      base({ id: 'c2', name: 'Gil', planned_time: '09:00', has_arrived: true, arrival_time: '2026-10-17T08:00:00Z' }),
      base({
        id: 'c3',
        name: 'Noa',
        has_arrived: true,
        arrival_time: '2026-10-17T08:30:00Z',
        debate_interview_completed: true,
        personal_interview_completed: true,
      }),
    ])

    renderAdmin()
    await editPlannedTime('Dana', '10:00')

    expect(orderIn('Arrived')).toEqual(['Gil'])
    expect(orderIn('Finished')).toEqual(['Noa'])
  })
})

describe('arrival and completion keep the three lists and the rooms in step', () => {
  it('moves an arrival out of List A and into List B', async () => {
    at(12, 0)
    board.reset([base({ id: 'c1', name: 'Dana', planned_time: '11:50' })])

    renderAdmin()
    expect(orderIn('Not Arrived')).toEqual(['Dana'])

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Arrived'))
    })

    expect(orderIn('Not Arrived')).toEqual([])
    expect(orderIn('Arrived')).toEqual(['Dana'])
    expect(board.reloads).toBe(0)
  })

  it('frees the room queue the moment the last interview is ticked', async () => {
    at(12, 0)
    board.reset(
      [
        base({
          id: 'c1',
          name: 'Dana',
          has_arrived: true,
          arrival_time: '2026-10-17T09:00:00Z',
          assigned_room: 'r1',
          current_task_assignment: 'Personal Interview',
          room_entry_time: '2026-10-17T11:45:00Z',
          debate_interview_completed: true,
        }),
      ],
      [{ id: 'r1', room_name: 'A206', room_type: 'Debate', interviewers: [] }],
    )

    const { container } = renderAdmin()
    expect(orderIn('Arrived')).toEqual(['Dana'])
    expect(container).toHaveTextContent('1 active')

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Personal done'))
    })

    // Finished, and the room is released locally at once — no reload, no wait
    // for the trigger's response.
    expect(orderIn('Arrived')).toEqual([])
    expect(orderIn('Finished')).toEqual(['Dana'])
    expect(container).toHaveTextContent('Empty queue')
    expect(container).not.toHaveTextContent('1 active')
    expect(board.candidates[0].assigned_room).toBeNull()
    expect(board.candidates[0].current_task_assignment).toBeNull()
    expect(board.candidates[0].room_entry_time).toBeNull()
  })

  it('puts an un-ticked arrival back to a clean blank across all three lists', async () => {
    at(12, 0)
    const seated = base({
      id: 'c1',
      name: 'Dana',
      has_arrived: true,
      arrival_time: '2026-10-17T09:00:00Z',
      assigned_room: 'r1',
      current_task_assignment: 'Debate Interview',
      room_entry_time: '2026-10-17T11:45:00Z',
      debate_interview_completed: true,
    })
    board.reset([seated], [{ id: 'r1', room_name: 'A206', room_type: 'Debate', interviewers: [] }])

    const { container } = renderAdmin()
    expect(container).toHaveTextContent('1 active')

    // The card asks for confirmation before a destructive reset.
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Arrived'))
    })
    confirm.mockRestore()

    expect(orderIn('Not Arrived')).toEqual(['Dana'])
    expect(orderIn('Arrived')).toEqual([])
    expect(container).toHaveTextContent('Empty queue')
    const row = board.candidates[0]
    expect(row.has_arrived).toBe(false)
    expect(row.assigned_room).toBeNull()
    expect(row.room_entry_time).toBeNull()
    expect(row.debate_interview_completed).toBe(false)
  })
})
