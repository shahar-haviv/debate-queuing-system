/**
 * Filed rubrics for one room, plus the two writes the rubric screen performs.
 *
 * Filing is two writes, in this order:
 *   1. the evaluation itself (upsert, so a second click edits rather than
 *      duplicates);
 *   2. `personal_interview_completed = true`, which is what releases the room -
 *      database Rule 3 owns the release, so this hook never clears the room
 *      itself and cannot disagree with the dispatcher view about it.
 */
import { useCallback, useEffect, useState } from 'react'
import type { Evaluation, NewEvaluation } from '../core/types'
import { createLogger } from '../core/logger'
import { useServices } from '../services/container'

const log = createLogger('evaluations')

export interface EvaluationsState {
  evaluations: Evaluation[]
  load: (reason?: string) => Promise<void>
  save: (input: NewEvaluation) => Promise<void>
  release: (candidateId: string) => Promise<void>
}

export function useEvaluations(eventId: string | undefined, roomId: string | undefined): EvaluationsState {
  const { evaluations: repo, candidates } = useServices()
  const [evaluations, setEvaluations] = useState<Evaluation[]>([])

  const load = useCallback(
    async (reason = 'manual') => {
      if (!eventId || !roomId) return
      try {
        const rows = await repo.listByRoom(eventId, roomId)
        log.debug('evaluations loaded', { eventId, roomId, reason, count: rows.length })
        setEvaluations(rows)
      } catch (cause) {
        log.error('loading evaluations failed', { eventId, roomId, reason, cause })
      }
    },
    [eventId, repo, roomId],
  )

  useEffect(() => {
    void load('mount')
  }, [load])

  const save = useCallback(
    async (input: NewEvaluation) => {
      log.info('submitting evaluation', { candidate: input.candidate_id, room: input.room_id })
      await repo.upsert(input)
    },
    [repo],
  )

  const release = useCallback(
    async (candidateId: string) => {
      const updated = await candidates.update(candidateId, { personal_interview_completed: true })
      log.info('room released', { id: candidateId, room: updated.assigned_room })
    },
    [candidates],
  )

  return { evaluations, load, save, release }
}
