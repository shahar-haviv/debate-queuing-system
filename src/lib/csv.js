import Papa from 'papaparse'
import { normalizeTime } from './time.js'
import { createLogger } from './logger.js'

const log = createLogger('csv')

/**
 * Maps normalized header text -> candidate field.
 * Hebrew headers are matched with all quote variants (`"`, `'`, `״`, `׳`)
 * and whitespace stripped, so `מס"ד`, `מס״ד` and `מס ד` all resolve.
 */
const HEADER_MAP = {
  // Hebrew (as specified)
  מסד: 'serial_number',
  שםמלא: 'name',
  טלפון: 'phone_number',
  שעה: 'planned_time',
  // English fallbacks
  serial: 'serial_number',
  serialnumber: 'serial_number',
  id: 'serial_number',
  name: 'name',
  fullname: 'name',
  phone: 'phone_number',
  phonenumber: 'phone_number',
  mobile: 'phone_number',
  time: 'planned_time',
  plannedtime: 'planned_time',
  hour: 'planned_time',
}

const STRIP = /[\s"'`׳״]/g

function normalizeHeader(header) {
  return String(header ?? '')
    .replace(STRIP, '')
    .replace(/[().:_\-/]/g, '')
    .toLowerCase()
}

/**
 * Israeli phone numbers are frequently stored as numbers, which drops the
 * leading zero. Restore it when we see a bare 9-digit local number.
 */
export function normalizePhone(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const digits = raw.replace(/[^\d+]/g, '')
  if (/^\d{9}$/.test(digits)) return `0${digits}`
  return digits || null
}

/** Stable identity for duplicate detection when a row has no serial number. */
export function dedupeKey(row) {
  const serial = String(row.serial_number ?? '').trim().toLowerCase()
  if (serial) return `s:${serial}`
  return `n:${String(row.name ?? '').trim().toLowerCase()}|${row.planned_time ?? ''}|${row.phone_number ?? ''}`
}

/**
 * Parse a CSV File (or raw CSV string) into candidate rows.
 * Resolves with `{ rows, total, skipped }`.
 */
export function parseCandidatesCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.replace(/^\uFEFF/, ''),
      complete: (results) => {
        const rows = []
        let skipped = 0

        for (const raw of results.data) {
          const mapped = {}
          for (const [key, value] of Object.entries(raw ?? {})) {
            const field = HEADER_MAP[normalizeHeader(key)]
            if (!field) continue
            // A field is only claimed by the first column that actually holds a
            // value — a blank column must not shadow a populated one.
            const alreadyFilled = String(mapped[field] ?? '').trim() !== ''
            const hasValue = String(value ?? '').trim() !== ''
            if (!alreadyFilled && hasValue) mapped[field] = value
          }

          const name = String(mapped.name ?? '').trim()
          if (!name) {
            skipped += 1
            continue
          }

          rows.push({
            name,
            serial_number: String(mapped.serial_number ?? '').trim() || null,
            phone_number: normalizePhone(mapped.phone_number),
            planned_time: normalizeTime(mapped.planned_time),
            has_arrived: false,
            debate_interview_completed: false,
            personal_interview_completed: false,
            assigned_room: null,
            current_task_assignment: null,
          })
        }

        log.info('csv parsed', {
          dataRows: results.data.length,
          accepted: rows.length,
          skippedBlankNames: skipped,
          headers: results.meta?.fields ?? [],
        })

        resolve({ rows, total: results.data.length, skipped })
      },
      error: (error) => {
        log.error('csv parse failed', { error })
        reject(error)
      },
    })
  })
}
