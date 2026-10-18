import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InterviewerModal from '../../src/components/InterviewerModal.jsx'

const room = (over = {}) => ({
  id: 'r1',
  room_name: 'A320',
  room_type: 'Debate',
  interviewers: [
    { name: 'Romi', phone: '050-1111111' },
    { name: 'Yael', phone: null },
  ],
  ...over,
})

function setup(target = room(), props = {}) {
  const handlers = {
    saving: false,
    onSave: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
    ...props,
  }
  const view = render(<InterviewerModal room={target} {...handlers} />)
  return { ...handlers, ...view }
}

describe('InterviewerModal — reading a panel', () => {
  it('lists every interviewer with no click needed', () => {
    setup()
    const panel = screen.getByTestId('interviewer-panel')
    expect(within(panel).getByText('Romi')).toBeInTheDocument()
    expect(within(panel).getByText('Yael')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'A320' })).toBeInTheDocument()
    expect(screen.getByText('Debate room · 2 interviewers')).toBeInTheDocument()
  })

  it('makes each number tap-to-call, and shows only what is known', () => {
    setup()
    const call = screen.getByRole('link', { name: '050-1111111' })
    expect(call).toHaveAttribute('href', 'tel:050-1111111')
    // Yael has no number, so nobody offers a second call link.
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByText('no phone')).toBeInTheDocument()
  })

  it('says an empty panel is empty, rather than showing nothing', () => {
    setup(room({ interviewers: [] }))
    expect(screen.getByText(/No interviewers recorded/)).toBeInTheDocument()
    expect(screen.getByText('Debate room · no interviewers')).toBeInTheDocument()
    expect(screen.queryByTestId('interviewer-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add interviewer', exact: true })).toBeInTheDocument()
  })

  it('renders nothing when no room is open', () => {
    const { container } = setup(null)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('InterviewerModal — editing a panel', () => {
  it('opens read-only, so a stray click cannot change a phone number', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.queryByTestId('interviewer-row')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit panel', exact: true }))
    expect(screen.getAllByTestId('interviewer-row')).toHaveLength(2)
    expect(screen.getByLabelText('Interviewer 1 name')).toHaveValue('Romi')
    expect(screen.getByLabelText('Interviewer 2 phone')).toHaveValue('')
  })

  it('adds a new interviewer and saves the cleaned panel', async () => {
    const user = userEvent.setup()
    const { onSave } = setup()

    await user.click(screen.getByRole('button', { name: 'Edit panel', exact: true }))
    await user.click(screen.getByRole('button', { name: '+ Add interviewer' }))
    expect(screen.getAllByTestId('interviewer-row')).toHaveLength(3)

    await user.type(screen.getByLabelText('Interviewer 3 name'), '  Dana  ')
    await user.type(screen.getByLabelText('Interviewer 3 phone'), ' 050-2 ')
    await user.click(screen.getByRole('button', { name: 'Save panel' }))

    expect(onSave).toHaveBeenCalledWith({
      interviewers: [
        { name: 'Romi', phone: '050-1111111' },
        { name: 'Yael', phone: null },
        { name: 'Dana', phone: '050-2' },
      ],
    })
  })

  it('removes an interviewer from the panel', async () => {
    const user = userEvent.setup()
    const { onSave } = setup()

    await user.click(screen.getByRole('button', { name: 'Edit panel', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Remove interviewer 1' }))
    expect(screen.getAllByTestId('interviewer-row')).toHaveLength(1)
    expect(screen.queryByDisplayValue('Romi')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save panel' }))
    expect(onSave).toHaveBeenCalledWith({ interviewers: [{ name: 'Yael', phone: null }] })
  })

  it('edits an existing name in place', async () => {
    const user = userEvent.setup()
    const { onSave } = setup()

    await user.click(screen.getByRole('button', { name: 'Edit panel', exact: true }))
    const nameInput = screen.getByLabelText('Interviewer 1 name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Romi Levi')
    await user.click(screen.getByRole('button', { name: 'Save panel' }))

    expect(onSave.mock.calls[0][0].interviewers[0]).toEqual({ name: 'Romi Levi', phone: '050-1111111' })
  })

  it('drops rows that are left blank, and collapses duplicates', async () => {
    const user = userEvent.setup()
    const { onSave } = setup(room({ interviewers: [] }))

    await user.click(screen.getByRole('button', { name: 'Add interviewer', exact: true }))
    expect(screen.getByText(/Nobody in this panel/)).toBeInTheDocument()
    expect(screen.queryAllByTestId('interviewer-row')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: '+ Add interviewer' }))
    await user.click(screen.getByRole('button', { name: '+ Add interviewer' }))
    expect(screen.getAllByTestId('interviewer-row')).toHaveLength(2)
    await user.type(screen.getByLabelText('Interviewer 1 name'), 'Romi')
    await user.type(screen.getByLabelText('Interviewer 2 name'), '  romi ')
    await user.click(screen.getByRole('button', { name: 'Save panel' }))

    expect(onSave).toHaveBeenCalledWith({ interviewers: [{ name: 'Romi', phone: null }] })
  })

  it('keeps the form open and explains itself when the save fails', async () => {
    const user = userEvent.setup()
    const { onSave } = setup(room(), { onSave: vi.fn().mockResolvedValue(false) })

    await user.click(screen.getByRole('button', { name: 'Edit panel', exact: true }))
    await user.click(screen.getByRole('button', { name: 'Save panel' }))

    expect(onSave).toHaveBeenCalled()
    expect(await screen.findByText(/Could not save/)).toBeInTheDocument()
    expect(screen.getAllByTestId('interviewer-row')).toHaveLength(2)
  })

  it('discards edits on cancel, and Escape closes the modal', async () => {
    const user = userEvent.setup()
    const { onClose } = setup()

    await user.click(screen.getByRole('button', { name: 'Edit panel', exact: true }))
    await user.click(screen.getByRole('button', { name: '+ Add interviewer' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    // Back to the read-only view, with the unsaved row gone.
    expect(screen.getByTestId('interviewer-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('interviewer-row')).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('reports the saving state instead of accepting a second click', async () => {
    const user = userEvent.setup()
    setup(room(), { saving: true })

    await user.click(screen.getByRole('button', { name: 'Edit panel', exact: true }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })
})
