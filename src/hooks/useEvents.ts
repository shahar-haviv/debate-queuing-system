/**
 * The Back Office hub's read model.
 *
 * Event cards need three things the queue never does: the event metadata, a
 * candidate count and a room count. The repository returns all three in one
 * query so opening the hub cannot fan out into one count request per card.
 */
import { useCallback, useEffect, useState } from 'react'
import type { EventPatch, EventSummary, QueueEvent } from '../core/types'
import { createLogger } from '../core/logger'
import { useServices } from '../services/container'

const log = createLogger('events')

export interface EventsState {
  events: EventSummary[]
  loading: boolean
  error: string
  reload: () => Promise<void>
  update: (id: string, patch: EventPatch) => Promise<QueueEvent>
}

export function useEvents(): EventsState {
  const { events: repo } = useServices()
  const [events, setEvents] = useState<EventSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await repo.listSummaries()
      setEvents(rows)
      setError('')
      log.info('event hub loaded', { events: rows.length })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load events.')
      log.error('event hub load failed', { cause })
    } finally {
      setLoading(false)
    }
  }, [repo])

  useEffect(() => {
    void reload()
  }, [reload])

  const update = useCallback(
    async (id: string, patch: EventPatch) => {
      const updated = await repo.update(id, patch)
      setEvents((prev) => prev.map((event) => (event.id === id ? { ...event, ...updated } : event)))
      log.info('event updated', { eventId: id, fields: Object.keys(patch) })
      return updated
    },
    [repo],
  )

  return { events, loading, error, reload, update }
}
