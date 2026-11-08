/**
 * Creates a future event as one logical unit.
 *
 * A browser cannot open a transaction across three PostgREST calls, so this
 * orchestration compensates: if room allocation or the roster import fails, the
 * draft event is deleted again rather than leaving a half-built day in the Back
 * Office. The event is created in Draft; activating it remains a deliberate
 * admin action from the hub.
 */
import { useCallback } from 'react'
import type { EventFormsConfig, Interviewer, NewCandidate, QueueEvent, RoomType } from '../core/types'
import { createLogger } from '../core/logger'
import { useServices } from '../services/container'
import { dedupeKey } from '../domain/csv'

const log = createLogger('planner')

export interface PlannerRoom {
  /** Stable client-side key; the database id does not exist yet. */
  key: string
  room_name: string
  room_type: RoomType
  interviewers: Interviewer[]
}

export interface EventPlan {
  name: string
  date: string
  notes: string
  rooms: PlannerRoom[]
  candidates: NewCandidate[]
  forms?: EventFormsConfig
}

export interface EventPlanResult {
  event: QueueEvent
  imported: number
  duplicates: number
}

export interface EventPlanner {
  create: (plan: EventPlan) => Promise<EventPlanResult>
}

export function useEventPlanner(): EventPlanner {
  const { events, rooms, candidates } = useServices()

  const create = useCallback(
    async (plan: EventPlan): Promise<EventPlanResult> => {
      const name = plan.name.trim()
      if (!name || !plan.date) throw new Error('An event needs a name and a date.')

      const roomRows = plan.rooms
        .map((room) => ({ ...room, room_name: room.room_name.trim() }))
        .filter((room) => room.room_name)
      if (roomRows.length !== plan.rooms.length) {
        throw new Error('Every room needs a name before the event can be created.')
      }

      const event = await events.create({
        name,
        date: plan.date,
        notes: plan.notes.trim(),
        status: 'Draft',
        ...(plan.forms ? { forms: plan.forms } : {}),
      })
      log.info('event draft created', { eventId: event.id, name: event.name })

      try {
        if (roomRows.length) {
          await rooms.createMany(
            event.id,
            roomRows.map((room) => ({
              room_name: room.room_name,
              room_type: room.room_type,
              interviewers: room.interviewers,
            })),
          )
          log.info('event rooms created', { eventId: event.id, count: roomRows.length })
        }

        const seen = new Set<string>()
        const fresh: NewCandidate[] = []
        let duplicates = 0
        for (const candidate of plan.candidates) {
          const key = dedupeKey(candidate)
          if (seen.has(key)) {
            duplicates += 1
            continue
          }
          seen.add(key)
          fresh.push(candidate)
        }

        if (fresh.length) {
          await candidates.importMany(event.id, fresh)
          log.info('event roster imported', { eventId: event.id, imported: fresh.length, duplicates })
        }

        return { event, imported: fresh.length, duplicates }
      } catch (cause) {
        // Compensating rollback: never leave an orphaned half-built event.
        try {
          await events.remove(event.id)
          log.warn('event draft rolled back after setup failure', { eventId: event.id })
        } catch (rollbackCause) {
          log.error('event draft rollback failed', { eventId: event.id, rollbackCause })
        }
        throw cause
      }
    },
    [candidates, events, rooms],
  )

  return { create }
}
