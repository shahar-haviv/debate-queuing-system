/** Time parsing and display. Pure functions, no DOM and no database. */
import { LATE_THRESHOLD_MINUTES } from '../core/constants'

export { LATE_THRESHOLD_MINUTES }

/**
 * Parse an `HH:MM` string into minutes since midnight.
 * Accepts `9:30`, `09:30`, `09:30:00`. Returns null when unparseable.
 */
export function parseTimeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const match = String(value).match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Current wall-clock time expressed as minutes since midnight. */
export function nowMinutes(date: Date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes()
}

/** Is the planned time more than the late threshold in the past? (same-day comparison) */
export function isLate(
  plannedTime: string | null | undefined,
  currentMinutes: number,
  threshold: number = LATE_THRESHOLD_MINUTES,
): boolean {
  const planned = parseTimeToMinutes(plannedTime)
  if (planned == null) return false
  return currentMinutes > planned + threshold
}

/** `09:30` -> `09:30`, `9:30` -> `09:30`. Returns null for empty input. */
export function normalizeTime(value: string | number | null | undefined): string | null {
  const minutes = parseTimeToMinutes(value == null ? null : String(value))
  if (minutes == null) return null
  const h = String(Math.floor(minutes / 60)).padStart(2, '0')
  const m = String(minutes % 60).padStart(2, '0')
  return `${h}:${m}`
}

/** Format a timestamptz into a short local clock time. */
export function formatTimestamp(ts: string | number | Date | null | undefined): string {
  if (!ts) return '—'
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** An interview counts as "running long" once it passes this many minutes. */
export const ROOM_LONG_THRESHOLD_MINUTES = 20

/**
 * Whole minutes a candidate has spent in their current room, or null when the
 * clock was never started. Clamped at zero so a slightly fast server clock can
 * never show a negative timer on the admin's screen.
 */
export function minutesInRoom(
  entryTime: string | number | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!entryTime) return null
  const entered = new Date(entryTime).getTime()
  if (Number.isNaN(entered)) return null
  const minutes = Math.floor((now - entered) / 60_000)
  return minutes < 0 ? 0 : minutes
}

/** `0` -> `0m`, `12` -> `12m`, `75` -> `1h 15m`. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '—'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}
