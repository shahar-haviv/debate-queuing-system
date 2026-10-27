/**
 * Every write the dispatch board can perform, behind one injected service.
 *
 * The hook returns results and throws on failure; turning those into toasts is
 * the page's job. Nothing here imports Supabase, so a test can pass a fake
 * `DatabaseService` and assert the writes without a network.
 */
import { useCallback } from 'react'
import type {
  Candidate,
  CandidatePatch,
  NewCandidate,
  NewRoom,
  Room,
  RoomPatch,
  TaskAssignment,
} from '../core/types'
import { createLogger } from '../core/logger'
import { useServices } from '../services/container'
import {
  neededTasks,
  pickPlacement,
  roomLoads,
  roomTypeForTask,
  roomsForTask,
  type QueueCandidate,
} from '../domain/autoAssign'
import { dedupeKey } from '../domain/csv'

const log = createLogger('actions')

export type PlacementOutcome =
  | {
      reason: 'ok'
      task: TaskAssignment
      room: Room
      load: number
      pools: Record<TaskAssignment, number | null>
    }
  | { reason: 'done'; needed: TaskAssignment[] }
  | { reason: 'no-room'; needed: TaskAssignment[] }
  | { reason: 'restricted'; needed: TaskAssignment[] }
  | { reason: 'error'; message: string }

export interface ImportResult {
  imported: number
  duplicates: number
}

export interface QueueActions {
  patchCandidate: (id: string, patch: CandidatePatch) => Promise<Candidate>
  saveCandidate: (values: NewCandidate | CandidatePatch, id?: string) => Promise<Candidate>
  deleteCandidate: (id: string) => Promise<void>
  importCandidates: (rows: NewCandidate[]) => Promise<ImportResult>
  createRoom: (values: NewRoom) => Promise<Room>
  updateRoom: (id: string, patch: RoomPatch) => Promise<Room>
  deleteRoom: (id: string) => Promise<void>
  choosePlacement: (candidate: QueueCandidate, rooms: Room[]) => Promise<PlacementOutcome>
}

export function useQueueActions(): QueueActions {
  const { candidates: candidateRepo, rooms: roomRepo } = useServices()

  const patchCandidate = useCallback(
    async (id: string, patch: CandidatePatch) => {
      log.debug('patch candidate', { id, patch })
      return candidateRepo.update(id, patch)
    },
    [candidateRepo],
  )

  const saveCandidate = useCallback(
    async (values: NewCandidate | CandidatePatch, id?: string) => {
      if (id) {
        log.info('update candidate', { id })
        return candidateRepo.update(id, values as CandidatePatch)
      }
      log.info('add candidate')
      return candidateRepo.create(values as NewCandidate)
    },
    [candidateRepo],
  )

  const deleteCandidate = useCallback(
    async (id: string) => {
      log.info('delete candidate', { id })
      await candidateRepo.remove(id)
    },
    [candidateRepo],
  )

  const importCandidates = useCallback(
    async (rows: NewCandidate[]): Promise<ImportResult> => {
      // The keys come from the database, not from local state, so a fast
      // double-import cannot slip a duplicate through on a stale snapshot.
      const existingRows = await candidateRepo.listDedupeRows()
      const existing = new Set(existingRows.map((row) => dedupeKey(row)))
      const seen = new Set<string>()
      const fresh: NewCandidate[] = []
      let duplicates = 0

      for (const row of rows) {
        const key = dedupeKey(row)
        if (existing.has(key) || seen.has(key)) {
          duplicates += 1
          continue
        }
        seen.add(key)
        fresh.push(row)
      }

      if (!fresh.length) return { imported: 0, duplicates }

      const created = await candidateRepo.importMany(fresh)
      log.info('csv import complete', { imported: created.length, duplicates })
      return { imported: created.length, duplicates }
    },
    [candidateRepo],
  )

  const createRoom = useCallback(
    async (values: NewRoom) => {
      log.info('add room', { name: values.room_name, type: values.room_type })
      return roomRepo.create(values)
    },
    [roomRepo],
  )

  const updateRoom = useCallback(
    async (id: string, patch: RoomPatch) => {
      log.info('update room', { id, patch })
      return roomRepo.update(id, patch)
    },
    [roomRepo],
  )

  const deleteRoom = useCallback(
    async (id: string) => {
      log.info('delete room', { id })
      await roomRepo.remove(id)
    },
    [roomRepo],
  )

  /**
   * Where should this candidate go, and if nowhere, why not.
   *
   * The queues are counted from the database rather than from the last realtime
   * snapshot: another admin may have assigned somebody a second ago, and the
   * whole point of the button is to balance the load that actually exists.
   */
  const choosePlacement = useCallback(
    async (candidate: QueueCandidate, rooms: Room[]): Promise<PlacementOutcome> => {
      const needed = neededTasks(candidate)
      if (!needed.length) return { reason: 'done', needed }

      // "There is no such room" and "every such room is off-limits" are
      // different problems and get different explanations.
      if (!needed.some((task) => roomsForTask(task, rooms).length > 0)) {
        return { reason: 'no-room', needed }
      }
      if (!needed.some((task) => roomsForTask(task, rooms, candidate).length > 0)) {
        return { reason: 'restricted', needed }
      }

      let assignments
      try {
        assignments = await candidateRepo.listAssignments()
      } catch (cause) {
        return { reason: 'error', message: cause instanceof Error ? cause.message : 'Could not read the queue.' }
      }

      const loads = roomLoads(assignments, candidate.id)
      const placement = pickPlacement(candidate, rooms, loads)
      if (!placement) return { reason: 'restricted', needed }

      log.info('placement chosen', {
        name: candidate.name,
        task: placement.task,
        room: placement.room.room_name,
        queue: placement.load,
        needed: needed.map(roomTypeForTask),
      })

      return { reason: 'ok', ...placement }
    },
    [candidateRepo],
  )

  return {
    patchCandidate,
    saveCandidate,
    deleteCandidate,
    importCandidates,
    createRoom,
    updateRoom,
    deleteRoom,
    choosePlacement,
  }
}
