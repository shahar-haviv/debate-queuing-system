/**
 * The analytics dashboard, rendered against real computed data.
 *
 * The numbers come from `computeAnalytics` rather than a hand-written fixture,
 * so the page is tested against the same shape the ledger produces. Recharts
 * itself is stubbed: it is a vendor SVG component that jsdom cannot measure,
 * and what matters here is that the page hands it the right rows and lays the
 * KPI cards, tables and empty states out correctly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { computeAnalytics } from '../../src/lib/analytics.js'
import Analytics, { formatMinutes } from '../../src/pages/Analytics.jsx'

const { ledger } = vi.hoisted(() => ({
  ledger: { current: null },
}))

vi.mock('recharts', () => {
  const Stub = ({ children }) => <div>{children}</div>
  return {
    ResponsiveContainer: ({ children }) => <div data-testid="chart-stub">{children}</div>,
    BarChart: Stub,
    Bar: Stub,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
  }
})

vi.mock('../../src/hooks/useAuth', () => ({
  useAuth: () => ({ user: { email: 'admin@example.com' }, signOut: async () => {} }),
}))

vi.mock('../../src/hooks/useAnalytics.js', () => ({
  MISSING_LEDGER: 'MISSING_LEDGER',
  useAnalytics: () => ledger.current,
}))

const refresh = vi.fn()

const BASE = Date.UTC(2026, 9, 26, 17, 0, 0)
const at = (minutes) => new Date(BASE + minutes * 60_000).toISOString()

let id = 0
const event = (kind, minute, extra = {}) => ({
  id: (id += 1),
  at: at(minute),
  event: kind,
  candidate_id: 'c1',
  room_id: 'room-cl05',
  room_name: 'CL05',
  task: 'Personal Interview',
  interviewer: 'דניאל',
  ...extra,
})

const CL05 = { room_id: 'room-cl05', room_name: 'CL05' }
const A206 = { room_id: 'room-a206', room_name: 'A206' }

const events = [
  // c1: 5-minute wait, 30 minutes in CL05, filed digitally.
  event('arrived', 0, { candidate_id: 'c1' }),
  event('assigned', 5, { candidate_id: 'c1', ...CL05 }),
  event('completed', 35, { candidate_id: 'c1', ...CL05 }),
  // c2: 10-minute wait, 25 minutes in CL05, paper (no rubric).
  event('arrived', 10, { candidate_id: 'c2' }),
  event('assigned', 20, { candidate_id: 'c2', ...CL05 }),
  event('completed', 45, { candidate_id: 'c2', ...CL05, interviewer: 'רומי, דניאל' }),
  // c3: 5-minute wait, 10 minutes in CL05.
  event('arrived', 20, { candidate_id: 'c3' }),
  event('assigned', 25, { candidate_id: 'c3', ...CL05 }),
  event('released', 35, { candidate_id: 'c3', ...CL05 }),
  // c4: 10-minute wait, 8 minutes in A206.
  event('arrived', 30, { candidate_id: 'c4' }),
  event('assigned', 40, { candidate_id: 'c4', ...A206 }),
  event('released', 48, { candidate_id: 'c4', candidate_name: 'מועמד ד', ...A206 }),
]

const evaluations = [
  {
    candidate_id: 'c1',
    task: 'Personal Interview',
    interviewer_name: 'דניאל',
    scores: { rating_availability: 5, rating_vibe: 4, rating_competitiveness: 3 },
  },
]

function renderPage() {
  return render(
    <MemoryRouter>
      <Analytics />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  refresh.mockReset()
  id = 0
  ledger.current = {
    analytics: computeAnalytics({ events, evaluations }),
    loading: false,
    refreshing: false,
    error: '',
    updatedAt: new Date(BASE),
    refresh,
  }
})

describe('Analytics', () => {
  it('shows the four headline metrics', () => {
    renderPage()

    expect(screen.getByTestId('kpi-processed').textContent).toBe('4')
    expect(screen.getByTestId('kpi-room-time').textContent).toBe('18.3 min')
    expect(screen.getByTestId('kpi-wait-time').textContent).toBe('7.5 min')
    expect(screen.getByTestId('kpi-busiest').textContent).toBe('CL05')
    expect(screen.getByText('3 candidates')).toBeTruthy()
  })

  it('counts a filed rubric and a paper interview separately', () => {
    renderPage()

    const table = screen.getByTestId('leaderboard-table')
    const daniel = within(table).getByText('דניאל').closest('tr')
    expect(within(daniel).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'דניאל',
      '1',
      '1',
      '4.0 / 5',
    ])

    const romi = within(table).getByText('רומי').closest('tr')
    expect(within(romi).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'רומי',
      '0',
      '1',
      '—',
    ])
  })

  it('lists each room with its volume, average, minimum and maximum', () => {
    renderPage()

    const table = screen.getByTestId('rooms-table')
    const cl05 = within(table).getByText('CL05').closest('tr')
    expect(within(cl05).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'CL05',
      '3',
      '21.7 min',
      '10.0 min',
      '30.0 min',
    ])

    const a206 = within(table).getByText('A206').closest('tr')
    expect(within(a206).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'A206',
      '1',
      '8.0 min',
      '8.0 min',
      '8.0 min',
    ])
  })

  it('renders the two charts with data', () => {
    renderPage()

    expect(within(screen.getByTestId('chart-throughput')).getAllByTestId('chart-stub')).toHaveLength(1)
    expect(within(screen.getByTestId('chart-duration')).getAllByTestId('chart-stub')).toHaveLength(1)
  })

  it('pulls the ledger again on demand', () => {
    renderPage()

    fireEvent.click(screen.getByTestId('refresh-metrics'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('disables the button while a refresh is in flight', () => {
    ledger.current = { ...ledger.current, refreshing: true }
    renderPage()

    const button = screen.getByTestId('refresh-metrics')
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Refreshing…')
  })

  it('explains that the ledger starts now when nothing has happened yet', () => {
    ledger.current = {
      ...ledger.current,
      analytics: computeAnalytics(),
      updatedAt: null,
    }
    renderPage()

    expect(screen.getByText('The ledger starts now')).toBeTruthy()
    expect(screen.getAllByText('No completed sessions yet')).toHaveLength(2)
    expect(screen.getByText('No interviews recorded yet.')).toBeTruthy()
    expect(screen.getByText('No room sessions recorded yet.')).toBeTruthy()
    expect(screen.getByTestId('kpi-processed').textContent).toBe('0')
    expect(screen.getByTestId('kpi-room-time').textContent).toBe('—')
  })

  it('lists the movements it does have, newest first', () => {
    renderPage()

    const rows = within(screen.getByTestId('events-table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(events.length)

    const newest = within(rows[0]).getAllByRole('cell').map((cell) => cell.textContent)
    expect(newest.slice(1)).toEqual(['מועמד ד', 'Released', 'A206', 'דניאל'])
  })

  it('says why there is no duration when only a movement has been recorded', () => {
    ledger.current = {
      ...ledger.current,
      analytics: computeAnalytics({
        events: [
          {
            id: 1,
            at: at(0),
            event: 'completed',
            candidate_id: 'c9',
            candidate_name: 'יעל אריאלי',
            room_id: 'room-e201',
            room_name: 'E201',
            task: 'Debate Interview',
            interviewer: 'אורי',
          },
        ],
        evaluations: [],
      }),
    }
    renderPage()

    expect(screen.getByText('Movements recorded — no finished room session yet')).toBeTruthy()
    expect(screen.getByTestId('kpi-processed').textContent).toBe('0')
    expect(screen.getByText('1 movement · 0 filed rubrics')).toBeTruthy()

    const row = within(screen.getByTestId('events-table')).getAllByRole('row')[1]
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      expect.stringMatching(/^\d{2}\/\d{2} \d{2}:\d{2}$/),
      'יעל אריאלי',
      'Completed',
      'E201',
      'אורי',
    ])
  })

  it('tells the coordinator to install the ledger when the table is missing', () => {
    ledger.current = { ...ledger.current, error: 'MISSING_LEDGER' }
    renderPage()

    expect(screen.getByRole('alert').textContent).toContain('npm run db:push')
  })

  it('shows a loading line until the first fetch lands', () => {
    ledger.current = { ...ledger.current, loading: true }
    renderPage()

    expect(screen.getByText('Loading the ledger…')).toBeTruthy()
    expect(screen.queryByTestId('kpi-processed')).toBeNull()
  })

  it('links back to the dispatch board', () => {
    renderPage()
    expect(screen.getByRole('link', { name: 'Dispatch board' }).getAttribute('href')).toBe('/admin')
  })
})

describe('formatMinutes', () => {
  it('prints one decimal and a dash for missing values', () => {
    expect(formatMinutes(12.34)).toBe('12.3 min')
    expect(formatMinutes(0)).toBe('0.0 min')
    expect(formatMinutes(null)).toBe('—')
  })
})
