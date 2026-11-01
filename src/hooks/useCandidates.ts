/**
 * The live board: candidates + rooms, kept in sync by realtime.
 *
 * This hook is a **read model**. It owns the snapshot, the subscription and the
 * optimistic local mutations; it does not own writes (see `useQueueActions`) or
 * derivations (see `useQueueLogic`).
 *
 * The initial snapshot is taken *after* the channel reports SUBSCRIBED. Fetching
 * before that leaves a window in which an insert by another admin would be
 * neither streamed nor fetched, so the row would stay invisible until a manual
 * refresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Candidate, CandidatePatch, Room, RoomPatch } from '../core/types'
import { createLogger } from '../core/logger'
import { useServices } from '../services/container'
import type { CandidateRepository, RealtimeGateway, RoomRepository } from '../services/database'

const log = createLogger('data')

export interface CandidatesDeps {
  candidates?: CandidateRepository
  rooms?: RoomRepository
  realtime?: RealtimeGateway
}

export interface CandidatesState {
  candidates: Candidate[]
  rooms: Room[]
  loading: boolean
  error: string
  reload: (reason?: string) => Promise<void>
  patchLocal: (id: string, patch: CandidatePatch) => void
  addLocal: (row: Candidate) => void
  removeLocal: (id: string) => void
  patchRoomLocal: (id: string, patch: RoomPatch) => void
  addRoomLocal: (row: Room) => void
  removeRoomLocal: (id: string) => void
}

export function useCandidates(eventId: string | undefined, deps: CandidatesDeps = {}): CandidatesState {
  const services = useServices()
  const candidateRepo = deps.candidates ?? services.candidates
  const roomRepo = deps.rooms ?? services.rooms
  const realtime = deps.realtime ?? services.realtime

  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const eventIdRef = useRef(eventId)
  eventIdRef.current = eventId

  const reload = useCallback(
    async (reason = 'manual') => {
      if (!eventId) {
        setCandidates([])
        setRooms([])
        setLoading(false)
        return
      }

      const requestedEvent = eventId
      const done = log.time(`load snapshot (${reason})`)
      try {
        const [nextCandidates, nextRooms] = await Promise.all([
          candidateRepo.list(eventId),
          roomRepo.list(eventId),
        ])
        if (eventIdRef.current !== requestedEvent) return
        setError('')
        setCandidates(nextCandidates)
        setRooms(nextRooms)
        done({ event: eventId, candidates: nextCandidates.length, rooms: nextRooms.length })
      } catch (cause) {
        if (eventIdRef.current !== requestedEvent) return
        const message = cause instanceof Error ? cause.message : 'Failed to load data.'
        log.error('snapshot failed', { eventId, message, cause })
        setError(message)
      } finally {
        if (eventIdRef.current === requestedEvent) setLoading(false)
      }
    },
    [candidateRepo, eventId, roomRepo],
  )

  useEffect(() => {
    if (!eventId) {
      setCandidates([])
      setRooms([])
      setError('')
      setLoading(false)
      return
    }

    let active = true
    setCandidates([])
    setRooms([])
    setError('')
    setLoading(true)

    const unsubscribe = realtime.subscribeBoard(eventId, {
      onCandidate(event, row, previous) {
        if (!active) return
        const id = row?.id ?? previous?.id
        log.debug(`realtime candidates ${event}`, { eventId, id, name: row?.name })
        if (!id) return
        if (row?.event_id && row.event_id !== eventId) return

        setCandidates((prev) => {
          if (event === 'INSERT') {
            if (prev.some((existing) => existing.id === id)) return prev
            return [...prev, row as Candidate]
          }
          if (event === 'UPDATE') {
            return prev.map((existing) =>
              existing.id === id ? ({ ...existing, ...row } as Candidate) : existing,
            )
          }
          return prev.filter((existing) => existing.id !== id)
        })
      },

      onRoom(event, row, previous) {
        if (!active) return
        // DELETE payloads carry only the primary key in `previous`; `row` is
        // empty, so trusting it would remove the literal id "undefined".
        const id = event === 'DELETE' ? previous?.id : row?.id ?? previous?.id
        log.debug(`realtime rooms ${event}`, { eventId, id, name: row?.room_name })
        if (!id) return
        if (row?.event_id && row.event_id !== eventId) return

        setRooms((prev) => {
          if (event === 'INSERT') {
            if (prev.some((existing) => existing.id === id)) return prev
            return [...prev, row as Room]
          }
          if (event === 'UPDATE') {
            return prev.map((existing) => (existing.id === id ? ({ ...existing, ...row } as Room) : existing))
          }
          return prev.filter((existing) => existing.id !== id)
        })
      },

      onStatus(status) {
        log.info(`realtime ${status}`, { eventId })
        if (!active) return
        if (status === 'SUBSCRIBED') {
          // Snapshot now that the stream is live - nothing can slip through.
          void reload('subscribed')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          log.warn(`realtime ${status} - falling back to a fresh snapshot`, { eventId })
          void reload(status.toLowerCase())
        }
      },
    })

    // Fast first paint; the SUBSCRIBED snapshot above is the authoritative one.
    void reload('initial')

    return () => {
      active = false
      log.debug('removing realtime channel', { eventId })
      unsubscribe()
    }
  }, [eventId, realtime, reload])

  const patchLocal = useCallback((id: string, patch: CandidatePatch) => {
    setCandidates((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }, [])

  const addLocal = useCallback((row: Candidate) => {
    setCandidates((prev) => (prev.some((item) => item.id === row.id) ? prev : [...prev, row]))
  }, [])

  const removeLocal = useCallback((id: string) => {
    setCandidates((prev) => prev.filter((row) => row.id !== id))
  }, [])

  const patchRoomLocal = useCallback((id: string, patch: RoomPatch) => {
    setRooms((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }, [])

  const addRoomLocal = useCallback((row: Room) => {
    setRooms((prev) => (prev.some((item) => item.id === row.id) ? prev : [...prev, row]))
  }, [])

  const removeRoomLocal = useCallback((id: string) => {
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
