/**
 * Who is in a room, and who is first.
 *
 * This ordering is what decides *whose evaluation is open on screen*, so it is
 * worth pinning down precisely: the in-room clock wins over the arrival stamp,
 * an unknown clock sorts last rather than first, and the answer must not depend
 * on the order the database happened to send the rows in.
 */
import { describe, expect, it } from 'vitest'
import { longestWaitingOccupant, occupantsOf, seatedSince } from '../../src/domain/rooms'

const person = (over = {}) => ({
  id: 'c1',
  name: 'Dana',
  assigned_room: 'r1',
  room_entry_time: null,
  arrival_time: null,
  ...over,
})

describe('occupantsOf', () => {
  it('returns only the people in that room', () => {
    const rows = occupantsOf(
      [
        person({ id: 'c1', name: 'In', assigned_room: 'r1' }),
        person({ id: 'c2', name: 'Elsewhere', assigned_room: 'r2' }),
        person({ id: 'c3', name: 'Waiting', assigned_room: null }),
      ],
      'r1',
    )

    expect(rows.map((row) => row.name)).toEqual(['In'])
  })

  it('orders by the in-room clock, longest first', () => {
    const rows = occupantsOf(
      [
        person({ id: 'c1', name: 'Newest', room_entry_time: '2026-10-17T12:28:00Z' }),
        person({ id: 'c2', name: 'Oldest', room_entry_time: '2026-10-17T12:02:00Z' }),
        person({ id: 'c3', name: 'Middle', room_entry_time: '2026-10-17T12:15:00Z' }),
      ],
      'r1',
    )

    expect(rows.map((row) => row.name)).toEqual(['Oldest', 'Middle', 'Newest'])
  })

  it('is unbothered by the order the rows arrive in', () => {
    const forwards = occupantsOf(
      [
        person({ id: 'c1', name: 'Newest', room_entry_time: '2026-10-17T12:28:00Z' }),
        person({ id: 'c2', name: 'Oldest', room_entry_time: '2026-10-17T12:02:00Z' }),
      ],
      'r1',
    )
    const backwards = occupantsOf(
      [
        person({ id: 'c2', name: 'Oldest', room_entry_time: '2026-10-17T12:02:00Z' }),
        person({ id: 'c1', name: 'Newest', room_entry_time: '2026-10-17T12:28:00Z' }),
      ],
      'r1',
    )

    expect(forwards.map((row) => row.name)).toEqual(backwards.map((row) => row.name))
  })

  it('falls back to the arrival stamp when the in-room clock is missing', () => {
    const rows = occupantsOf(
      [
        person({ id: 'c1', name: 'Stamped', room_entry_time: '2026-10-17T12:20:00Z' }),
        person({ id: 'c2', name: 'Arrived earlier', arrival_time: '2026-10-17T12:05:00Z' }),
      ],
      'r1',
    )

    // The in-room clock (Rule 5 owns it) is used where it exists; a row that
    // predates the column falls back to its arrival stamp. Whichever stamp is
    // earlier is the longer wait, so the 12:05 arrival is ahead of the 12:20
    // entry — the comparison is on the resulting time, not on which column
    // supplied it.
    expect(rows.map((row) => row.name)).toEqual(['Arrived earlier', 'Stamped'])
  })

  it('sorts an unknown wait last, never first', () => {
    const rows = occupantsOf(
      [
        person({ id: 'c1', name: 'No clock' }),
        person({ id: 'c2', name: 'Known', room_entry_time: '2026-10-17T12:20:00Z' }),
      ],
      'r1',
    )

    expect(rows.map((row) => row.name)).toEqual(['Known', 'No clock'])
  })

  it('breaks a tie by name, so the answer is stable', () => {
    const rows = occupantsOf(
      [
        person({ id: 'c1', name: 'Bracha' }),
        person({ id: 'c2', name: 'Aviv' }),
      ],
      'r1',
    )

    expect(rows.map((row) => row.name)).toEqual(['Aviv', 'Bracha'])
  })

  it('is empty for a missing room, a missing room id or an empty board', () => {
    expect(occupantsOf([person()], null)).toEqual([])
    expect(occupantsOf([], 'r1')).toEqual([])
    expect(occupantsOf()).toEqual([])
  })
})

describe('longestWaitingOccupant', () => {
  it('is the head of the room queue', () => {
    const occupant = longestWaitingOccupant(
      [
        person({ id: 'c1', name: 'Newest', room_entry_time: '2026-10-17T12:28:00Z' }),
        person({ id: 'c2', name: 'Oldest', room_entry_time: '2026-10-17T12:02:00Z' }),
      ],
      'r1',
    )

    expect(occupant.name).toBe('Oldest')
  })

  it('is null for an empty room rather than undefined', () => {
    expect(longestWaitingOccupant([person({ assigned_room: 'r2' })], 'r1')).toBeNull()
  })
})

describe('seatedSince', () => {
  it('reads an ISO stamp as milliseconds', () => {
    expect(seatedSince({ room_entry_time: '2026-10-17T12:00:00Z' })).toBe(Date.parse('2026-10-17T12:00:00Z'))
  })

  it('answers MAX_SAFE_INTEGER when there is no usable stamp', () => {
    expect(seatedSince({})).toBe(Number.MAX_SAFE_INTEGER)
    expect(seatedSince({ room_entry_time: 'not a date' })).toBe(Number.MAX_SAFE_INTEGER)
    expect(seatedSince(null)).toBe(Number.MAX_SAFE_INTEGER)
  })
})
