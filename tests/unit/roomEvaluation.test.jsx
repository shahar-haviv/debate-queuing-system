/**
 * The in-room rubric view, driven through the real page.
 *
 * `evaluation.test.js` proves the questionnaire. This file proves the wiring in
 * `RoomView.jsx`: that the form appears only for a Personal Interview, that it is
 * filled in from the board, that a half-filled form cannot be submitted, and —
 * the part that matters most operationally — that submitting files the scores
 * *and* releases the room, while skipping releases it without filing anything.
 *
 * So the board is a live store and the "database" answers the three queries the
 * page really makes: the room's filed evaluations on mount, the evaluation
 * upsert, and the `personal_interview_completed` update that releases the room.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RoomView from '../../src/pages/RoomView.jsx'

/* ------------------------------- the board ------------------------------- */

const board = vi.hoisted(() => {
  const listeners = new Set()
  const state = {
    candidates: [],
    rooms: [],
    loading: false,
    error: '',
    version: 0,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    snapshot() {
      return state.version
    },
    push() {
      state.version += 1
      listeners.forEach((fn) => fn())
    },
    reset(candidates = [], rooms = []) {
      state.candidates = candidates
      state.rooms = rooms
    },
  }
  return state
})

/** What the mock database was asked to do, for the assertions to read back. */
const db = vi.hoisted(() => ({
  filed: [],
  saved: [],
  released: [],
  reset() {
    db.filed = []
    db.saved = []
    db.released = []
  },
}))

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'admin@example.com' }, signOut: async () => {} }),
}))

vi.mock('../../src/hooks/useCandidates', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useCandidates: () => {
      useSyncExternalStore(board.subscribe, board.snapshot, board.snapshot)
      return {
        candidates: board.candidates,
        rooms: board.rooms,
        loading: board.loading,
        error: board.error,
        reload: async () => {},
        patchLocal: () => {},
        addLocal: () => {},
        removeLocal: () => {},
        patchRoomLocal: () => {},
        addRoomLocal: () => {},
        removeRoomLocal: () => {},
      }
    },
  }
})

/**
 * A tiny PostgREST stand-in for the three calls the page makes.
 *
 * `evaluations.select(...).eq('room_id',…).order(...).limit(n)` is the mount
 * read, `evaluations.upsert(...)` is the save, and
 * `candidates.update(...).eq('id',…).select().single()` is the release.
 */
vi.mock('../../src/lib/supabase', () => {
  const evaluations = () => {
    const query = { room: null }
    const api = {
      select: () => api,
      eq: (column, value) => {
        if (column === 'room_id') query.room = value
        return api
      },
      order: () => api,
      limit: () =>
        Promise.resolve({
          data: db.filed.filter((row) => !query.room || row.room_id === query.room),
          error: null,
        }),
      upsert: (values) => {
        db.saved.push(values)
        return Promise.resolve({ data: values, error: null })
      },
      then: (resolve, reject) => api.limit().then(resolve, reject),
    }
    return api
  }

  const candidates = () => {
    const query = { id: null, patch: null }
    const api = {
      update: (patch) => {
        query.patch = patch
        return api
      },
      eq: (column, value) => {
        if (column === 'id') query.id = value
        return api
      },
      select: () => api,
      single: () => {
        db.released.push({ id: query.id, patch: query.patch })
        return Promise.resolve({ data: { id: query.id, ...query.patch }, error: null })
      },
      then: (resolve, reject) => api.single().then(resolve, reject),
    }
    return api
  }

  return {
    isConfigured: true,
    supabase: { from: (table) => (table === 'evaluations' ? evaluations() : candidates()) },
  }
})

/* ------------------------------- fixtures -------------------------------- */

const room = (over = {}) => ({
  id: 'r1',
  room_name: 'CL05',
  room_type: 'Personal',
  interviewers: [],
  ...over,
})

const person = (over = {}) => ({
  id: 'c1',
  name: 'Dana Cohen',
  serial_number: '1042',
  has_arrived: true,
  assigned_room: 'r1',
  current_task_assignment: 'Personal Interview',
  room_entry_time: '2026-10-17T12:00:00Z',
  debate_interview_completed: true,
  personal_interview_completed: false,
  interviewer_constraints: [],
  ...over,
})

function setup({ rooms = [room()], candidates = [person()], roomId = 'r1', filed = [] } = {}) {
  board.reset(candidates, rooms)
  db.reset()
  // Seeded after the reset, so a test can hand the page a history to read.
  db.filed = filed
  const view = render(
    <MemoryRouter initialEntries={[`/room/${roomId}`]}>
      <Routes>
        <Route path="/room/:roomId" element={<RoomView />} />
      </Routes>
    </MemoryRouter>,
  )
  return view
}

/** Answer every mandatory question, so the form is submit-ready. */
function completeForm() {
  const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

  type('מי מראיין?', 'Romi')
  type('שם מלא של המועמד', 'Dana Cohen')
  type('מספר מרואיין', '1042')
  type('מסלול לימודים', 'Law')
  type('שנים שנותרו לתואר', '2')
  type('האם יש לך ניסיון קודם בדיבייט/דוברות/רטוריקה/הדרכה', 'none')
  type(
    'הקורס מתקיים בימי שני, בין השעות 17:30 ועד 21:00. האם יש איזה שהן התנגשויות שיכולות להיות לך? (קורסים מתנגשים, התנדבויות, מילואים..)',
    'no',
  )
  type('למה אתה רוצה להיות במועדון הדיבייט?', 'debate')
  type('ספר לנו קצת על עצמך', 'hello')
  type('מה אתם עושים בזמנכם הפנוי, האם אתם עובדים ובמה', 'work')

  // The two mandatory ratings.
  fireEvent.click(screen.getByRole('radio', { name: 'זמינות ומחוייבות — 4' }))
  fireEvent.click(screen.getByRole('radio', { name: 'וייב של בן אדם והתאמה למועדון — 5' }))
}

/* -------------------------------- the form ------------------------------- */

describe('RoomView — which rubric is on screen', () => {
  it('opens the Personal Interview rubric for a candidate in a Personal Interview', async () => {
    setup()

    expect(await screen.findByText('מי מראיין?')).toBeInTheDocument()
    // The exact wording, not a paraphrase.
    expect(screen.getByText('שנים שנותרו לתואר')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Submit Evaluation & Release Room' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Skip Digital Feedback & Release Room' }),
    ).toBeInTheDocument()
  })

  it('renders the form right-to-left, as Hebrew requires', async () => {
    const { container } = setup()
    await screen.findByText('מי מראיין?')

    const form = container.querySelector('form')
    expect(form).toHaveAttribute('dir', 'rtl')
    expect(form).toHaveAttribute('lang', 'he')
  })

  it('shows all four parts, with their headers', async () => {
    setup()
    await screen.findByText('מי מראיין?')

    expect(screen.getByText('חלק 1 — פרטים כלליים')).toBeInTheDocument()
    expect(screen.getByText('חלק 3 — מחויבות')).toBeInTheDocument()
    // These two carry an intro line instead of an invented heading.
    expect(screen.getByText(/חלק זה נועד לבדוק את המרואיינים/)).toBeInTheDocument()
    expect(screen.getByText('את החלק הזה אתם עושים אחרי שהמרואיין יצא מהחדר.')).toBeInTheDocument()
    expect(
      screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === 'חלק 4'),
    ).toBeInTheDocument()
  })

  it('offers no digital form for a Debate Interview', async () => {
    setup({ candidates: [person({ current_task_assignment: 'Debate Interview' })] })

    expect(await screen.findByText(/is in a Debate Interview/)).toBeInTheDocument()
    expect(screen.queryByText('מי מראיין?')).not.toBeInTheDocument()
  })

  it('says the room is empty rather than showing a form with no candidate', async () => {
    setup({ candidates: [] })

    expect(await screen.findByText(/Nobody is in this room/)).toBeInTheDocument()
    expect(screen.queryByText('מי מראיין?')).not.toBeInTheDocument()
  })

  it('explains a room that no longer exists', async () => {
    setup({ rooms: [], candidates: [], roomId: 'gone' })

    expect(await screen.findByText('Room not found')).toBeInTheDocument()
  })
})

describe('RoomView — filling it in', () => {
  it('pre-fills the candidate name and serial number from the board', async () => {
    setup()
    await screen.findByText('מי מראיין?')

    expect(screen.getByLabelText('שם מלא של המועמד')).toHaveValue('Dana Cohen')
    expect(screen.getByLabelText('מספר מרואיין')).toHaveValue('1042')
    // The panel is empty, so nobody can be assumed — the interviewer types it.
    expect(screen.getByLabelText('מי מראיין?')).toHaveValue('')
  })

  it('fills in every interviewer the room names, joined', async () => {
    setup({
      rooms: [room({ interviewers: [{ name: 'Romi', phone: '050' }, { name: 'Yael', phone: null }] })],
    })
    await screen.findByText('מי מראיין?')

    expect(screen.getByLabelText('מי מראיין?')).toHaveValue('Romi, Yael')
  })

  it('writes the rubric for the candidate who has been in the room longest', async () => {
    setup({
      candidates: [
        person({ id: 'c1', name: 'Newest', room_entry_time: '2026-10-17T12:28:00Z' }),
        person({ id: 'c2', name: 'Oldest', room_entry_time: '2026-10-17T12:02:00Z' }),
      ],
    })

    expect(await screen.findByText('מי מראיין?')).toBeInTheDocument()
    expect(screen.getByLabelText('שם מלא של המועמד')).toHaveValue('Oldest')
    // The other one is shown as next in the room, not evaluated.
    const queue = screen.getByText('next in the room').closest('li')
    expect(queue).toHaveTextContent('Newest')
  })

  it('will not file a half-filled form, and names what is missing', async () => {
    setup()
    await screen.findByText('מי מראיין?')

    fireEvent.submit(screen.getByRole('button', { name: 'Submit Evaluation & Release Room' }).closest('form'))

    await waitFor(() => expect(screen.getAllByText('שדה חובה').length).toBeGreaterThan(0))
    // Nothing was written, and the room still holds the candidate.
    expect(db.saved).toHaveLength(0)
    expect(db.released).toHaveLength(0)
  })

  it('clears a field\'s error once it is answered', async () => {
    setup()
    await screen.findByText('מי מראיין?')

    fireEvent.submit(screen.getByRole('button', { name: 'Submit Evaluation & Release Room' }).closest('form'))
    await waitFor(() => expect(screen.getAllByText('שדה חובה').length).toBeGreaterThan(0))

    fireEvent.change(screen.getByLabelText('מי מראיין?'), { target: { value: 'Romi' } })

    const field = screen.getByLabelText('מי מראיין?').closest('div')
    expect(within(field).queryByText('שדה חובה')).not.toBeInTheDocument()
  })
})

describe('RoomView — filing the evaluation', () => {
  /*
   * Filling the whole rubric is ~22 real interactions, and coverage
   * instrumentation multiplies that; the default 5s budget is not enough for the
   * tests that answer every mandatory question. The ones that only submit a
   * partial form keep the default.
   */
  const SLOW = 30_000

  it('saves the answers and releases the room by completing the interview', async () => {
    setup()
    await screen.findByText('מי מראיין?')
    completeForm()

    fireEvent.submit(screen.getByRole('button', { name: 'Submit Evaluation & Release Room' }).closest('form'))

    await waitFor(() => expect(db.saved).toHaveLength(1))
    const saved = db.saved[0]
    expect(saved).toMatchObject({
      candidate_id: 'c1',
      room_id: 'r1',
      task: 'Personal Interview',
      interviewer_name: 'Romi',
      submitted_by: 'admin@example.com',
    })

    // Numbers are stored as numbers, and every key is present.
    expect(saved.scores.rating_availability).toBe(4)
    expect(saved.scores.rating_vibe).toBe(5)
    expect(saved.scores.years_remaining).toBe(2)
    expect(saved.scores.candidate_name).toBe('Dana Cohen')
    expect(saved.scores.rating_competitiveness).toBeNull()

    // The release is the interview being marked complete — Rule 3 clears the room.
    expect(db.released).toEqual([{ id: 'c1', patch: { personal_interview_completed: true } }])
  }, SLOW)

  it('confirms afterwards and shows the answers back', async () => {
    setup()
    await screen.findByText('מי מראיין?')
    completeForm()

    fireEvent.submit(screen.getByRole('button', { name: 'Submit Evaluation & Release Room' }).closest('form'))

    expect(await screen.findByText(/ההערכה של Dana Cohen נשמרה/)).toBeInTheDocument()
    expect(screen.getByText('Romi')).toBeInTheDocument()
    expect(screen.queryByLabelText('מי מראיין?')).not.toBeInTheDocument()
  }, SLOW)

  it('keeps that confirmation on screen after the release empties the room', async () => {
    setup()
    await screen.findByText('מי מראיין?')
    completeForm()

    fireEvent.submit(screen.getByRole('button', { name: 'Submit Evaluation & Release Room' }).closest('form'))
    await screen.findByText(/ההערכה של Dana Cohen נשמרה/)

    // This is what the database does next: completing the interview clears the
    // room, so the candidate the recap is about is no longer in it. Losing the
    // confirmation at that moment is exactly when the interviewer needs it most.
    await act(async () => {
      board.reset(
        [person({ assigned_room: null, current_task_assignment: null, personal_interview_completed: true })],
        [room()],
      )
      board.push()
    })

    expect(await screen.findByText(/ההערכה של Dana Cohen נשמרה/)).toBeInTheDocument()
    expect(screen.getByText('Romi')).toBeInTheDocument()
  }, SLOW)

  it('drops the recap once a different candidate turns up in the room', async () => {
    setup()
    await screen.findByText('מי מראיין?')
    completeForm()

    fireEvent.submit(screen.getByRole('button', { name: 'Submit Evaluation & Release Room' }).closest('form'))
    await screen.findByText(/ההערכה של Dana Cohen נשמרה/)

    // Somebody else is seated: the recap was about Dana, and Dana has gone.
    await act(async () => {
      board.reset(
        [
          person({
            id: 'c2',
            name: 'Gil Amir',
            serial_number: '2000',
            personal_interview_completed: false,
          }),
        ],
        [room()],
      )
      board.push()
    })

    expect(await screen.findByText('מי מראיין?')).toBeInTheDocument()
    expect(screen.getByLabelText('שם מלא של המועמד')).toHaveValue('Gil Amir')
    expect(screen.queryByText(/ההערכה של Dana Cohen נשמרה/)).not.toBeInTheDocument()
  }, SLOW)

  it('releases the room without filing anything when the feedback is skipped', async () => {
    setup()
    await screen.findByText('מי מראיין?')

    fireEvent.click(screen.getByRole('button', { name: 'Skip Digital Feedback & Release Room' }))

    await waitFor(() => expect(db.released).toHaveLength(1))
    expect(db.released[0]).toEqual({ id: 'c1', patch: { personal_interview_completed: true } })
    expect(db.saved).toHaveLength(0)
    expect(await screen.findByText(/was released without an evaluation/)).toBeInTheDocument()
  })

  it('asks before throwing away typing, and obeys a "no"', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    setup()
    await screen.findByText('מי מראיין?')
    fireEvent.change(screen.getByLabelText('מי מראיין?'), { target: { value: 'Romi' } })

    fireEvent.click(screen.getByRole('button', { name: 'Skip Digital Feedback & Release Room' }))

    expect(confirm).toHaveBeenCalled()
    // Refused: nothing was released and the typing is still on screen.
    expect(db.released).toHaveLength(0)
    expect(screen.getByLabelText('מי מראיין?')).toHaveValue('Romi')
  })

  it('does not nag when the form was never touched', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    setup()
    await screen.findByText('מי מראיין?')

    fireEvent.click(screen.getByRole('button', { name: 'Skip Digital Feedback & Release Room' }))

    await waitFor(() => expect(db.released).toHaveLength(1))
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('RoomView — what was already filed', () => {
  const filed = [
    {
      id: 'e1',
      candidate_id: 'c9',
      room_id: 'r1',
      task: 'Personal Interview',
      interviewer_name: 'Yael',
      scores: { candidate_name: 'Earlier Candidate', study_track: 'Philosophy', rating_vibe: 5 },
      created_at: '2026-10-17T11:00:00Z',
      candidate: { name: 'Earlier Candidate', serial_number: '999' },
    },
    {
      id: 'e2',
      candidate_id: 'c8',
      room_id: 'r2',
      task: 'Personal Interview',
      interviewer_name: 'Someone',
      scores: {},
      created_at: '2026-10-17T10:00:00Z',
      candidate: { name: 'Other Room' },
    },
  ]

  it("lists the room's filed evaluations, collapsed", async () => {
    setup({ filed })

    await screen.findByText('Filed in this room')

    expect(screen.getByText('Earlier Candidate')).toBeInTheDocument()
    // Another room's evaluations are none of this room's business.
    expect(screen.queryByText('Other Room')).not.toBeInTheDocument()
    expect(screen.getByText(/Yael/)).toBeInTheDocument()
  })

  it('expands one to read the answers without leaving the room', async () => {
    setup({ filed })

    await screen.findByText('Filed in this room')

    fireEvent.click(screen.getByRole('button', { name: /Earlier Candidate/ }))

    expect(screen.getByText('Philosophy')).toBeInTheDocument()
    // A question they skipped says so rather than showing an empty gap.
    expect(screen.getAllByText('לא הוזן').length).toBeGreaterThan(0)
  })
})
