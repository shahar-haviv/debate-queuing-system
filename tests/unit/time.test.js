import { describe, expect, it } from 'vitest'
import {
  LATE_THRESHOLD_MINUTES,
  ROOM_LONG_THRESHOLD_MINUTES,
  formatDuration,
  formatTimestamp,
  isLate,
  minutesInRoom,
  normalizeTime,
  nowMinutes,
  parseTimeToMinutes,
} from '../../src/lib/time.js'

describe('parseTimeToMinutes', () => {
  it('reads both padded and unpadded clock times', () => {
    expect(parseTimeToMinutes('09:30')).toBe(570)
    expect(parseTimeToMinutes('9:30')).toBe(570)
    expect(parseTimeToMinutes('00:00')).toBe(0)
    expect(parseTimeToMinutes('23:59')).toBe(1439)
  })

  it('accepts a trailing seconds component', () => {
    expect(parseTimeToMinutes('09:30:00')).toBe(570)
  })

  it('rejects anything it cannot trust', () => {
    expect(parseTimeToMinutes('')).toBeNull()
    expect(parseTimeToMinutes(null)).toBeNull()
    expect(parseTimeToMinutes(undefined)).toBeNull()
    expect(parseTimeToMinutes('24:00')).toBeNull()
    expect(parseTimeToMinutes('09:60')).toBeNull()
    expect(parseTimeToMinutes('half past nine')).toBeNull()
  })
})

describe('normalizeTime', () => {
  it('pads a single-digit hour', () => {
    expect(normalizeTime('9:30')).toBe('09:30')
    expect(normalizeTime('09:30')).toBe('09:30')
    expect(normalizeTime('9:5')).toBeNull()
  })

  it('returns null for empty input rather than "NaN:NaN"', () => {
    expect(normalizeTime('')).toBeNull()
    expect(normalizeTime(null)).toBeNull()
  })
})

describe('nowMinutes', () => {
  it('expresses the wall clock as minutes since midnight', () => {
    expect(nowMinutes(new Date(2026, 9, 17, 15, 1, 30))).toBe(901)
    expect(nowMinutes(new Date(2026, 9, 17, 0, 0, 0))).toBe(0)
  })
})

describe('isLate — the 15-minute alert', () => {
  const planned = '14:45' // 885 minutes
  const at = (h, m) => h * 60 + m

  it('is exactly a 15-minute threshold', () => {
    expect(LATE_THRESHOLD_MINUTES).toBe(15)
  })

  it('does NOT flag a candidate 14 minutes late', () => {
    expect(isLate(planned, at(14, 59))).toBe(false)
  })

  it('does NOT flag a candidate exactly 15 minutes late (the boundary is "more than")', () => {
    expect(isLate(planned, at(15, 0))).toBe(false)
  })

  it('flags a candidate 16 minutes late', () => {
    expect(isLate(planned, at(15, 1))).toBe(true)
  })

  it('does not flag someone who is early or exactly on time', () => {
    expect(isLate(planned, at(14, 0))).toBe(false)
    expect(isLate(planned, at(14, 45))).toBe(false)
  })

  it('never flags a row with no planned time', () => {
    expect(isLate(null, at(23, 59))).toBe(false)
    expect(isLate('', at(23, 59))).toBe(false)
    expect(isLate('not a time', at(23, 59))).toBe(false)
  })

  it('accepts a custom threshold', () => {
    expect(isLate(planned, at(14, 50), 5)).toBe(false)
    expect(isLate(planned, at(14, 51), 5)).toBe(true)
  })
})

describe('minutesInRoom — the in-room clock', () => {
  const entered = '2026-10-17T12:00:00.000Z'
  const enteredMs = new Date(entered).getTime()

  it('counts whole minutes only', () => {
    expect(minutesInRoom(entered, enteredMs + 19 * 60_000 + 59_000)).toBe(19)
    expect(minutesInRoom(entered, enteredMs + 20 * 60_000)).toBe(20)
  })

  it('flags an interview as running long at exactly 20 minutes', () => {
    expect(ROOM_LONG_THRESHOLD_MINUTES).toBe(20)
    expect(minutesInRoom(entered, enteredMs + 19 * 60_000)).toBeLessThan(ROOM_LONG_THRESHOLD_MINUTES)
    expect(minutesInRoom(entered, enteredMs + 20 * 60_000)).toBeGreaterThanOrEqual(ROOM_LONG_THRESHOLD_MINUTES)
  })

  it('is null when the clock was never started', () => {
    expect(minutesInRoom(null)).toBeNull()
    expect(minutesInRoom(undefined)).toBeNull()
    expect(minutesInRoom('nonsense')).toBeNull()
  })

  it('clamps a future stamp to zero so a fast clock cannot show a negative timer', () => {
    expect(minutesInRoom(entered, enteredMs - 60_000)).toBe(0)
  })

  it('rolls over past an hour', () => {
    expect(minutesInRoom(entered, enteredMs + 75 * 60_000)).toBe(75)
  })
})

describe('formatDuration', () => {
  it('renders minutes, then hours and zero-padded minutes', () => {
    expect(formatDuration(0)).toBe('0m')
    expect(formatDuration(12)).toBe('12m')
    expect(formatDuration(19)).toBe('19m')
    expect(formatDuration(20)).toBe('20m')
    expect(formatDuration(59)).toBe('59m')
    expect(formatDuration(60)).toBe('1h 00m')
    expect(formatDuration(75)).toBe('1h 15m')
  })

  it('renders a dash when there is no clock', () => {
    expect(formatDuration(null)).toBe('—')
  })
})

describe('formatTimestamp', () => {
  it('renders a dash for missing or unparseable values', () => {
    expect(formatTimestamp(null)).toBe('—')
    expect(formatTimestamp('not a date')).toBe('—')
  })

  it('renders a short local clock time', () => {
    expect(formatTimestamp('2026-10-17T12:50:40Z')).toMatch(/\d{1,2}:\d{2}/)
  })
})
