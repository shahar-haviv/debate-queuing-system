import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CandidateCard from '../../src/components/CandidateCard.jsx'

const ROOMS = [
  { id: 'a206', room_name: 'A206', room_type: 'Debate', interviewers: [] },
  { id: 'a207', room_name: 'A207', room_type: 'Debate', interviewers: [{ name: 'daniel', phone: null }] },
  { id: 'g1', room_name: 'G1', room_type: 'General', interviewers: [] },
]

const candidate = (over = {}) => ({
  id: 'c1',
  name: 'Dana Cohen',
  serial_number: '5',
  planned_time: '09:30',
  phone_number: '050-1234567',
  arrival_time: null,
  has_arrived: false,
  debate_interview_completed: false,
  personal_interview_completed: false,
  assigned_room: null,
  current_task_assignment: null,
  interviewer_constraints: [],
  ...over,
})

function setup(cand, rooms = ROOMS, props = {}) {
  const handlers = {
    onPatch: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onShowQr: vi.fn(),
    onAutoAssign: vi.fn(),
    ...props,
  }
  const view = render(<CandidateCard candidate={cand} rooms={rooms} {...handlers} />)
  return { ...handlers, ...view }
}

describe('CandidateCard — the arrival lock', () => {
  it('locks the interviews and the room picker until the candidate has arrived', () => {
    setup(candidate({ has_arrived: false }))
    expect(screen.getByLabelText('Debate done')).toBeDisabled()
    expect(screen.getByLabelText('Personal done')).toBeDisabled()
    expect(screen.getByLabelText('Assigned room')).toBeDisabled()
    expect(screen.getByText(/Mark as arrived to unlock/)).toBeInTheDocument()
  })

  it('unlocks everything once they have arrived', () => {
    setup(candidate({ has_arrived: true }))
    expect(screen.getByLabelText('Debate done')).toBeEnabled()
    expect(screen.getByLabelText('Personal done')).toBeEnabled()
    expect(screen.getByLabelText('Assigned room')).toBeEnabled()
    expect(screen.queryByText(/Mark as arrived to unlock/)).not.toBeInTheDocument()
  })

  it('asks for confirmation before un-ticking Arrived on a candidate holding state', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { onPatch } = setup(
      candidate({ has_arrived: true, assigned_room: 'a206', current_task_assignment: 'Debate Interview' }),
    )

    await userEvent.click(screen.getByLabelText('Arrived'))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(onPatch).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await userEvent.click(screen.getByLabelText('Arrived'))
    expect(onPatch).toHaveBeenCalledWith('c1', { has_arrived: false })
  })

  it('does not nag when there is nothing to lose', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onPatch } = setup(candidate({ has_arrived: true }))
    await userEvent.click(screen.getByLabelText('Arrived'))
    expect(confirm).not.toHaveBeenCalled()
    expect(onPatch).toHaveBeenCalledWith('c1', { has_arrived: false })
  })
})

describe('CandidateCard — the Auto-Assign wand', () => {
  it('is hidden on a candidate who has not arrived', () => {
    setup(candidate({ has_arrived: false }))
    expect(screen.queryByRole('button', { name: /Auto-assign/ })).not.toBeInTheDocument()
  })

  it('offers either track, rather than promising the debate, when both are outstanding', () => {
    setup(candidate({ has_arrived: true }))
    expect(screen.getByRole('button', { name: 'Auto-assign to the emptiest room on either track' })).toBeEnabled()
  })

  it('names the interview once only one is left', () => {
    setup(candidate({ has_arrived: true, personal_interview_completed: true }))
    expect(screen.getByRole('button', { name: 'Auto-assign to the best room for a Debate Interview' })).toBeEnabled()
  })

  it('still targets the personal interview when only that one is left', () => {
    setup(candidate({ has_arrived: true, debate_interview_completed: true }))
    expect(screen.getByRole('button', { name: 'Auto-assign to the best room for a Personal Interview' })).toBeInTheDocument()
  })

  it('disappears once both interviews are done', () => {
    setup(candidate({ has_arrived: true, debate_interview_completed: true, personal_interview_completed: true }))
    expect(screen.queryByRole('button', { name: /Auto-assign/ })).not.toBeInTheDocument()
    expect(screen.getByText('DONE')).toBeInTheDocument()
  })

  it('hands the candidate back to the handler', async () => {
    const cand = candidate({ has_arrived: true })
    const { onAutoAssign } = setup(cand)
    await userEvent.click(screen.getByRole('button', { name: /Auto-assign/ }))
    expect(onAutoAssign).toHaveBeenCalledWith(cand)
  })
})

describe('CandidateCard — conflict of interest', () => {
  const restricted = candidate({ has_arrived: true, interviewer_constraints: ['daniel'] })

  it('disables a room staffed by a restricted interviewer and says why', () => {
    setup(restricted)
    const blocked = screen.getByRole('option', { name: 'A207 · Debate (Blocked: Conflict)' })
    expect(blocked).toBeDisabled()
    const free = screen.getByRole('option', { name: 'A206 · Debate' })
    expect(free).toBeEnabled()
  })

  it('leaves every room open when the candidate has no restrictions', () => {
    setup(candidate({ has_arrived: true }))
    expect(screen.getByRole('option', { name: 'A207 · Debate' })).toBeEnabled()
    expect(screen.queryByRole('option', { name: /Blocked: Conflict/ })).not.toBeInTheDocument()
  })

  it('shows the restrictions on the card, in the admin’s own wording', () => {
    setup(candidate({ has_arrived: true, interviewer_constraints: ['  DANIEL ', 'Dana'] }))
    expect(screen.getByText(/no DANIEL, Dana/, { selector: 'span' })).toBeInTheDocument()
  })

  it('warns loudly when a conflict is sitting in a room right now', () => {
    setup(candidate({ has_arrived: true, assigned_room: 'a207', interviewer_constraints: ['daniel'] }))
    expect(screen.getByText(/Conflict of interest/)).toBeInTheDocument()
    expect(screen.getByText(/Conflict of interest: daniel is on this candidate’s restricted list/)).toBeInTheDocument()
  })

  it('names only the panel members who are actually restricted', () => {
    const panelRooms = [
      {
        id: 'p1',
        room_name: 'P1',
        room_type: 'Debate',
        interviewers: [
          { name: 'Romi', phone: '050-1' },
          { name: 'daniel', phone: null },
          { name: 'Yael', phone: null },
        ],
      },
    ]
    setup(
      candidate({ has_arrived: true, assigned_room: 'p1', interviewer_constraints: ['daniel', 'Noa'] }),
      panelRooms,
    )
    expect(screen.getByText(/Conflict of interest: daniel is on this candidate’s restricted list/)).toBeInTheDocument()
    expect(screen.queryByText(/Romi/)).not.toBeInTheDocument()
  })

  it('blocks a room when any single member of its panel is restricted', () => {
    const panelRooms = [
      {
        id: 'p2',
        room_name: 'P2',
        room_type: 'Debate',
        interviewers: [{ name: 'Romi', phone: null }, { name: 'daniel', phone: null }],
      },
    ]
    setup(candidate({ has_arrived: true, interviewer_constraints: ['daniel'] }), panelRooms)
    expect(screen.getByRole('option', { name: 'P2 · Debate (Blocked: Conflict)' })).toBeDisabled()
  })

  it('stays quiet when the assigned room is fine', () => {
    setup(candidate({ has_arrived: true, assigned_room: 'a206', interviewer_constraints: ['daniel'] }))
    expect(screen.queryByText(/Conflict of interest/)).not.toBeInTheDocument()
  })
})

describe('CandidateCard — the task follows the room', () => {
  it('derives the task from a Debate room and hides the dropdown', async () => {
    const { onPatch } = setup(candidate({ has_arrived: true }))
    expect(screen.queryByLabelText('Current task')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Assigned room'), 'a206')
    expect(onPatch).toHaveBeenCalledWith('c1', {
      assigned_room: 'a206',
      current_task_assignment: 'Debate Interview',
    })
  })

  it('keeps the dropdown for a General room, which implies nothing', async () => {
    setup(candidate({ has_arrived: true, assigned_room: 'g1' }))
    expect(screen.getByLabelText('Current task')).toBeInTheDocument()
  })

  it('leaves an existing choice alone when a General room is picked', async () => {
    const { onPatch } = setup(candidate({ has_arrived: true, current_task_assignment: 'Personal Interview' }))
    await userEvent.selectOptions(screen.getByLabelText('Assigned room'), 'g1')
    expect(onPatch).toHaveBeenCalledWith('c1', {
      assigned_room: 'g1',
      current_task_assignment: 'Personal Interview',
    })
  })

  it('clears both the room and the task when the assignment is removed', async () => {
    const { onPatch } = setup(
      candidate({ has_arrived: true, assigned_room: 'a206', current_task_assignment: 'Debate Interview' }),
    )
    await userEvent.selectOptions(screen.getByLabelText('Assigned room'), '')
    expect(onPatch).toHaveBeenCalledWith('c1', { assigned_room: null, current_task_assignment: null })
  })
})

describe('CandidateCard — the room chip, serial and late flag', () => {
  it('shows where the candidate is standing and what for', () => {
    setup(candidate({ has_arrived: true, assigned_room: 'a206', current_task_assignment: 'Debate Interview' }))
    expect(screen.getByText('A206 · Debate', { selector: 'span' })).toBeInTheDocument()
  })

  it('never shows a chip for an unassigned candidate', () => {
    setup(candidate({ has_arrived: true }))
    expect(screen.queryByText(/^A206/, { selector: 'span' })).not.toBeInTheDocument()
  })

  it('flags a late candidate and tints the card', () => {
    const { container } = setup(candidate({ has_arrived: false }), ROOMS, { late: true })
    expect(screen.getByText('LATE')).toBeInTheDocument()
    expect(container.querySelector('article').className).toContain('border-destructive/40')
  })

  it('shows the serial and the phone number on the staff card', () => {
    setup(candidate())
    expect(screen.getByText('#5')).toBeInTheDocument()
    expect(screen.getByText('050-1234567')).toBeInTheDocument()
  })
})

describe('CandidateCard — the place in line', () => {
  it('badges the head of the line as first', () => {
    setup(candidate({ has_arrived: true }), ROOMS, { queuePosition: 1 })
    const chip = screen.getByText('1st in line')
    expect(chip).toBeInTheDocument()
    // The head of the line is the one the dispatcher presses first, so it is
    // the only position that gets the loud tone.
    expect(chip.className).toContain('bg-primary')
  })

  it('badges the rest in a quiet tone', () => {
    setup(candidate({ has_arrived: true }), ROOMS, { queuePosition: 3 })
    const chip = screen.getByText('3rd in line')
    expect(chip.className).not.toContain('bg-primary')
  })

  it('uses the right ordinal for the teens', () => {
    setup(candidate({ has_arrived: true }), ROOMS, { queuePosition: 11 })
    expect(screen.getByText('11th in line')).toBeInTheDocument()
  })

  it('shows no badge when the candidate is not waiting in the line', () => {
    // Seated candidates and not-yet-arrived ones have no place in the line.
    setup(candidate({ has_arrived: true, assigned_room: 'a206' }))
    expect(screen.queryByText(/in line/)).not.toBeInTheDocument()

    setup(candidate({ has_arrived: false }))
    expect(screen.queryByText(/in line/)).not.toBeInTheDocument()
  })
})
