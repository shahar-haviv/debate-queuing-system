/**
 * The candidate's own screen is the one page a stranger can open, so it is worth
 * asserting two things separately:
 *
 *   1. what the page *asks the API for* (these queries are the network requests),
 *   2. what it *renders* when the API answers with more than it asked for.
 *
 * Point 2 is the realistic threat: the page must be safe even if somebody
 * widens the query later or the server hands back a fatter row than expected.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CandidateView from '../../src/pages/CandidateView.jsx'

const state = vi.hoisted(() => ({
  candidate: null,
  room: null,
  selects: [],
}))

vi.mock('../../src/lib/supabase', () => {
  const query = (table) => ({
    _table: table,
    select(cols) {
      state.selects.push({ table, cols })
      return this
    },
    eq() {
      return this
    },
    maybeSingle() {
      return Promise.resolve({ data: table === 'candidates' ? state.candidate : state.room, error: null })
    },
  })

  return {
    isConfigured: true,
    supabase: {
      from: (table) => query(table),
      channel: () => {
        const channel = { on: () => channel, subscribe: () => channel }
        return channel
      },
      removeChannel: () => {},
    },
  }
})

/** Fields a careless client might leak. None may ever reach the DOM. */
const FORBIDDEN = ['serial_number', 'phone_number', 'room_entry_time', 'interviewer_constraints']

const SECRET_ROW = {
  name: 'Dana Cohen',
  planned_time: '09:30',
  arrival_time: '2026-10-17T12:50:40Z',
  assigned_room: null,
  current_task_assignment: null,
  debate_interview_completed: false,
  personal_interview_completed: false,
  // Deliberately over-shared, to prove the page ignores it:
  serial_number: 'ZZ-SECRET-SERIAL',
  phone_number: '050-9999999',
  room_entry_time: '2026-10-17T12:00:00Z',
  interviewer_constraints: ['daniel'],
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/candidate/c1']}>
      <Routes>
        <Route path="/candidate/:id" element={<CandidateView />} />
      </Routes>
    </MemoryRouter>,
  )

const candidatesSelect = () => state.selects.find((s) => s.table === 'candidates')?.cols
const roomsSelect = () => state.selects.find((s) => s.table === 'rooms')?.cols

describe('CandidateView — what it asks the API for', () => {
  it('never requests a serial number, a phone number or interviewer data', async () => {
    state.selects = []
    state.candidate = SECRET_ROW
    state.room = null
    renderPage()
    await screen.findByText('Please wait, you are in the queue.')

    const cols = candidatesSelect()
    expect(cols).toBe(
      'name, planned_time, arrival_time, assigned_room, current_task_assignment, debate_interview_completed, personal_interview_completed',
    )
    for (const field of FORBIDDEN) {
      expect(cols).not.toContain(field)
    }
    expect(cols).not.toContain('interviewer')
  })

  it('asks the rooms table for exactly the three columns the page renders', async () => {
    state.selects = []
    state.candidate = { ...SECRET_ROW, assigned_room: 'a206' }
    state.room = { id: 'a206', room_name: 'A206', room_type: 'Debate' }
    renderPage()
    await screen.findByText(/Please proceed to A206/)

    expect(roomsSelect()).toBe('id, room_name, room_type')
    expect(roomsSelect()).not.toContain('interviewer')
  })
})

describe('CandidateView — what it renders', () => {
  it('never renders a field the query did not ask for, even when the server sends it', async () => {
    state.selects = []
    state.candidate = SECRET_ROW
    state.room = null
    const { container } = renderPage()
    await screen.findByText('Please wait, you are in the queue.')

    const text = container.textContent
    expect(text).not.toContain('ZZ-SECRET-SERIAL')
    expect(text).not.toContain('050-9999999')
    expect(text).not.toContain('daniel')
    expect(text).toContain('Dana Cohen')
  })

  it('sends a candidate with a room to that room, and names the interview', async () => {
    state.candidate = {
      ...SECRET_ROW,
      assigned_room: 'a206',
      current_task_assignment: 'Debate Interview',
    }
    state.room = { id: 'a206', room_name: 'A206', room_type: 'Debate' }
    renderPage()

    expect(await screen.findByText('Please proceed to A206')).toBeInTheDocument()
    expect(screen.getByText('for your Debate Interview')).toBeInTheDocument()
  })

  it('tells a candidate with no room to wait', async () => {
    state.candidate = SECRET_ROW
    state.room = null
    renderPage()
    expect(await screen.findByText('Please wait, you are in the queue.')).toBeInTheDocument()
  })

  it('shows the progress badges as Pending / Done', async () => {
    state.candidate = { ...SECRET_ROW, debate_interview_completed: true }
    state.room = null
    renderPage()
    await screen.findByText('Please wait, you are in the queue.')

    expect(screen.getByText('Debate Interview').parentElement).toHaveTextContent('✓ Done')
    expect(screen.getByText('Personal Interview').parentElement).toHaveTextContent('Pending')
  })

  it('congratulates a candidate who is fully finished rather than sending them to a room', async () => {
    state.candidate = {
      ...SECRET_ROW,
      assigned_room: 'a206',
      debate_interview_completed: true,
      personal_interview_completed: true,
    }
    state.room = { id: 'a206', room_name: 'A206', room_type: 'Debate' }
    renderPage()

    expect(await screen.findByText('All done — thank you!')).toBeInTheDocument()
    expect(screen.queryByText(/Please proceed to/)).not.toBeInTheDocument()
  })

  it('falls back to a plain "not found" card for a dead link', async () => {
    state.candidate = null
    state.room = null
    renderPage()
    expect(await screen.findByText('Candidate not found')).toBeInTheDocument()
  })

  it('carries no branding and no staff chrome', async () => {
    state.candidate = SECRET_ROW
    state.room = null
    const { container } = renderPage()
    await screen.findByText('Please wait, you are in the queue.')

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByText(/Debug/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /admin/i })).not.toBeInTheDocument()
  })
})
