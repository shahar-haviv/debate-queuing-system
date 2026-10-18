/**
 * Who is in a room, and who has been there longest.
 *
 * Both the dispatcher's rooms panel and the in-room rubric view need the same
 * answer to "who is in this room, longest-waiting first", and the rubric's
 * answer has to be *authoritative* rather than merely similar: it decides which
 * candidate's evaluation is being written. So the ordering lives here once
 * instead of being re-derived in each view.
 *
 * Longest-waiting first is also the fair order for a shared room: the person who
 * has been sitting there longest is the one who is next to be interviewed.
 */

/**
 * When this candidate entered their current room, in milliseconds.
 *
 * `room_entry_time` is the in-room clock and Rule 5 owns it — the client never
 * sets it. The arrival stamp is only a fallback for a row that predates the
 * column. A row with neither sorts *last*, not first: an unknown wait must never
 * jump ahead of a known one.
 */
export function seatedSince(candidate) {
  const stamp = candidate?.room_entry_time ?? candidate?.arrival_time
  if (!stamp) return Number.MAX_SAFE_INTEGER
  const ms = new Date(stamp).getTime()
  return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms
}

/**
 * The candidates sitting in a room, longest-waiting first.
 *
 * Ties (including two rows with no clock at all) fall back to the name, so the
 * same board always renders in the same order and "the first one" is a stable
 * answer rather than whichever row the database happened to send first.
 */
export function occupantsOf(candidates = [], roomId = null) {
  if (!roomId) return []
  return candidates
    .filter((candidate) => candidate?.assigned_room === roomId)
    .slice()
    .sort((a, b) => seatedSince(a) - seatedSince(b) || (a.name ?? '').localeCompare(b.name ?? '', 'he'))
}

/** The candidate the room is working on now, or null when the room is empty. */
export function longestWaitingOccupant(candidates = [], roomId = null) {
  return occupantsOf(candidates, roomId)[0] ?? null
}
