/**
 * Client-side mirror of the `handle_candidate_changes` trigger.
 *
 * The same rules the database enforces, applied optimistically so the board
 * reacts instantly instead of waiting for the round-trip. The server response is
 * applied right afterwards, so the database always has the final say.
 */
import type { Candidate, CandidatePatch } from '../core/types'

export function applyServerRules(
  patch: CandidatePatch,
  previous: Candidate | null = null,
): CandidatePatch {
  const next: CandidatePatch = { ...patch }

  if (next.has_arrived === false) {
    return {
      ...next,
      arrival_time: null,
      assigned_room: null,
      current_task_assignment: null,
      room_entry_time: null,
      debate_interview_completed: false,
      personal_interview_completed: false,
    }
  }

  if (next.debate_interview_completed === true || next.personal_interview_completed === true) {
    next.assigned_room = null
    next.current_task_assignment = null
  }

  if (next.assigned_room === null) {
    next.current_task_assignment = null
    next.room_entry_time = null
  } else if (next.assigned_room) {
    // Being put in a room (or moved) starts the in-room clock. Landing in the
    // room they are already standing in leaves that clock running, which is what
    // the server does, so auto-assign cannot rewind a running timer.
    if (next.assigned_room !== previous?.assigned_room || !previous?.room_entry_time) {
      next.room_entry_time = new Date().toISOString()
    }
  }

  return next
}
