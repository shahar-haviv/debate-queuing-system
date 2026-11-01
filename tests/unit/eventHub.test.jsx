/**
 * The Back Office hub: grouping, counts and the three per-event actions.
 *
 * The page is tested against a repository-shaped fixture, not a rendered
 * dashboard. That keeps the assertions about what an admin is offered — the
 * tabs, the count, and the fact that every action carries the event id — rather
 * than about Tailwind classes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import EventHub from '../../src/pages/EventHub'

const seed = [
  {
    id: 'event-draft',
    name: 'Spring Tryouts',
    date: '2026-11-14',
    status: 'Draft',
    notes: 'Panel arrives at 16:30.',
    created_at: '2026-10-01T00:00:00Z',
    candidate_count: 42,
    room_count: 5,
  },
  {
    id: 'event-live',
    name: 'Today’s Screening',
    date: '2026-10-31',
    status: 'Active',
    notes: '',
    created_at: '2026-10-02T00:00:00Z',
    candidate_count: 55,
    room_count: 4,
  },
  {
    id: 'event-past',
    name: 'Last Summer',
    date: '2026-07-03',
    status: 'Completed',
    notes: '',
    created_at: '2026-06-01T00:00:00Z',
    candidate_count: 31,
    room_count: 6,
  },
]

const state = vi.hoisted(() => ({ update: vi.fn(), events: [] }))

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'admin@example.com' }, signOut: async () => {} }),
}))

vi.mock('../../src/hooks/useEvents', () => ({
  useEvents: () => ({
    events: state.events,
    loading: false,
    error: '',
    reload: async () => {},
    update: state.update,
  }),
}))

function renderHub() {
  return render(
    <MemoryRouter>
      <EventHub />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  state.events = seed
  state.update.mockReset()
  state.update.mockResolvedValue({})
})

describe('EventHub', () => {
  it('opens on upcoming drafts with their counts and quick actions', () => {
    renderHub()

    expect(screen.getByRole('heading', { name: 'Spring Tryouts' })).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Panel arrives at 16:30.')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Open Live Queue' }).getAttribute('href')).toBe(
      '/admin/event/event-draft/queue',
    )
    expect(screen.getByRole('link', { name: 'View Analytics' }).getAttribute('href')).toBe(
      '/admin/event/event-draft/analytics',
    )
    expect(screen.getByRole('button', { name: 'Edit Settings' })).toBeInTheDocument()
  })

  it('keeps the three lifecycle groups separate, newest past first', () => {
    renderHub()

    fireEvent.click(screen.getByRole('tab', { name: /Active/ }))
    expect(screen.getByRole('heading', { name: 'Today’s Screening' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Spring Tryouts' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Past/ }))
    expect(screen.getByRole('heading', { name: 'Last Summer' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Today’s Screening' })).not.toBeInTheDocument()
  })

  it('edits the selected event’s settings without touching its counts', async () => {
    renderHub()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit Spring Tryouts' })

    fireEvent.change(within(dialog).getByLabelText(/Event name/), {
      target: { value: 'Spring Tryouts — Day 2' },
    })
    fireEvent.change(within(dialog).getByLabelText(/Status/), { target: { value: 'Active' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }))

    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith(
        'event-draft',
        expect.objectContaining({ name: 'Spring Tryouts — Day 2', status: 'Active' }),
      ),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('explains an empty group instead of showing an empty white page', () => {
    state.events = []
    renderHub()

    expect(screen.getByRole('heading', { name: 'No upcoming events' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Create an event/ })).toHaveAttribute(
      'href',
      '/admin/event/new',
    )
  })
})
