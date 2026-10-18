import { useCallback, useEffect, useState } from 'react'
import { isConfigured, supabase } from '../lib/supabase'
import { createLogger } from '../lib/logger.js'

const log = createLogger('data')

/**
 * Loads candidates + rooms and keeps them live via Supabase Realtime.
 * Exposes optimistic local mutators so the UI feels instant.
 *
 * The initial snapshot is taken *after* the realtime channel reports
 * SUBSCRIBED. Fetching before that leaves a window in which an insert by
 * another admin would be neither streamed nor fetched, so the row would stay
 * invisible until a manual refresh.
 */
export function useCandidates() {
  const [candidates, setCandidates] = useState([])
  const [rooms, setRooms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async (reason = 'manual') => {
    if (!isConfigured) {
      setLoading(false)
      return
    }
    const done = log.time(`load snapshot (${reason})`)
    const [candidatesResult, roomsResult] = await Promise.all([
      supabase.from('candidates').select('*').order('created_at', { ascending: true }),
      supabase.from('rooms').select('*').order('room_name', { ascending: true }),
    ])

    if (candidatesResult.error || roomsResult.error) {
      const message =
        candidatesResult.error?.message || roomsResult.error?.message || 'Failed to load data.'
      log.error('snapshot failed', { message })
      setError(message)
    } else {
      setError('')
      setCandidates(candidatesResult.data ?? [])
      setRooms(roomsResult.data ?? [])
      done({
        candidates: candidatesResult.data?.length ?? 0,
        rooms: roomsResult.data?.length ?? 0,
      })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false)
      return undefined
    }

    let active = true

    const channel = supabase
      .channel('queue-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'candidates' },
        ({ eventType, new: next, old: previous }) => {
          log.debug(`realtime candidates ${eventType}`, {
            id: next?.id ?? previous?.id,
            name: next?.name,
          })
          setCandidates((prev) => {
            if (eventType === 'INSERT') {
              if (prev.some((row) => row.id === next.id)) return prev
              return [...prev, next]
            }
            if (eventType === 'UPDATE') {
              return prev.map((row) => (row.id === next.id ? next : row))
            }
            if (eventType === 'DELETE') {
              return prev.filter((row) => row.id !== previous.id)
            }
            return prev
          })
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms' },
        ({ eventType, new: next, old: previous }) => {
          log.debug(`realtime rooms ${eventType}`, { id: next?.id ?? previous?.id, name: next?.room_name })
          setRooms((prev) => {
            if (eventType === 'INSERT') {
              if (prev.some((row) => row.id === next.id)) return prev
              return [...prev, next]
            }
            if (eventType === 'UPDATE') {
              return prev.map((row) => (row.id === next.id ? next : row))
            }
            if (eventType === 'DELETE') {
              return prev.filter((row) => row.id !== previous.id)
            }
            return prev
          })
        },
      )
      .subscribe((status) => {
        log.info(`realtime ${status}`)
        if (!active) return
        if (status === 'SUBSCRIBED') {
          // Snapshot now that the stream is live — nothing can slip through.
          reload('subscribed')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          log.warn(`realtime ${status} — falling back to a fresh snapshot`)
          reload(status.toLowerCase())
        }
      })

    // Fast first paint; the SUBSCRIBED snapshot above is the authoritative one.
    reload('initial')

    return () => {
      active = false
      log.debug('removing realtime channel')
      supabase.removeChannel(channel)
    }
  }, [reload])

  const patchLocal = useCallback((id, patch) => {
    setCandidates((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }, [])

  const addLocal = useCallback((row) => {
    setCandidates((prev) => (prev.some((item) => item.id === row.id) ? prev : [...prev, row]))
  }, [])

  const removeLocal = useCallback((id) => {
    setCandidates((prev) => prev.filter((row) => row.id !== id))
  }, [])

  const patchRoomLocal = useCallback((id, patch) => {
    setRooms((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }, [])

  const addRoomLocal = useCallback((row) => {
    setRooms((prev) => (prev.some((item) => item.id === row.id) ? prev : [...prev, row]))
  }, [])

  const removeRoomLocal = useCallback((id) => {
    setRooms((prev) => prev.filter((row) => row.id !== id))
  }, [])

  return {
    candidates,
    rooms,
    loading,
    error,
    reload,
    patchLocal,
    addLocal,
    removeLocal,
    patchRoomLocal,
    addRoomLocal,
    removeRoomLocal,
  }
}
