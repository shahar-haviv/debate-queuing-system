/**
 * The ledger loader.
 *
 * Two behaviours matter operationally and are easy to get wrong:
 *
 *   • PostgREST caps a page at 1,000 rows and does not say so. If the pagination
 *     loop stopped at the first page the dashboard would quietly under-count,
 *     which is worse than an error — so a 1,001-row ledger is asserted to come
 *     back whole.
 *   • Before `db:push` has run, `candidate_events` does not exist. The page has
 *     to distinguish that from a network failure, because the fix is different.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MISSING_LEDGER, useAnalytics } from '../../src/hooks/useAnalytics'

const db = vi.hoisted(() => ({
  rows: { candidate_events: [], evaluations: [] },
  calls: [],
  fail: null,
  reset() {
    db.rows = { candidate_events: [], evaluations: [] }
    db.calls = []
    db.fail = null
  },
}))

vi.mock('../../src/services/supabase', () => {
  const client = {
    from(table) {
      const query = {
        select() {
          return query
        },
        order() {
          return query
        },
        range(from, to) {
          db.calls.push({ table, from, to })
          if (db.fail) return Promise.resolve({ data: null, error: db.fail })
          return Promise.resolve({
            data: (db.rows[table] ?? []).slice(from, to + 1),
            error: null,
          })
        },
      }
      return query
    },
  }

  return {
    getSupabaseClient: () => client,
    createSupabaseClient: () => client,
    resetSupabaseClient: () => {},
  }
})

const ledgerEvent = (index) => ({
  id: index,
  at: new Date(Date.UTC(2026, 9, 26, 17, 0, 0) + index * 1000).toISOString(),
  event: 'arrived',
  candidate_id: `candidate-${index}`,
})

describe('useAnalytics', () => {
  it('loads both tables and computes the metrics', async () => {
    db.reset()
    db.rows.candidate_events = [
      {
        id: 1,
        at: '2026-10-26T17:00:00.000Z',
        event: 'arrived',
        candidate_id: 'c1',
        room_id: null,
        room_name: null,
      },
      {
        id: 2,
        at: '2026-10-26T17:05:00.000Z',
        event: 'assigned',
        candidate_id: 'c1',
        room_id: 'r1',
        room_name: 'CL05',
      },
      {
        id: 3,
        at: '2026-10-26T17:25:00.000Z',
        event: 'released',
        candidate_id: 'c1',
        room_id: 'r1',
        room_name: 'CL05',
      },
    ]
    db.rows.evaluations = []

    const { result } = renderHook(() => useAnalytics())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('')
    expect(result.current.analytics.totals).toMatchObject({
      processed: 1,
      averageRoomMinutes: 20,
      averageWaitMinutes: 5,
      busiestRoom: { roomName: 'CL05', candidates: 1 },
    })
    expect(result.current.updatedAt).toBeInstanceOf(Date)
  })

  it('pages past the 1,000-row response cap', async () => {
    db.reset()
    db.rows.candidate_events = Array.from({ length: 1001 }, (_, index) => ledgerEvent(index))

    const { result } = renderHook(() => useAnalytics())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.analytics.totals.events).toBe(1001)

    const eventPages = db.calls.filter((call) => call.table === 'candidate_events')
    expect(eventPages.map((call) => call.from)).toEqual([0, 1000])
  })

  it('reports a missing ledger as something to install, not a network failure', async () => {
    db.reset()
    db.fail = { code: 'PGRST205', message: 'Could not find the table public.candidate_events' }

    const { result } = renderHook(() => useAnalytics())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe(MISSING_LEDGER)
  })

  it('keeps any other failure readable', async () => {
    db.reset()
    db.fail = { code: '42501', message: 'permission denied' }

    const { result } = renderHook(() => useAnalytics())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBe('permission denied')
  })

  it('fetches the ledger again on a manual refresh', async () => {
    db.reset()

    const { result } = renderHook(() => useAnalytics())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const before = db.calls.filter((call) => call.table === 'candidate_events').length

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.refreshing).toBe(false)
    expect(db.calls.filter((call) => call.table === 'candidate_events').length).toBeGreaterThan(before)
  })
})
