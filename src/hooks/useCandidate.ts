/**
 * The candidate-facing status page.
 *
 * Reads only the public projection - never the phone number or serial number -
 * and follows its own row plus any room change in realtime, with a slow poll as
 * the safety net.
 */
import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '../core/logger'
import { useServices } from '../services/container'
import type { PublicCandidate, PublicRoom } from '../services/database'

const log = createLogger('candidate')

export interface CandidateViewState {
  candidate: PublicCandidate | null
  room: PublicRoom | null
  loading: boolean
  notFound: boolean
}

export function useCandidate(id: string | undefined): CandidateViewState {
  const { candidates, rooms, realtime } = useServices()
  const [candidate, setCandidate] = useState<PublicCandidate | null>(null)
  const [room, setRoom] = useState<PublicRoom | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    if (!id) {
      setNotFound(true)
      setLoading(false)
      return
    }

    try {
      const next = await candidates.findPublicById(id)
      if (!next) {
        setCandidate(null)
        setRoom(null)
        setNotFound(true)
        setLoading(false)
        return
      }

      setCandidate(next)
      setNotFound(false)
      setRoom(next.assigned_room ? await rooms.findById(next.assigned_room) : null)
    } catch (cause) {
      log.error('candidate load failed', { id, cause })
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [candidates, id, rooms])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useEffect(() => {
    if (!id) return undefined

    const unsubscribe = realtime.subscribeCandidate(id, () => {
      log.debug('candidate realtime change', { id })
      void load()
    })
    const poll = setInterval(() => void load(), 30_000)

    return () => {
      unsubscribe()
      clearInterval(poll)
    }
  }, [id, load, realtime])

  return { candidate, room, loading, notFound }
}
