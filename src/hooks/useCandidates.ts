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
import { useCallback, useEffect, useState } from 'react'
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

export function useCandidates(deps: CandidatesDeps = {}): CandidatesState {
  const services = useServices()
  const candidateRepo = deps.candidates ?? services.candidates
  const roomRepo = deps.rooms ?? services.rooms
  const realtime = deps.realtime ?? services.realtime

  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(
    async (reason = 'manual') => {
      const done = log.time(`load snapshot (${reason})`)
      try {
        const [nextCandidates, nextRooms] = await Promise.all([candidateRepo.list(), roomRepo.list()])
        setError('')
        setCandidates(nextCandidates)
        setRooms(nextRooms)
        done({ candidates: nextCandidates.length, rooms: nextRooms.length })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Failed to load data.'
        log.error('snapshot failed', { message, cause })
        setError(message)
      } finally {
        setLoading(false)
      }
    },
    [candidateRepo, roomRepo],
  )

  useEffect(() => {
    let active = true

    const unsubscribe = realtime.subscribeBoard({
      onCandidate(event, row, previous) {
        const id = row?.id ?? previous?.id
        log.debug(`realtime candidates ${event}`, { id, name: row?.name })
        if (!id) return

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
        const id = row?.id ?? previous?.id
        log.debug(`realtime rooms ${event}`, { id, name: row?.room_name })
        if (!id) return

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
        log.info(`realtime ${status}`)
        if (!active) return
        if (status === 'SUBSCRIBED') {
          // Snapshot now that the stream is live - nothing can slip through.
          void reload('subscribed')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          log.warn(`realtime ${status} - falling back to a fresh snapshot`)
          void reload(status.toLowerCase())
        }
      },
    })

    // Fast first paint; the SUBSCRIBED snapshot above is the authoritative one.
    void reload('initial')

    return () => {
      active = false
      log.debug('removing realtime channel')
      unsubscribe()
    }
  }, [realtime, reload])

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
