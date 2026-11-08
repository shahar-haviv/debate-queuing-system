/**
 * Component & page tests for the Back Office Form Studio and custom per-event
 * Debate / Personal forms in RoomView.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import FormStudio from '../../src/pages/FormStudio'
import EvaluationForm from '../../src/components/features/EvaluationForm'
import { defaultDebateFormConfig } from '../../src/domain/formBuilder'

const mockState = vi.hoisted(() => ({
  event: {
    id: 'event-1',
    name: 'Fall Tryouts',
    date: '2026-11-15',
    status: 'Draft',
    notes: '',
    created_at: '2026-10-01T00:00:00Z',
  },
  update: vi.fn(),
}))

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'admin@example.com' }, signOut: async () => {} }),
}))

vi.mock('../../src/services/container', () => ({
  useServices: () => ({
    events: {
      listSummaries: async () => [
        { ...mockState.event, candidate_count: 12, room_count: 3 },
      ],
      findById: async () => mockState.event,
      update: mockState.update,
    },
  }),
}))

beforeEach(() => {
  window.localStorage.clear()
  mockState.update.mockReset()
  mockState.update.mockImplementation(async (_id, patch) => ({
    ...mockState.event,
    ...patch,
  }))
})

function renderStudio(initialEntry = '/admin/event/event-1/forms') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/admin/forms" element={<FormStudio />} />
        <Route path="/admin/event/:id/forms" element={<FormStudio />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('FormStudio — Back Office Form Builder', { timeout: 15000 }, () => {
  it('loads the event form studio with Personal and Debate tabs and live preview', async () => {
    renderStudio()

    expect(await screen.findByRole('heading', { name: 'Form Studio — Fall Tryouts' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Personal Interview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Interactive Live Preview')).toBeInTheDocument()

    // Switch to Debate Interview tab
    fireEvent.click(screen.getByRole('tab', { name: 'Debate Interview' }))
    expect(screen.getByRole('tab', { name: 'Debate Interview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/Digital form is currently disabled for Debate Interview/)).toBeInTheDocument()

    // Enable the Debate Interview digital form
    fireEvent.click(screen.getByLabelText(/Digital form enabled for Debate Interview/))
    expect(screen.queryByText(/Digital form is currently disabled/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('מי שופט?')).toBeInTheDocument()
  })

  it('loads an English LTR template and updates the live preview direction', async () => {
    renderStudio()
    await screen.findByRole('heading', { name: 'Form Studio — Fall Tryouts' })

    fireEvent.click(screen.getByRole('tab', { name: 'Debate Interview' }))

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Load template Debate Interview — BP Judging Rubric (English)',
      }),
    )

    expect(screen.getByLabelText('Layout & language direction')).toHaveValue('ltr')
    expect(screen.getByLabelText('Assigned Position')).toBeInTheDocument()
  })

  it('saves a custom form configuration to the event', async () => {
    renderStudio()
    await screen.findByRole('heading', { name: 'Form Studio — Fall Tryouts' })

    // Enable Debate Interview form as well and save
    fireEvent.click(screen.getByRole('tab', { name: 'Debate Interview' }))
    fireEvent.click(screen.getByLabelText(/Digital form enabled for Debate Interview/))

    fireEvent.click(screen.getByRole('button', { name: 'Save Forms for Fall Tryouts' }))

    await waitFor(() => expect(mockState.update).toHaveBeenCalledTimes(1))
    expect(mockState.update).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({
        forms: expect.objectContaining({
          'Personal Interview': expect.objectContaining({ enabled: true }),
          'Debate Interview': expect.objectContaining({ enabled: true }),
        }),
      }),
    )
  })

  it('saves a custom reusable template to the Back Office library', async () => {
    renderStudio('/admin/forms')
    await screen.findByText('Interactive Live Preview')

    fireEvent.click(screen.getByRole('button', { name: 'Save as Reusable Template' }))
    const dialog = screen.getByRole('dialog', { name: 'Save as reusable template' })

    fireEvent.change(within(dialog).getByLabelText(/Template name/), {
      target: { value: 'Winter 2027 Custom Rubric' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Template' }))

    expect(await screen.findByText('Winter 2027 Custom Rubric')).toBeInTheDocument()
  })
})

describe('EvaluationForm — extended field types', () => {
  it('renders and interacts with select, multiselect, boolean and custom scale questions', () => {
    const values = {
      position: '',
      tags: '',
      available: '',
      score10: '',
    }
    const onChange = vi.fn((key, val) => {
      values[key] = val
    })

    const base = defaultDebateFormConfig(true)
    const form = [
      {
        id: 's1',
        part: 'Part 1',
        heading: 'Extended Inputs',
        intro: null,
        questions: [
          {
            key: 'position',
            label: 'Speaker Role',
            type: 'select',
            required: true,
            options: ['PM', 'LO'],
          },
          {
            key: 'tags',
            label: 'Strengths',
            type: 'multiselect',
            required: false,
            options: ['Clarity', 'Rebuttal'],
          },
          {
            key: 'available',
            label: 'Can attend camp?',
            type: 'boolean',
            required: true,
          },
          {
            key: 'score10',
            label: 'Overall Rating',
            type: 'scale',
            required: true,
            scaleMin: 1,
            scaleMax: 7,
            scaleLabels: { 1: 'Low', 7: 'Outstanding' },
          },
        ],
      },
    ]

    render(
      <EvaluationForm
        form={form}
        values={values}
        direction="ltr"
        submitLabel={base.submitLabel}
        skipLabel={base.skipLabel}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('Speaker Role'), { target: { value: 'PM' } })
    expect(onChange).toHaveBeenCalledWith('position', 'PM')

    fireEvent.click(screen.getByLabelText('Clarity'))
    expect(onChange).toHaveBeenCalledWith('tags', 'Clarity')

    fireEvent.click(screen.getByRole('radio', { name: 'Can attend camp? — Yes' }))
    expect(onChange).toHaveBeenCalledWith('available', 'Yes')

    fireEvent.click(screen.getByRole('radio', { name: 'Overall Rating — 7' }))
    expect(onChange).toHaveBeenCalledWith('score10', '7')
    expect(screen.getByText('7 — Outstanding')).toBeInTheDocument()
  })
})
