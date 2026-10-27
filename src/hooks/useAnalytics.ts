/**
 * Loads the whole event ledger and every filed rubric, then hands them to the
 * pure maths in `domain/analytics`.
 *
 * On-demand rather than realtime, deliberately: this is a quiet management view
 * that a coordinator opens to answer "how are we doing", and a live subscription
 * would re-render four charts every time somebody is moved. The Refresh button
 * is the whole sync story.
 *
 * Paging lives in the service (`LedgerRepository`), because PostgREST silently
 * caps a response at 1,000 rows - a dashboard that quietly stops counting is
 * worse than one that fails.
 */
import { useCallback, useEffect, useState } from 'react'
import type { AnalyticsSummary } from '../core/types'
import { createLogger } from '../core/logger'
import { useServices } from '../services/container'
import type { LedgerRepository } from '../services/database'
import { computeAnalytics } from '../domain/analytics'

const log = createLogger('analytics')

/** The table is missing until `bun run db:push` has been run once. */
export const MISSING_LEDGER = 'MISSING_LEDGER'
const MISSING_TABLE = 'PGRST205'

export interface AnalyticsState {
  analytics: AnalyticsSummary
  loading: boolean
  refreshing: boolean
  error: string
  updatedAt: Date | null
  refresh: () => Promise<void>
}

export function useAnalytics(ledgerOverride?: LedgerRepository): AnalyticsState {
  const services = useServices()
  const ledger = ledgerOverride ?? services.ledger

  const [analytics, setAnalytics] = useState<AnalyticsSummary>(() => computeAnalytics())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(
    async ({ refresh = false } = {}) => {
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError('')

      const done = log.time(`load ledger (${refresh ? 'refresh' : 'first'})`)

      try {
        const { events, evaluations } = await ledger.load()
        setAnalytics(computeAnalytics({ events, evaluations }))
        setUpdatedAt(new Date())
        log.info('ledger loaded', { events: events.length, evaluations: evaluations.length })
      } catch (cause) {
        // The ledger may simply not exist yet - say so instead of showing a
        // generic "something went wrong" over a wall of zeroes.
        const code = (cause as { code?: string } | null)?.code
        if (code === MISSING_TABLE) {
          setError(MISSING_LEDGER)
          log.warn('candidate_events is not installed', { cause })
        } else {
          setError(cause instanceof Error ? cause.message : 'Could not load the analytics data')
          log.error('analytics load failed', { cause })
        }
      } finally {
        done()
        setLoading(false)
        setRefreshing(false)
      }
    },
    [ledger],
  )

  useEffect(() => {
    void load()
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
