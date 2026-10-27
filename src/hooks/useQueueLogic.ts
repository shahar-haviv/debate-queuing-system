/**
 * The board's derived read model: the three columns, the FIFO line, and each
 * waiting candidate's position.
 *
 * Pure `useMemo` composition over a snapshot - no fetching, no writes. Keeping
 * it here means the page renders and nothing else, and the ordering rules can be
 * tested without a browser.
 */
import { useMemo } from 'react'
import type { Candidate } from '../core/types'
import { isLate, parseTimeToMinutes } from '../domain/time'
import { queuePositions, waitingInLine } from '../domain/autoAssign'

const UNPLANNED = Number.MAX_SAFE_INTEGER

export interface QueueEntry {
  candidate: Candidate
  late: boolean
}

export interface QueueLogic {
  visible: Candidate[]
  notArrived: QueueEntry[]
  inProgress: Candidate[]
  finished: Candidate[]
  waiting: Candidate[]
  positions: Map<string, number>
  lateCount: number
}

export function useQueueLogic(
  candidates: Candidate[],
  query: string,
  clock: number,
): QueueLogic {
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return candidates
    return candidates.filter((candidate) =>
      [candidate.name, candidate.serial_number, candidate.phone_number]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    )
  }, [candidates, query])

  const notArrived = useMemo<QueueEntry[]>(
    () =>
      visible
        .filter((candidate) => !candidate.has_arrived)
        .map((candidate) => ({ candidate, late: isLate(candidate.planned_time, clock) }))
        .sort((a, b) => {
          if (a.late !== b.late) return a.late ? -1 : 1
          const left = parseTimeToMinutes(a.candidate.planned_time) ?? UNPLANNED
          const right = parseTimeToMinutes(b.candidate.planned_time) ?? UNPLANNED
          return left - right
        }),
    [visible, clock],
  )

  const inProgress = useMemo(
    () =>
      visible
        .filter(
          (candidate) =>
            candidate.has_arrived &&
            !(candidate.debate_interview_completed && candidate.personal_interview_completed),
        )
        .sort((a, b) => {
          const left = a.arrival_time ? new Date(a.arrival_time).getTime() : UNPLANNED
          const right = b.arrival_time ? new Date(b.arrival_time).getTime() : UNPLANNED
          return left - right
        }),
    [visible],
  )

  const finished = useMemo(
    () =>
      visible
        .filter(
          (candidate) =>
            candidate.has_arrived &&
            candidate.debate_interview_completed &&
            candidate.personal_interview_completed,
        )
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'he')),
    [visible],
  )

  /*
   * The line itself. Position is a property of the queue, not of the filtered
   * view, so it is computed from every candidate - searching the board must not
   * renumber who is actually next.
   */
  const waiting = useMemo(() => waitingInLine(candidates), [candidates])
  const positions = useMemo(() => queuePositions(candidates), [candidates])

  return {
    visible,
    notArrived,
    inProgress,
    finished,
    waiting,
    positions,
    lateCount: notArrived.filter((entry) => entry.late).length,
  }
}
