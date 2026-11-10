import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRESET_PALETTES,
  applyThemePalette,
  parseCoolorsUrl,
} from '../../src/core/theme'
import MainOffice from '../../src/pages/MainOffice'
import {
  DEFAULT_PAIRING_OPTIONS,
  computeAllMemberStats,
  computeChairJuniorMatrix,
  exportAssignmentsCsv,
  exportZoomBreakoutCsv,
  generateSmartRoomDraw,
} from '../../src/training/domain/pairingEngine'
import TrainingHub from '../../src/training/pages/TrainingHub'
import { resetTrainingStore, trainingService } from '../../src/training/services/trainingStorage'

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'idc.debate@gmail.com' }, signOut: async () => {} }),
}))

vi.mock('../../src/hooks/useEvents', () => ({
  useEvents: () => ({
    events: [
      {
        id: 'event-1',
        name: 'Annual Screening 2026',
        date: '2026-11-10',
        status: 'Active',
        notes: '',
        created_at: '2026-11-01T00:00:00Z',
        candidate_count: 54,
        room_count: 4,
      },
    ],
    loading: false,
    error: '',
    reload: async () => {},
    update: async () => ({}),
  }),
}))

beforeEach(() => {
  resetTrainingStore()
})

afterEach(() => {
  cleanup()
})

describe('Training Domain — Smart Pairing & Knowledge Matrix Engine', () => {
  it('computes member speaker averages, position counts, and least-practiced BP position', () => {
    const store = trainingService.getStore()
    const stats = computeAllMemberStats(store.members, store.results)

    // mem-jr-1 (Tomer Segev) played Opening Government once with 77 speaks
    expect(stats['mem-jr-1'].debateRounds).toBe(1)
    expect(stats['mem-jr-1'].averageSpeaks).toBe(77)
    expect(stats['mem-jr-1'].positions['Opening Government']).toBe(1)
    expect(stats['mem-jr-1'].positions['Opening Opposition']).toBe(0)
    expect(stats['mem-jr-1'].leastPlayedPosition).toBe('Opening Opposition')
  })

  it('builds the Chair × Junior exposure matrix to identify unjudged Juniors', () => {
    const store = trainingService.getStore()
    const matrix = computeChairJuniorMatrix(store.members, store.results)

    expect(matrix.juniors.length).toBeGreaterThanOrEqual(6)
    // Romi Cohen (mem-sr-1) judged mem-jr-1 once; Daniel Levi (mem-sr-2) judged mem-jr-1 0 times
    expect(matrix.counts['mem-jr-1']['mem-sr-1']).toBe(1)
    expect(matrix.counts['mem-jr-1']['mem-sr-2']).toBe(0)
  })

  it('honors partner requests, balances least-played BP positions, and rotates Chairs', () => {
    const store = trainingService.getStore()
    const activeRegs = store.registrations.filter((r) => r.session_id === 'sess-active-1')

    const draw = generateSmartRoomDraw(
      store.members,
      activeRegs,
      store.results,
      DEFAULT_PAIRING_OPTIONS,
    )

    expect(draw.rooms.length).toBeGreaterThanOrEqual(1)
    const room = draw.rooms[0]

    // 1. Chair rotation: Daniel Levi (mem-sr-2, 0 prior rounds judging these Juniors) should be picked as Chair
    expect(room.Chair).toContain('mem-sr-2')

    // 2. Partner request honored: mem-jr-1 (Tomer) and mem-jr-3 (Amit) should be on the same bench
    const benches = [
      room['Opening Government'],
      room['Opening Opposition'],
      room['Closing Government'],
      room['Closing Opposition'],
    ]
    const tomerBench = benches.find((b) => b.includes('mem-jr-1'))
    expect(tomerBench).toBeDefined()
    expect(tomerBench).toContain('mem-jr-3')

    // 3. Position balancing: Tomer played OG and Amit played OO in round 1, so their team should be placed in CG or CO (0x for both!)
    const assignedToClosing =
      room['Closing Government'].includes('mem-jr-1') ||
      room['Closing Opposition'].includes('mem-jr-1')
    expect(assignedToClosing).toBe(true)
  })

  it('supports Pro-Am pairing strategy (pairing Seniors with Juniors) and CSV exports', () => {
    const store = trainingService.getStore()
    const activeRegs = store.registrations.filter((r) => r.session_id === 'sess-active-1')

    const draw = generateSmartRoomDraw(store.members, activeRegs, store.results, {
      ...DEFAULT_PAIRING_OPTIONS,
      strategy: 'pro-am',
      honorPartnerRequests: false,
    })

    const room = draw.rooms[0]
    expect(room.explanations.some((line) => line.includes('Pro-Am pair'))).toBe(true)

    const memberById = new Map(store.members.map((m) => [m.id, m]))
    const assignmentsCsv = exportAssignmentsCsv(draw.rooms, memberById)
    expect(assignmentsCsv).toContain('Opening Government')
    expect(assignmentsCsv).toContain('A206')

    const zoomCsv = exportZoomBreakoutCsv(draw.rooms, memberById)
    expect(zoomCsv).toContain('Pre-assign Room Name')
    expect(zoomCsv).toContain('Email Address')
  })
})

describe('TrainingHub & MainOffice — Lean Club Training UI', { timeout: 15000 }, () => {
  it('renders Room Draw, Positions & Matrix, and Club Roster with unified top navigation', () => {
    render(
      <MemoryRouter initialEntries={['/training']}>
        <Routes>
          <Route path="/training" element={<TrainingHub />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Club Training' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Screening Queue' })).toHaveAttribute('href', '/admin')
    expect(screen.getByText('Room A206')).toBeInTheDocument()

    // Switch to Positions & Matrix tab
    fireEvent.click(screen.getByRole('tab', { name: 'Positions & Matrix' }))
    expect(screen.getByText('BP Position Balance & Speaks Matrix')).toBeInTheDocument()
    expect(screen.getByText('Chair × Junior Exposure Matrix')).toBeInTheDocument()

    // Switch to Club Roster tab and approve the Pending Google SSO member
    fireEvent.click(screen.getByRole('tab', { name: /Club Roster/ }))
    expect(screen.getByText(/Pending Google SSO Registrations/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '✓ Approve as Student (Junior)' }))
    expect(screen.queryByText(/Pending Google SSO Registrations/)).not.toBeInTheDocument()
  })

  it('renders lean MainOffice with planned trainings, enrolled members on click, and custom training planner', () => {
    const parsed = parseCoolorsUrl(
      'https://coolors.co/palette/bee9e8-62b6cb-1b4965-cae9ff-5fa8d3',
    )
    expect(parsed).toEqual(['#BEE9E8', '#62B6CB', '#1B4965', '#CAE9FF', '#5FA8D3'])

    applyThemePalette(PRESET_PALETTES[0])
    expect(document.documentElement.style.getPropertyValue('--palette-3')).toBe('#1B4965')

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MainOffice />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { name: "This Week's Trainings" }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Return to Main Office' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(screen.getByRole('link', { name: 'Screening Queue' })).toHaveAttribute(
      'href',
      '/admin',
    )
    expect(screen.getByText('Next Training')).toBeInTheDocument()
    expect(screen.getByText(/Debaters \(/)).toBeInTheDocument()
    expect(screen.getByText(/Judges \(/)).toBeInTheDocument()

    // Click another planned training to see who enrolled in it
    fireEvent.click(screen.getByRole('button', { name: /Wednesday English Practice/ }))
    expect(screen.getByText('4 enrolled (3 debaters, 1 judges)')).toBeInTheDocument()
  })
})
