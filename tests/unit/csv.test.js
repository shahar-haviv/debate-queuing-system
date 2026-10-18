import { describe, expect, it } from 'vitest'
import { dedupeKey, normalizePhone, parseCandidatesCsv } from '../../src/lib/csv.js'

describe('normalizePhone', () => {
  it('restores the leading zero a spreadsheet drops', () => {
    expect(normalizePhone('501234567')).toBe('0501234567')
    expect(normalizePhone(501234567)).toBe('0501234567')
  })

  it('leaves an already-correct number alone', () => {
    expect(normalizePhone('050-1234567')).toBe('0501234567')
    expect(normalizePhone('0529876543')).toBe('0529876543')
  })

  it('returns null for blanks', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone('   ')).toBeNull()
  })
})

describe('dedupeKey', () => {
  it('prefers the serial number', () => {
    expect(dedupeKey({ serial_number: '12', name: 'Dana' })).toBe('s:12')
  })

  it('composes a name key when there is no serial', () => {
    expect(dedupeKey({ name: 'Dana Cohen', planned_time: '09:30', phone_number: '0501234567' })).toBe(
      'n:dana cohen|09:30|0501234567',
    )
  })

  it('is stable across trivially different input', () => {
    expect(dedupeKey({ serial_number: ' 12 ' })).toBe(dedupeKey({ serial_number: '12' }))
  })
})

describe('parseCandidatesCsv — Hebrew headers', () => {
  const csv = [
    'מס"ד,שם מלא,טלפון,שעה',
    '1,ישראל ישראלי,050-1234567,09:30',
    '2,דנה כהן,0529876543,09:45',
  ].join('\n')

  it('maps מס"ד / שם מלא / טלפון / שעה onto the candidate fields', async () => {
    const { rows, total, skipped } = await parseCandidatesCsv(csv)
    expect(total).toBe(2)
    expect(skipped).toBe(0)
    expect(rows[0]).toEqual({
      name: 'ישראל ישראלי',
      serial_number: '1',
      phone_number: '0501234567',
      planned_time: '09:30',
      has_arrived: false,
      debate_interview_completed: false,
      personal_interview_completed: false,
      assigned_room: null,
      current_task_assignment: null,
    })
    expect(rows[1].name).toBe('דנה כהן')
  })

  it('accepts the typographic quote variants of מס״ד', async () => {
    for (const header of ['מס"ד', 'מס״ד', 'מס ד', 'מסד']) {
      const { rows } = await parseCandidatesCsv(`${header},שם מלא\n7,Dana\n`)
      expect(rows[0].serial_number).toBe('7')
    }
  })

  it('accepts English fallback headers', async () => {
    const { rows } = await parseCandidatesCsv('serial,name,phone,planned time\n9,Dana,501234567,10:05\n')
    expect(rows[0].serial_number).toBe('9')
    expect(rows[0].name).toBe('Dana')
    expect(rows[0].phone_number).toBe('0501234567')
    expect(rows[0].planned_time).toBe('10:05')
  })

  it('skips rows with no name rather than importing blanks', async () => {
    const { rows, skipped } = await parseCandidatesCsv('name,time\n,09:00\nDana,10:00\n  ,11:00\n')
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Dana')
    expect(skipped).toBe(2)
  })

  it('normalizes a single-digit hour and leaves junk times empty', async () => {
    const { rows } = await parseCandidatesCsv('name,time\nA,9:05\nB,not a time\n')
    expect(rows[0].planned_time).toBe('09:05')
    expect(rows[1].planned_time).toBeNull()
  })

  it('ignores a BOM on the first header', async () => {
    const { rows } = await parseCandidatesCsv('\uFEFFname,phone\nDana,0501234567\n')
    expect(rows[0].name).toBe('Dana')
  })

  it('lets the first populated column claim a field, so a blank column cannot shadow it', async () => {
    const { rows } = await parseCandidatesCsv('name,full name\nDana,Cohen\n')
    expect(rows[0].name).toBe('Dana')
  })

  it('resolves to an empty result for an empty file', async () => {
    const { rows } = await parseCandidatesCsv('')
    expect(rows).toEqual([])
  })
})
