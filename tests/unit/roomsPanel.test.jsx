/**
 * The rooms panel: the in-room clock and the live queue.
 *
 * Two things are checked here that the pure `time.js` tests cannot see: that the
 * 20-minute warning is *rendered* (red text + ⚠️) at exactly 20 minutes and not
 * at 19, and that a room's queue empties the instant the app hands it a row with
 * no room on it — which is what completing an interview does.
 *
 * The clock is faked so the boundary is an assertion, not a race.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RoomsPanel from '../../src/components/features/RoomsPanel'

/** A timestamp `h:m` local time on the fake "today", so no timezone can skew it. */
const iso = (h, m, s = 0) => new Date(2026, 9, 17, h, m, s).toISOString()

const room = (over = {}) => ({
  id: 'r1',
  room_name: 'A206',
  room_type: 'Debate',
  interviewers: [],
  ...over,
})

const seated = (over = {}) => ({
  id: 'c1',
  name: 'Dana Cohen',
  has_arrived: true,
  assigned_room: 'r1',
  current_task_assignment: 'Debate Interview',
  room_entry_time: iso(12, 0),
  debate_interview_completed: false,
  personal_interview_completed: false,
  interviewer_constraints: [],
  ...over,
})

function setup(rooms = [room()], candidates = []) {
  const handlers = { onAddRoom: vi.fn(), onUpdateRoom: vi.fn(), onDeleteRoom: vi.fn() }
  // Each room card links to its in-room rubric view, so the panel needs a
  // router in the tree even though no navigation is asserted here.
  const view = render(
    <MemoryRouter>
      <RoomsPanel rooms={rooms} candidates={candidates} busyId={null} {...handlers} />
    </MemoryRouter>,
  )
  return { ...handlers, ...view }
}

/** The `⏱️` element for a room, found by its tooltip so whitespace can't fool us. */
const timerFor = (container, name) =>
  [...container.querySelectorAll('span[title]')].find((node) =>
    (node.getAttribute('title') ?? '').startsWith(`In ${name} for`),
  )

const at = (h, m, s = 0) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 17, h, m, s))
}

describe('RoomsPanel — the in-room timer', () => {
  it('shows whole minutes since the candidate entered the room', () => {
    at(12, 12)
    const { container } = setup([room()], [seated({ room_entry_time: iso(12, 0) })])

    const timer = timerFor(container, 'A206')
    expect(timer).toBeDefined()
    expect(timer).toHaveTextContent('12m')
    expect(timer).not.toHaveClass('text-destructive')
  })

  it('is calm at 19 minutes and red at exactly 20', async () => {
    // 12:19:00 — one minute short of the threshold.
    at(12, 19)
    const { container } = setup([room()], [seated({ room_entry_time: iso(12, 0) })])

    expect(timerFor(container, 'A206')).toHaveTextContent('19m')
    expect(timerFor(container, 'A206')).not.toHaveClass('text-destructive')
    expect(timerFor(container, 'A206')).not.toHaveTextContent('⚠️')

    // One tick later the clock reads 12:20:00 — exactly 20 minutes in the room.
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })

    const atTwenty = timerFor(container, 'A206')
    expect(atTwenty).toHaveTextContent('20m')
    expect(atTwenty).toHaveClass('text-destructive')
    expect(atTwenty).toHaveTextContent('⚠️')
    expect(atTwenty.getAttribute('title')).toContain('running long')

    // And it keeps counting past the warning rather than sticking at 20.
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(timerFor(container, 'A206')).toHaveTextContent('21m')
    expect(timerFor(container, 'A206')).toHaveClass('text-destructive')
  })

  it('shows no timer at all when the clock was never started', () => {
    at(12, 30)
    const { container } = setup([room()], [seated({ room_entry_time: null })])

    expect(timerFor(container, 'A206')).toBeUndefined()
    expect(container).toHaveTextContent('Dana Cohen')
  })

  it('never renders a negative timer when the server clock runs ahead', () => {
    at(12, 0)
    // Entered the room "ten minutes in the future" from the browser's point of view.
    const { container } = setup([room()], [seated({ room_entry_time: iso(12, 10) })])

    expect(timerFor(container, 'A206')).toHaveTextContent('0m')
    expect(timerFor(container, 'A206')).not.toHaveTextContent('-')
  })
})

describe('RoomsPanel — the active queue', () => {
  it('lists exactly the candidates the board says are in the room', () => {
    at(12, 5)
    const { container } = setup(
      [room()],
      [
        seated({ id: 'c1', name: 'Dana Cohen' }),
        seated({ id: 'c2', name: 'Gil Amir', room_entry_time: iso(12, 2), current_task_assignment: 'Personal Interview' }),
        seated({ id: 'c3', name: 'Elsewhere', assigned_room: 'r9' }),
      ],
    )

    const card = container.querySelector('div.rounded-md.border.p-3')
    expect(card).toHaveTextContent('2 active')
    expect(card).toHaveTextContent('Dana Cohen')
    expect(card).toHaveTextContent('Gil Amir')
    // Someone in a different room must not appear, and the task is abbreviated.
    expect(card).not.toHaveTextContent('Elsewhere')
    expect(card).toHaveTextContent('Debate')
    expect(card).toHaveTextContent('Personal')
  })

  it('drops a candidate the moment their room is released', () => {
    at(12, 5)
    const { container, rerender } = setup([room()], [seated()])
    expect(container).toHaveTextContent('1 active')

    // This is the row the app gets after an interview is completed: the trigger
    // (and applyServerRules) nulls assigned_room, current_task and the clock.
    rerender(
      <MemoryRouter>
        <RoomsPanel
          rooms={[room()]}
          candidates={[
            seated({ assigned_room: null, current_task_assignment: null, room_entry_time: null, debate_interview_completed: true }),
          ]}
          busyId={null}
          onAddRoom={() => {}}
          onUpdateRoom={() => {}}
          onDeleteRoom={() => {}}
        />
      </MemoryRouter>,
    )

    expect(container).toHaveTextContent('Empty queue')
    expect(container).not.toHaveTextContent('1 active')
    expect(timerFor(container, 'A206')).toBeUndefined()
  })

  it('says a room is empty rather than showing a blank box', () => {
    at(12, 5)
    const { container } = setup([room()], [])
    expect(container).toHaveTextContent('Empty queue')
  })

  it('puts the person who has been in the room longest at the top', () => {
    at(12, 30)
    const { container } = setup(
      [room()],
      [
        seated({ id: 'c1', name: 'Just arrived', room_entry_time: iso(12, 28) }),
        seated({ id: 'c2', name: 'Waiting longest', room_entry_time: iso(12, 2) }),
        seated({ id: 'c3', name: 'In the middle', room_entry_time: iso(12, 15) }),
      ],
    )

    const card = container.querySelector('div.rounded-md.border.p-3')
    const names = [...card.querySelectorAll('li span.font-medium')].map((node) => node.textContent)
    expect(names).toEqual(['Waiting longest', 'In the middle', 'Just arrived'])
  })

  it('does not reshuffle the queue to the order the rows happen to arrive in', () => {
    at(12, 30)
    // Same three people, delivered in the opposite order.
    const { container } = setup(
      [room()],
      [
        seated({ id: 'c3', name: 'In the middle', room_entry_time: iso(12, 15) }),
        seated({ id: 'c2', name: 'Waiting longest', room_entry_time: iso(12, 2) }),
        seated({ id: 'c1', name: 'Just arrived', room_entry_time: iso(12, 28) }),
      ],
    )

    const card = container.querySelector('div.rounded-md.border.p-3')
    const names = [...card.querySelectorAll('li span.font-medium')].map((node) => node.textContent)
    expect(names).toEqual(['Waiting longest', 'In the middle', 'Just arrived'])
  })
})

describe('RoomsPanel — the room card', () => {
  it('lists the whole interviewer panel inline, with one tap-to-call per number', () => {
    at(12, 0)
    setup(
      [
        room({
          interviewers: [
            { name: 'Romi', phone: '050-1111111' },
            { name: 'Yael', phone: null },
          ],
        }),
      ],
      [],
    )

    expect(screen.getByText('Romi')).toBeInTheDocument()
    expect(screen.getByText('Yael')).toBeInTheDocument()
    // The only phone link: the card's "Open" affordance is a router link, not a
    // tap-to-call, so the assertion is scoped to `tel:` rather than "all links".
    const calls = screen.getAllByRole('link').filter((link) => link.getAttribute('href').startsWith('tel:'))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveAttribute('href', 'tel:050-1111111')
  })

  it('offers to add somebody when the panel is empty', () => {
    at(12, 0)
    setup([room({ interviewers: [] })], [])
    expect(screen.getByText('+ Add interviewer')).toBeInTheDocument()
  })

  it('retypes a room through the select and reports it upward', () => {
    at(12, 0)
    const { onUpdateRoom } = setup([room()], [])

    fireEvent.change(screen.getByLabelText('Type for A206'), { target: { value: 'Personal' } })

    expect(onUpdateRoom).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), { room_type: 'Personal' })
  })

  it('explains an empty board instead of rendering no rooms', () => {
    at(12, 0)
    setup([], [])
    expect(screen.getByText(/No rooms yet/)).toBeInTheDocument()
  })

  it('links each room to its in-room rubric view', () => {
    at(12, 0)
    setup([room(), room({ id: 'r2', room_name: 'CL05', room_type: 'Personal' })], [])

    // Each card carries its own way in, named for the room so a screen reader
    // user can tell the two links apart.
    expect(screen.getByLabelText('Open interview room A206')).toHaveAttribute('href', '/room/r1')
    expect(screen.getByLabelText('Open interview room CL05')).toHaveAttribute('href', '/room/r2')
  })
})
