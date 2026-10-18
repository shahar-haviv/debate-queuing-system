/**
 * Conflict of interest — keeping named interviewers away from named candidates.
 *
 * A room holds a whole panel, so the question "is this room off-limits?" is now
 * answered against every interviewer standing in it: one name on the candidate's
 * list disqualifies the room. Three places ask that question (the room dropdown,
 * the Auto-Assign algorithm, and the room editor), so the matching rules live
 * here rather than being spelled out three times.
 */

/** Interviewer names are compared the way a person would: trimmed, case-insensitive. */
export function normalizeInterviewerName(name) {
  return String(name ?? '').trim().toLowerCase()
}

/**
 * A room's panel as `{ name, phone }` rows, blanks dropped and duplicates
 * collapsed. A bare string is read as a name and a missing array as an empty
 * panel, so a half-migrated row can never take the dashboard down.
 */
export function roomInterviewers(room) {
  const list = room?.interviewers
  if (!Array.isArray(list)) return []

  const seen = new Set()
  const panel = []
  for (const entry of list) {
    const bare = typeof entry === 'string'
    const name = String(bare ? entry : entry?.name ?? '').trim()
    const key = normalizeInterviewerName(name)
    if (!name || seen.has(key)) continue
    seen.add(key)
    panel.push({ name, phone: bare ? '' : String(entry?.phone ?? '').trim() })
  }
  return panel
}

/** The panel's names alone, in the room's own casing. */
export function interviewerNames(room) {
  return roomInterviewers(room).map((person) => person.name)
}

/** The interviewers a candidate must not see, as comparable names. */
export function blockedInterviewers(candidate) {
  const list = candidate?.interviewer_constraints
  if (!Array.isArray(list)) return []
  return list.map(normalizeInterviewerName).filter(Boolean)
}

/** The same list as the admin typed it, for showing back to them. */
export function constraintLabels(candidate) {
  const list = candidate?.interviewer_constraints
  if (!Array.isArray(list)) return []
  return list.map((name) => String(name ?? '').trim()).filter(Boolean)
}

/**
 * Which of this room's interviewers the candidate must not meet, by name.
 * Empty when the room is fine — including when its panel is empty, because a
 * room with nobody recorded has nobody to object to.
 */
export function conflictingInterviewers(room, candidate) {
  const blocked = blockedInterviewers(candidate)
  if (blocked.length === 0) return []
  return interviewerNames(room).filter((name) => blocked.includes(normalizeInterviewerName(name)))
}

/**
 * Is this room off-limits for this candidate? A partial panel conflict is still
 * a conflict: if any interviewer in the room is on the list, the room is out.
 *
 * Note that this is one-way: it says whether the room the candidate is being
 * sent to is a problem, not whether a conflict has appeared around one they are
 * already sitting in.
 */
export function hasInterviewerConflict(room, candidate) {
  return conflictingInterviewers(room, candidate).length > 0
}

/**
 * Turn the editor's rows into what the database will store: trimmed names,
 * blanks dropped, duplicates collapsed (the first spelling wins), and an empty
 * phone kept as null. Mirrors `public.normalize_interviewers` so the optimistic
 * update already looks like the row that comes back.
 */
export function cleanInterviewerRows(rows) {
  const seen = new Set()
  const panel = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.name ?? '').trim()
    const key = normalizeInterviewerName(name)
    if (!name || seen.has(key)) continue
    seen.add(key)
    panel.push({ name, phone: String(row?.phone ?? '').trim() || null })
  }
  return panel
}

/**
 * Turn the modal's free text ("daniel, Dana") into a clean list. Splits on
 * commas and newlines, trims, drops blanks, and collapses entries that differ
 * only in case — the same tidying the database applies on the way in.
 */
export function parseConstraintList(text) {
  const seen = new Set()
  const list = []
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
export function constraintsToText(candidate) {
  const list = candidate?.interviewer_constraints
  return Array.isArray(list) ? list.join(', ') : ''
}
