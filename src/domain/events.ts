/**
 * Pure event presentation helpers.
 *
 * Dates are stored as `YYYY-MM-DD`, not timestamps: an interview day is a local
 * calendar day, so parsing it as UTC midnight would show the previous day for
 * anyone west of Greenwich. The explicit `T00:00:00` keeps it local.
 */
import type { EventStatus } from '../core/types'

export const EVENT_STATUSES: EventStatus[] = ['Draft', 'Active', 'Completed']

export function parseEventDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatEventDate(value: string): string {
  const date = parseEventDate(value)
  if (!date) return value || 'No date'
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function todayIso(): string {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
