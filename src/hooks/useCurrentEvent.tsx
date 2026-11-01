/**
 * The globally scoped event the admin is currently working inside.
 *
 * The URL is the source of truth (`/admin/event/:id/...`); this provider turns
 * that id into the event record once, and every nested page reads it from
 * context. That removes the "which event?" prop drilling from the queue,
 * analytics, auto-assign and room panels without creating a second copy of the
 * event state in each of them.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useParams } from 'react-router-dom'
import type { QueueEvent } from '../core/types'
import { createLogger } from '../core/logger'
import { useServices } from '../services/container'

const log = createLogger('event-context')

export interface CurrentEventState {
  eventId: string
  event: QueueEvent | null
  loading: boolean
  error: string
  reload: () => Promise<void>
}

const CurrentEventContext = createContext<CurrentEventState | null>(null)

export function CurrentEventProvider({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>()
  const { events } = useServices()

  const [event, setEvent] = useState<QueueEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    if (!id) {
      setEvent(null)
      setError('No event is selected.')
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const next = await events.findById(id)
      if (!next) {
        setEvent(null)
        setError('Event not found. It may have been removed.')
        log.warn('event not found', { eventId: id })
      } else {
        setEvent(next)
        setError('')
        log.info('event selected', { eventId: next.id, name: next.name, status: next.status })
      }
    } catch (cause) {
      setEvent(null)
      setError(cause instanceof Error ? cause.message : 'Could not load the event.')
      log.error('event load failed', { eventId: id, cause })
    } finally {
      setLoading(false)
    }
  }, [events, id])

  useEffect(() => {
    setEvent(null)
    setError('')
    setLoading(true)
    void reload()
  }, [reload])

  const value = useMemo<CurrentEventState>(
    () => ({ eventId: id ?? '', event, loading, error, reload }),
    [error, event, id, loading, reload],
  )

  return <CurrentEventContext.Provider value={value}>{children}</CurrentEventContext.Provider>
}

export function useCurrentEvent(): CurrentEventState {
  const context = useContext(CurrentEventContext)
  if (!context) throw new Error('useCurrentEvent must be used inside <CurrentEventProvider>')
  return context
}
