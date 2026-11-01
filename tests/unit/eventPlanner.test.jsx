/**
 * The three-step planner.
 *
 * The event is only created at the end. This test drives the real form through
 * details and room allocation, then asserts the exact plan handed to the
 * orchestrator — including the fact that the rooms are still client-side keys
 * until `useEventPlanner` writes them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import EventPlanner from '../../src/pages/EventPlanner'

const state = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('../../src/hooks/useEventPlanner', () => ({
  useEventPlanner: () => ({ create: state.create }),
}))

function renderPlanner() {
  return render(
    <MemoryRouter initialEntries={['/admin/event/new']}>
      <Routes>
        <Route path="/admin/event/new" element={<EventPlanner />} />
        <Route path="/admin/event/:id/queue" element={<p>Queue ready</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  state.create.mockReset()
  state.create.mockResolvedValue({
    event: {
      id: 'event-new',
      name: 'Fall Tryouts',
      date: '2026-12-01',
      status: 'Draft',
      notes: '',
      created_at: '2026-10-01T00:00:00Z',
    },
    imported: 0,
    duplicates: 0,
  })
})

describe('EventPlanner', () => {
  it('requires a name and date before moving on', () => {
    renderPlanner()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Give the event a name and a date')

    fireEvent.change(screen.getByLabelText(/Event name/), { target: { value: 'Fall Tryouts' } })
    fireEvent.change(screen.getByLabelText(/Date/), { target: { value: '2026-12-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('heading', { name: 'Room allocation' })).toBeInTheDocument()
  })

  it('creates the event with its rooms only on the final action', async () => {
    renderPlanner()

    fireEvent.change(screen.getByLabelText(/Event name/), { target: { value: 'Fall Tryouts' } })
    fireEvent.change(screen.getByLabelText(/Date/), { target: { value: '2026-12-01' } })
    fireEvent.change(screen.getByLabelText(/Internal notes/), {
      target: { value: 'Panel briefing at 16:00.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    fireEvent.change(screen.getByLabelText('Room name'), { target: { value: 'A206' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'Debate' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add room' }))
    expect(screen.getByText(/1 room · 0 interviewers assigned/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { name: 'Roster import' })).toBeInTheDocument()

    // Nothing has been written yet.
    expect(state.create).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Create event' }))

    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1))
    expect(state.create).toHaveBeenCalledWith({
      name: 'Fall Tryouts',
      date: '2026-12-01',
      notes: 'Panel briefing at 16:00.',
      rooms: [
        expect.objectContaining({
          room_name: 'A206',
          room_type: 'Debate',
          interviewers: [],
        }),
      ],
      candidates: [],
    })

    expect(await screen.findByText('Queue ready')).toBeInTheDocument()
  })
})
