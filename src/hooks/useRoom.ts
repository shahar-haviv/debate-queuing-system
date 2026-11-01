/**
 * Resolves a staff room link to its event before the live board is opened.
 *
 * The room URL stays short (`/room/:roomId`) because it is printed as a QR code.
 * The room id is unique across all events, so the lookup is a single indexed
 * read; once it returns the event id, the normal event-scoped board takes over.
 */
import { useEffect, useState } from 'react'
import { createLogger } from '../core/logger'
import { useServices } from '../services/container'
import type { RoomWithEvent } from '../services/database'

const log = createLogger('room-context')

export interface RoomContextState {
  room: RoomWithEvent | null
  loading: boolean
  error: string
}

export function useRoom(roomId: string | undefined): RoomContextState {
  const { rooms } = useServices()
  const [room, setRoom] = useState<RoomWithEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!roomId) {
      setRoom(null)
      setError('No room is selected.')
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    rooms
      .findByIdWithEvent(roomId)
      .then((next) => {
        if (!active) return
        setRoom(next)
        setError(next ? '' : 'Room not found. It may have been deleted.')
        if (!next) log.warn('room not found', { roomId })
      })
      .catch((cause: unknown) => {
        if (!active) return
        setRoom(null)
        setError(cause instanceof Error ? cause.message : 'Could not load the room.')
        log.error('room load failed', { roomId, cause })
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [roomId, rooms])

  return { room, loading, error }
}
