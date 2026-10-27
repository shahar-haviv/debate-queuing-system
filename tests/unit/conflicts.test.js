import { describe, expect, it } from 'vitest'
import {
  blockedInterviewers,
  cleanInterviewerRows,
  conflictingInterviewers,
  constraintLabels,
  constraintsToText,
  hasInterviewerConflict,
  interviewerNames,
  normalizeInterviewerName,
  parseConstraintList,
  roomInterviewers,
} from '../../src/domain/conflicts'

/**
 * A room's panel. Names, or `{ name, phone }` objects, or nothing at all —
 * `room()` is a room with nobody recorded.
 */
const room = (...panel) => ({
  id: 'r1',
  room_name: 'A206',
  room_type: 'Debate',
  interviewers: panel
    .filter((entry) => entry != null)
    .map((entry) => (typeof entry === 'string' ? { name: entry, phone: null } : entry)),
})
const candidate = (constraints) => ({ id: 'c1', name: 'Dana', interviewer_constraints: constraints })

describe('normalizeInterviewerName', () => {
  it('trims and lower-cases', () => {
    expect(normalizeInterviewerName('  DANIEL  ')).toBe('daniel')
    expect(normalizeInterviewerName('Daniel')).toBe('daniel')
  })

  it('treats missing values as an empty name', () => {
    expect(normalizeInterviewerName(null)).toBe('')
    expect(normalizeInterviewerName(undefined)).toBe('')
    expect(normalizeInterviewerName('   ')).toBe('')
  })
})

describe('blockedInterviewers / constraintLabels', () => {
  it('returns an empty list for a candidate with no constraints', () => {
    expect(blockedInterviewers(candidate([]))).toEqual([])
    expect(blockedInterviewers(candidate(null))).toEqual([])
    expect(blockedInterviewers({})).toEqual([])
    expect(blockedInterviewers(undefined)).toEqual([])
  })

  it('does not blow up when the column arrives as a non-array', () => {
    expect(blockedInterviewers({ interviewer_constraints: 'daniel' })).toEqual([])
  })

  it('keeps the case the admin typed for display, but compares case-insensitively', () => {
    const c = candidate(['  DANIEL  ', 'Dana'])
    expect(blockedInterviewers(c)).toEqual(['daniel', 'dana'])
    expect(constraintLabels(c)).toEqual(['DANIEL', 'Dana'])
  })
})

describe('hasInterviewerConflict — Rule 7', () => {
  it('blocks a room whose interviewer is on the list', () => {
    expect(hasInterviewerConflict(room('daniel'), candidate(['daniel']))).toBe(true)
  })

  it('matches ignoring case and surrounding whitespace on both sides', () => {
    expect(hasInterviewerConflict(room('  DANIEL '), candidate(['daniel']))).toBe(true)
    expect(hasInterviewerConflict(room('daniel'), candidate(['  DANIEL ']))).toBe(true)
  })

  it('does not match a different person', () => {
    expect(hasInterviewerConflict(room('Dana'), candidate(['daniel']))).toBe(false)
    expect(hasInterviewerConflict(room('danny'), candidate(['daniel']))).toBe(false)
  })

  it('names the exact case from the spec: ["John Doe","Jane Smith"] blocks Jane Smith', () => {
    const c = candidate(['John Doe', 'Jane Smith'])
    expect(hasInterviewerConflict(room('Jane Smith'), c)).toBe(true)
    expect(hasInterviewerConflict(room('jane smith'), c)).toBe(true)
    expect(hasInterviewerConflict(room('JANE SMITH'), c)).toBe(true)
    expect(hasInterviewerConflict(room('John Doe'), c)).toBe(true)
    expect(hasInterviewerConflict(room('John Smith'), c)).toBe(false)
  })

  it('a room with no interviewer recorded can never conflict', () => {
    expect(hasInterviewerConflict(room(null), candidate(['daniel']))).toBe(false)
    expect(hasInterviewerConflict(room(), candidate(['daniel']))).toBe(false)
    expect(hasInterviewerConflict(room({ name: '   ', phone: '1' }), candidate(['daniel']))).toBe(false)
    expect(hasInterviewerConflict({ id: 'r1' }, candidate(['daniel']))).toBe(false)
  })

  it('a candidate with no constraints can go anywhere', () => {
    expect(hasInterviewerConflict(room('daniel'), candidate([]))).toBe(false)
    expect(hasInterviewerConflict(room('daniel'), null)).toBe(false)
  })
})

describe('hasInterviewerConflict over a panel — one bad name disqualifies the room', () => {
  it('blocks when the only interviewer is restricted', () => {
    expect(hasInterviewerConflict(room('daniel'), candidate(['daniel']))).toBe(true)
  })

  it('blocks a partial panel conflict, wherever the name sits in the array', () => {
    const c = candidate(['daniel'])
    expect(hasInterviewerConflict(room('daniel', 'Romi'), c)).toBe(true)
    expect(hasInterviewerConflict(room('Romi', 'daniel'), c)).toBe(true)
    expect(hasInterviewerConflict(room('Romi', 'Yael', 'daniel', 'Noa'), c)).toBe(true)
  })

  it('allows a panel of strangers', () => {
    expect(hasInterviewerConflict(room('Romi', 'Yael'), candidate(['daniel']))).toBe(false)
  })

  it('matches a multi-word panel member case-insensitively', () => {
    const c = candidate(['Jane Smith'])
    expect(hasInterviewerConflict(room('John Doe', '  jane smith '), c)).toBe(true)
    expect(hasInterviewerConflict(room('John Doe', 'Jane Smithson'), c)).toBe(false)
  })

  it('reports exactly who is the problem', () => {
    const c = candidate(['daniel', 'Romi'])
    expect(conflictingInterviewers(room('Romi', 'Yael', 'daniel'), c)).toEqual(['Romi', 'daniel'])
    expect(conflictingInterviewers(room('Yael'), c)).toEqual([])
    expect(conflictingInterviewers(room(), c)).toEqual([])
  })

  it('accepts a bare string in the array as a name', () => {
    expect(hasInterviewerConflict({ id: 'r1', interviewers: ['daniel'] }, candidate(['daniel']))).toBe(true)
  })

  it('never explodes on a half-migrated row', () => {
    expect(hasInterviewerConflict({ id: 'r1', interviewers: null }, candidate(['daniel']))).toBe(false)
    expect(hasInterviewerConflict({ id: 'r1', interviewers: 'daniel' }, candidate(['daniel']))).toBe(false)
    expect(hasInterviewerConflict(null, candidate(['daniel']))).toBe(false)
  })
})

describe('roomInterviewers — reading a panel safely', () => {
  it('returns name and phone rows in the stored order', () => {
    expect(roomInterviewers(room({ name: 'Romi', phone: '050-1' }, { name: 'Yael', phone: null }))).toEqual([
      { name: 'Romi', phone: '050-1' },
      { name: 'Yael', phone: '' },
    ])
    expect(interviewerNames(room({ name: 'Romi', phone: null }, 'daniel'))).toEqual(['Romi', 'daniel'])
  })

  it('drops blanks and collapses case-insensitive duplicates, first spelling wins', () => {
    const messy = room({ name: '  ', phone: 'x' }, { name: ' Romi ', phone: ' 050 ' }, { name: 'romi', phone: null })
    expect(roomInterviewers(messy)).toEqual([{ name: 'Romi', phone: '050' }])
  })

  it('is empty for anything that is not a panel', () => {
    expect(roomInterviewers({})).toEqual([])
    expect(roomInterviewers({ interviewers: null })).toEqual([])
    expect(roomInterviewers(null)).toEqual([])
  })

  it('treats a missing name or phone key as empty', () => {
    expect(roomInterviewers(room({ phone: '050-1' }))).toEqual([])
    expect(roomInterviewers(room({ name: 'Romi' }))).toEqual([{ name: 'Romi', phone: '' }])
  })
})

describe('constraintLabels', () => {
  it('returns an empty list when the column is missing or not an array', () => {
    expect(constraintLabels({})).toEqual([])
    expect(constraintLabels(null)).toEqual([])
    expect(constraintLabels({ interviewer_constraints: 'daniel' })).toEqual([])
  })
})

describe('cleanInterviewerRows — what the editor sends', () => {
  it('trims, collapses duplicates and keeps an empty phone as null', () => {
    expect(
      cleanInterviewerRows([
        { name: '  Romi ', phone: ' 050-1 ' },
        { name: 'romi', phone: '050-2' },
        { name: '   ', phone: '050-3' },
        { name: 'Yael', phone: '   ' },
      ]),
    ).toEqual([
      { name: 'Romi', phone: '050-1' },
      { name: 'Yael', phone: null },
    ])
  })

  it('handles an empty or missing row list', () => {
    expect(cleanInterviewerRows([])).toEqual([])
    expect(cleanInterviewerRows(null)).toEqual([])
    expect(cleanInterviewerRows([{ name: '' }])).toEqual([])
  })

  it('treats a missing phone or name key as empty', () => {
    expect(cleanInterviewerRows([{ name: 'Romi' }])).toEqual([{ name: 'Romi', phone: null }])
    expect(cleanInterviewerRows([{ phone: '050-1' }])).toEqual([])
  })
})

describe('parseConstraintList — the modal input', () => {
  it('splits on commas and newlines and trims each name', () => {
    expect(parseConstraintList('daniel, Dana')).toEqual(['daniel', 'Dana'])
    expect(parseConstraintList('daniel\nDana')).toEqual(['daniel', 'Dana'])
    expect(parseConstraintList('  daniel , DANA ,daniel ')).toEqual(['daniel', 'DANA'])
  })

  it('drops blanks and collapses case-insensitive duplicates, keeping the first spelling', () => {
    expect(parseConstraintList('daniel,,dANIEL, ,Dana')).toEqual(['daniel', 'Dana'])
    expect(parseConstraintList('')).toEqual([])
    expect(parseConstraintList(null)).toEqual([])
    expect(parseConstraintList('   ,  , ')).toEqual([])
  })

  it('keeps multi-word names intact', () => {
    expect(parseConstraintList('Jane Smith, John Doe')).toEqual(['Jane Smith', 'John Doe'])
  })
})

describe('constraintsToText — the round trip', () => {
  it('renders an existing list back into the input', () => {
    expect(constraintsToText(candidate(['DANA', 'daniel']))).toBe('DANA, daniel')
  })

  it('is empty when there is nothing to show', () => {
    expect(constraintsToText(candidate([]))).toBe('')
    expect(constraintsToText({})).toBe('')
    expect(constraintsToText(null)).toBe('')
  })

  it('survives a parse → text → parse cycle without drift', () => {
    const once = parseConstraintList('  daniel , DANA ,daniel ')
    expect(once).toEqual(['daniel', 'DANA'])
    expect(parseConstraintList(constraintsToText(candidate(once)))).toEqual(once)
  })
})
