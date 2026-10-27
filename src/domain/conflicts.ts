/**
 * Conflict of interest - keeping named interviewers away from named candidates.
 *
 * A room holds a whole panel, so the question "is this room off-limits?" is
 * answered against every interviewer standing in it. The matching rules live
 * here because the room editor, Auto-Assign and the constraint modal all ask it.
 */
import type { Candidate, Interviewer, Room } from '../core/types'

/** The minimum a room needs for the conflict rules. */
export type RoomPanel = Pick<Room, 'interviewers'> | { interviewers?: unknown }

/** The minimum a candidate needs for the conflict rules. */
export type ConstrainedCandidate =
  | Pick<Candidate, 'interviewer_constraints'>
  | { interviewer_constraints?: string[] | null }

/** Interviewer names are compared the way a person would: trimmed, case-insensitive. */
export function normalizeInterviewerName(name: unknown): string {
  return String(name ?? '').trim().toLowerCase()
}

/**
 * A room's panel as `{ name, phone }` rows, blanks dropped and duplicates
 * collapsed. A bare string is read as a name and a missing array as an empty
 * panel, so a half-migrated row can never take the dashboard down.
 */
export function roomInterviewers(room: RoomPanel | null | undefined): Interviewer[] {
  const list = room?.interviewers
  if (!Array.isArray(list)) return []

  const seen = new Set<string>()
  const panel: Interviewer[] = []
  for (const entry of list) {
    const bare = typeof entry === 'string'
    const name = String(bare ? entry : (entry as Interviewer | null)?.name ?? '').trim()
    const key = normalizeInterviewerName(name)
    if (!name || seen.has(key)) continue
    seen.add(key)
    panel.push({ name, phone: bare ? '' : String((entry as Interviewer | null)?.phone ?? '').trim() })
  }
  return panel
}

/** The panel's names alone, in the room's own casing. */
export function interviewerNames(room: RoomPanel | null | undefined): string[] {
  return roomInterviewers(room).map((person) => person.name)
}

/** The interviewers a candidate must not see, as comparable names. */
export function blockedInterviewers(candidate: ConstrainedCandidate | null | undefined): string[] {
  const list = candidate?.interviewer_constraints
  if (!Array.isArray(list)) return []
  return list.map(normalizeInterviewerName).filter(Boolean)
}

/** The same list as the admin typed it, for showing back to them. */
export function constraintLabels(candidate: ConstrainedCandidate | null | undefined): string[] {
  const list = candidate?.interviewer_constraints
  if (!Array.isArray(list)) return []
  return list.map((name) => String(name ?? '').trim()).filter(Boolean)
}

/**
 * Which of this room's interviewers the candidate must not meet, by name.
 * Empty when the room is fine - including when its panel is empty, because a
 * room with nobody recorded has nobody to object to.
 */
export function conflictingInterviewers(
  room: RoomPanel | null | undefined,
  candidate: ConstrainedCandidate | null | undefined,
): string[] {
  const blocked = blockedInterviewers(candidate)
  if (blocked.length === 0) return []
  return interviewerNames(room).filter((name) => blocked.includes(normalizeInterviewerName(name)))
}

/**
 * Is this room off-limits for this candidate? A partial panel conflict is still
 * a conflict: if any interviewer in the room is on the list, the room is out.
 */
export function hasInterviewerConflict(
  room: RoomPanel | null | undefined,
  candidate: ConstrainedCandidate | null | undefined,
): boolean {
  return conflictingInterviewers(room, candidate).length > 0
}

/**
 * Turn the editor's rows into what the database will store: trimmed names,
 * blanks dropped, duplicates collapsed (the first spelling wins), and an empty
 * phone kept as null. Mirrors `public.normalize_interviewers`.
 */
export function cleanInterviewerRows(rows: unknown): Interviewer[] {
  const seen = new Set<string>()
  const panel: Interviewer[] = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String((row as Interviewer | null)?.name ?? '').trim()
    const key = normalizeInterviewerName(name)
    if (!name || seen.has(key)) continue
    seen.add(key)
    panel.push({ name, phone: String((row as Interviewer | null)?.phone ?? '').trim() || null })
  }
  return panel
}

/**
 * Turn the modal's free text ("daniel, Dana") into a clean list. Splits on
 * commas and newlines, trims, drops blanks, and collapses entries that differ
 * only in case - the same tidying the database applies on the way in.
 */
export function parseConstraintList(text: string | null | undefined): string[] {
  const seen = new Set<string>()
  const list: string[] = []
  for (const piece of String(text ?? '').split(/[,\n]/)) {
    const name = piece.trim()
    const key = normalizeInterviewerName(name)
    if (!name || seen.has(key)) continue
    seen.add(key)
    list.push(name)
  }
  return list
}

/** The reverse, for putting an existing candidate's list back in the input. */
export function constraintsToText(candidate: ConstrainedCandidate | null | undefined): string {
  const list = candidate?.interviewer_constraints
  return Array.isArray(list) ? list.join(', ') : ''
}
