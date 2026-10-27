/**
 * Operational analytics.
 *
 * Read-only and on demand: a coordinator opens it to answer "how are we doing",
 * drills into a slow room or a quiet interviewer, then goes back to dispatch.
 * Nothing here changes a candidate — every number comes from the append-only
 * ledger the candidate trigger writes.
 *
 * The dashboard is intentionally plain about what it does not know: a candidate
 * still in a room has no duration yet, a room that was deleted still shows under
 * the name it had, and a paper interview with no rubric is credited to the
 * room's panel rather than silently dropped.
 */
import { useCallback, useMemo, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { EventKind } from '../core/types'
import { useAuth } from '../hooks/useAuth'
import { MISSING_LEDGER, useAnalytics } from '../hooks/useAnalytics'
import { LONG_SESSION_MINUTES } from '../domain/analytics'
import BrandMark from '../components/ui/BrandMark'

const CHART_GREEN = 'var(--color-primary)'
const CHART_RED = 'var(--color-destructive)'

const AXIS_TICK = { fontSize: 12, fill: 'var(--color-muted-foreground)' }
const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: '1px solid var(--color-border)',
  background: 'var(--color-card)',
  color: 'var(--color-card-foreground)',
  fontSize: 12,
  direction: 'ltr',
} as const

/** Minutes, one decimal, or a dash when there is nothing to average yet. */
export function formatMinutes(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} min` : '—'
}

function formatScore(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—'
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-card p-4 shadow-sm ${className}`}>
      {children}
    </section>
  )
}

function Kpi({
  label,
  value,
  detail,
  testId,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  testId: string
  tone?: 'default' | 'alert' | 'muted'
}) {
  const valueClass =
    tone === 'alert' ? 'text-destructive' : tone === 'muted' ? 'text-muted-foreground' : 'text-foreground'
  return (
    <Card>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueClass}`} data-testid={testId}>
        {value}
      </p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </Card>
  )
}

function ChartCard({
  title,
  hint,
  testId,
  children,
}: {
  title: string
  hint?: string
  testId: string
  children: ReactNode
}) {
  return (
    <Card>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="h-64 w-full" data-testid={testId}>
        {children}
      </div>
    </Card>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
      {message}
    </div>
  )
}

const MOVEMENT_LABELS: Partial<Record<EventKind, string>> = {
  arrived: 'Arrived',
  unarrived: 'Un-arrived',
  assigned: 'Assigned',
  released: 'Released',
  completed: 'Completed',
}

/** A ledger timestamp in the viewer's own timezone, e.g. `27/10 12:17`. */
export function formatWhen(value: string | number | Date): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const day = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day} ${time}`
}

export default function Analytics() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { analytics, loading, refreshing, error, updatedAt, refresh } = useAnalytics()
  const { totals, rooms, leaderboard, recent } = analytics

  const handleSignOut = useCallback(async () => {
    await signOut()
    navigate('/login', { replace: true })
  }, [navigate, signOut])

  const hasSessions = totals.sessions > 0
  const hasEvents = totals.events > 0

  const throughput = useMemo(
    () => rooms.map((room) => ({ roomName: room.roomName, candidates: room.candidates })),
    [rooms],
  )
  const durations = useMemo(
    () => rooms.map((room) => ({ roomName: room.roomName, averageMinutes: room.averageMinutes })),
    [rooms],
  )

  const updatedLabel = updatedAt
    ? updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <BrandMark className="size-10" />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">Analytics</h1>
              <p className="text-xs text-muted-foreground">
                Operational metrics from the event ledger
                {updatedLabel && ` · updated ${updatedLabel}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/admin"
              className="rounded-md border border-input bg-card px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              Dispatch board
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              title={user?.email ?? 'Sign out'}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {hasEvents
              ? `${totals.events.toLocaleString('en-US')} movement${totals.events === 1 ? '' : 's'} · ${totals.evaluations.toLocaleString('en-US')} filed rubric${totals.evaluations === 1 ? '' : 's'}`
              : 'No ledger data yet'}
          </p>
          <button
            type="button"
            onClick={refresh}
            disabled={loading || refreshing}
            data-testid="refresh-metrics"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? 'Refreshing…' : 'Refresh metrics'}
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error === MISSING_LEDGER
              ? 'The event ledger is not installed yet. Run "npm run db:push", then refresh this page.'
              : error}
          </div>
        )}

        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading the ledger…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi
                label="Total Candidates Processed"
                value={totals.processed.toLocaleString('en-US')}
                detail={`${totals.sessions.toLocaleString('en-US')} room sessions`}
                testId="kpi-processed"
              />
              <Kpi
                label="Average Time in Room"
                value={formatMinutes(totals.averageRoomMinutes)}
                detail="closed sessions only"
                testId="kpi-room-time"
              />
              <Kpi
                label="Average Wait Time"
                value={formatMinutes(totals.averageWaitMinutes)}
                detail={
                  totals.waitedCandidates > 0
                    ? `across ${totals.waitedCandidates.toLocaleString('en-US')} candidates`
                    : 'arrival → first room'
                }
                testId="kpi-wait-time"
              />
              <Kpi
                label="Busiest Room"
                value={totals.busiestRoom?.roomName ?? '—'}
                detail={
                  totals.busiestRoom
                    ? `${totals.busiestRoom.candidates.toLocaleString('en-US')} candidates`
                    : 'no sessions yet'
                }
                testId="kpi-busiest"
              />
            </div>

            {!hasSessions && (
              <Card className="bg-muted/40">
                <h2 className="text-sm font-semibold text-foreground">
                  {hasEvents ? 'Movements recorded — no finished room session yet' : 'The ledger starts now'}
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  {hasEvents ? (
                    <>
                      The ledger is recording: {totals.events.toLocaleString('en-US')} movement
                      {totals.events === 1 ? ' is' : 's are'} in it, listed at the bottom of this
                      page. A room session is measured from the moment somebody is sent into a room
                      to the moment that room is released or the interview completed, so there is
                      nothing to average until the next candidate goes all the way through. Anything
                      that happened before the ledger was installed is not in it.
                    </>
                  ) : (
                    <>
                      This page reads the append-only movement history, which began recording when the
                      current schema was installed. Nothing that happened before that is in it: earlier
                      moves were never stored anywhere. Tick somebody as arrived, send them to a room and
                      complete the interview, and these charts will start to fill in.
                    </>
                  )}
                </p>
              </Card>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              <ChartCard
                title="Throughput by Room"
                hint="Distinct candidates who spent time in each room."
                testId="chart-throughput"
              >
                {hasSessions ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={throughput} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="roomName" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--color-muted)' }} />
                      <Bar
                        dataKey="candidates"
                        name="Candidates"
                        fill={CHART_GREEN}
                        radius={[6, 6, 0, 0]}
                        maxBarSize={64}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart message="No completed sessions yet" />
                )}
              </ChartCard>

              <ChartCard
                title="Average Duration by Room"
                hint={`Minutes per session; bars over ${LONG_SESSION_MINUTES} minutes are red.`}
                testId="chart-duration"
              >
                {hasSessions ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={durations} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="roomName" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                      <YAxis
                        allowDecimals={false}
                        tick={AXIS_TICK}
                        axisLine={false}
                        tickLine={false}
                        unit="m"
                      />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        cursor={{ fill: 'var(--color-muted)' }}
                        formatter={(value) => [`${Number(value).toFixed(1)} min`, 'Average']}
                      />
                      <Bar dataKey="averageMinutes" name="Average minutes" radius={[6, 6, 0, 0]} maxBarSize={64}>
                        {durations.map((room) => (
                          <Cell
                            key={room.roomName}
                            fill={
                              Number(room.averageMinutes) > LONG_SESSION_MINUTES ? CHART_RED : CHART_GREEN
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart message="No completed sessions yet" />
                )}
              </ChartCard>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="overflow-hidden p-0">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">Interviewer Leaderboard</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Digital rubrics, plus paper interviews with no rubric filed. Scores are the 1–5
                    ratings only.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="leaderboard-table">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2 font-semibold">Interviewer</th>
                        <th className="px-4 py-2 text-right font-semibold">Digital rubrics</th>
                        <th className="px-4 py-2 text-right font-semibold">Paper</th>
                        <th className="px-4 py-2 text-right font-semibold">Avg score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                            No interviews recorded yet.
                          </td>
                        </tr>
                      ) : (
                        leaderboard.map((row) => (
                          <tr key={row.interviewer} className="border-t border-border">
                            <td className="px-4 py-2 font-medium text-foreground">{row.interviewer}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{row.digital}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{row.manual}</td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatScore(row.averageScore)}
                              {Number.isFinite(row.averageScore) && (
                                <span className="text-xs text-muted-foreground"> / 5</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="overflow-hidden p-0">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">Room Statistics</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Every closed session, from the moment the candidate entered to the moment the
                    room was released.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="rooms-table">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2 font-semibold">Room</th>
                        <th className="px-4 py-2 text-right font-semibold">Candidates</th>
                        <th className="px-4 py-2 text-right font-semibold">Avg</th>
                        <th className="px-4 py-2 text-right font-semibold">Min</th>
                        <th className="px-4 py-2 text-right font-semibold">Max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rooms.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                            No room sessions recorded yet.
                          </td>
                        </tr>
                      ) : (
                        rooms.map((room) => (
                          <tr key={room.roomName} className="border-t border-border">
                            <td className="px-4 py-2 font-medium text-foreground">{room.roomName}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{room.candidates}</td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMinutes(room.averageMinutes)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              {formatMinutes(room.minMinutes)}
                            </td>
                            <td
                              className={`px-4 py-2 text-right tabular-nums ${
                                (room.maxMinutes ?? 0) > LONG_SESSION_MINUTES
                                  ? 'font-semibold text-destructive'
                                  : ''
                              }`}
                            >
                              {formatMinutes(room.maxMinutes)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            {recent.length > 0 && (
              <Card className="overflow-hidden p-0">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">Recent Movements</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    The last {recent.length} ledger row{recent.length === 1 ? '' : 's'}, newest first
                    — every arrival, dispatch, move, release and completion, whoever made it.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="events-table">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2 font-semibold">When</th>
                        <th className="px-4 py-2 font-semibold">Candidate</th>
                        <th className="px-4 py-2 font-semibold">Movement</th>
                        <th className="px-4 py-2 font-semibold">Room</th>
                        <th className="px-4 py-2 font-semibold">Interviewer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((row) => (
                        <tr key={row.id} className="border-t border-border">
                          <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">
                            {formatWhen(row.at)}
                          </td>
                          <td className="px-4 py-2 font-medium text-foreground">
                            {row.candidateName || '—'}
                          </td>
                          <td className="px-4 py-2">
                            <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                              {MOVEMENT_LABELS[row.event] ?? row.event}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{row.roomName || '—'}</td>
                          <td className="px-4 py-2 text-muted-foreground">{row.interviewer || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <p className="pb-6 text-xs text-muted-foreground">
              A candidate still in a room has no duration yet and is left out of the averages. A
              candidate who moved rooms counts once per room.
            </p>
          </>
        )}
      </main>
    </div>
  )
}
