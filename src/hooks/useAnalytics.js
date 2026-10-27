/**
 * Loads the whole event ledger and every filed rubric, then hands them to the
 * pure maths in `lib/analytics.js`.
 *
 * On-demand rather than realtime, deliberately: this is a quiet management view
 * that a coordinator opens to answer "how are we doing", and a live subscription
 * would re-render four charts every time somebody is moved. The Refresh button
 * is the whole sync story.
 *
 * Paged by a thousand rows because PostgREST caps a response at the project's
 * `max-rows` (1000 by default) and silently returns only the first page — a
 * dashboard that quietly stops counting after 1,000 events is worse than one
 * that fails.
 */
import { useCallback, useEffect, useState } from 'react'
import { isConfigured, supabase } from '../lib/supabase'
import { createLogger } from '../lib/logger.js'
import { computeAnalytics } from '../lib/analytics.js'

const log = createLogger('analytics')

const PAGE_SIZE = 1000
const MAX_ROWS = 50_000

/** The table is missing until `npm run db:push` has been run once. */
export const MISSING_LEDGER = 'MISSING_LEDGER'

async function fetchAll(table, order) {
  const rows = []

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    let query = supabase.from(table).select('*')
    for (const column of order) query = query.order(column, { ascending: true })

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1)
    if (error) throw error

    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }

  return rows
}

export function useAnalytics() {
  const [analytics, setAnalytics] = useState(() => computeAnalytics())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!isConfigured) {
      setLoading(false)
      return
    }

    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError('')

    const done = log.time(`load ledger (${refresh ? 'refresh' : 'first'})`)

    try {
      const [events, evaluations] = await Promise.all([
        fetchAll('candidate_events', ['at', 'id']),
        fetchAll('evaluations', ['created_at']),
      ])

      setAnalytics(computeAnalytics({ events, evaluations }))
      setUpdatedAt(new Date())
      log.info('ledger loaded', {
        events: events.length,
        evaluations: evaluations.length,
      })
    } catch (cause) {
      // The ledger table may simply not exist yet — say so instead of showing a
      // generic "something went wrong" over a wall of zeroes.
      if (cause?.code === 'PGRST205') {
        setError(MISSING_LEDGER)
        log.warn('candidate_events is not installed', cause)
      } else {
        setError(cause?.message ?? 'Could not load the analytics data')
        log.error('analytics load failed', cause)
      }
    } finally {
      done()
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return {
    analytics,
    loading,
    refreshing,
    error,
    updatedAt,
    refresh: useCallback(() => load({ refresh: true }), [load]),
  }
}
