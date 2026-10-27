/**
 * Who is in a room, and who has been there longest.
 *
 * Both the dispatcher's rooms panel and the in-room rubric need the same answer
 * to "who is in this room, longest-waiting first", and the rubric's answer is
 * authoritative: it decides which candidate's evaluation is being written.
 */
import type { Candidate } from '../core/types'

/** Only the seating fields, so a tests fixture can be small. */
export type SeatedCandidate = Pick<Candidate, 'id' | 'name' | 'assigned_room'> &
  Partial<Pick<Candidate, 'room_entry_time' | 'arrival_time'>>

/**
 * When this candidate entered their current room, in milliseconds.
 *
 * `room_entry_time` is the in-room clock and Rule 5 owns it. The arrival stamp
 * is only a fallback for a row that predates the column. A row with neither
 * sorts *last*, not first: an unknown wait must never jump ahead of a known one.
 */
export function seatedSince(candidate: SeatedCandidate | null | undefined): number {
  const stamp = candidate?.room_entry_time ?? candidate?.arrival_time
  if (!stamp) return Number.MAX_SAFE_INTEGER
  const ms = new Date(stamp).getTime()
  return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms
}

/**
 * The candidates sitting in a room, longest-waiting first.
 *
 * Ties (including two rows with no clock at all) fall back to the name, so the
 * same board always renders in the same order.
 */
export function occupantsOf<C extends SeatedCandidate>(candidates: C[] = [], roomId: string | null = null): C[] {
  if (!roomId) return []
  return candidates
    .filter((candidate) => candidate?.assigned_room === roomId)
    .slice()
    .sort((a, b) => seatedSince(a) - seatedSince(b) || (a.name ?? '').localeCompare(b.name ?? '', 'he'))
}

/** The candidate the room is working on now, or null when the room is empty. */
export function longestWaitingOccupant<C extends SeatedCandidate>(
  candidates: C[] = [],
  roomId: string | null = null,
): C | null {
  return occupantsOf(candidates, roomId)[0] ?? null
}
