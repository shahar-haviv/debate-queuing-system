import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import BrandMark from '../components/ui/BrandMark'
import PaletteSwitcher from '../components/ui/PaletteSwitcher'
import { useAuth } from '../hooks/useAuth'
import { useEvents } from '../hooks/useEvents'
import { useTraining } from '../training/hooks/useTraining'
import type { RolePreference } from '../training/types'

function formatFriendlyDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) return dateStr
  const [, y, m, d] = match
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default function MainOffice() {
  const { user, signOut } = useAuth()
  const { events } = useEvents()
  const {
    members,
    sessions,
    registrations,
    results,
    memberById,
    actions,
  } = useTraining()

  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    () => sessions[0]?.id ?? '',
  )
  const [quickMemberId, setQuickMemberId] = useState('')
  const [quickRole, setQuickRole] = useState<RolePreference>('Debate')

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? sessions[0] ?? null,
    [sessions, selectedSessionId],
  )

  const sessionRegistrations = useMemo(() => {
    if (!activeSession) return []
    return registrations
      .filter((r) => r.session_id === activeSession.id && r.status !== 'Cancelled')
      .map((r) => ({
        ...r,
        member: memberById.get(r.member_id),
      }))
      .filter((r) => Boolean(r.member))
  }, [activeSession, registrations, memberById])

  const debatersSignedUp = useMemo(
    () => sessionRegistrations.filter((r) => r.role_preference !== 'Judge'),
    [sessionRegistrations],
  )

  const judgesSignedUp = useMemo(
    () => sessionRegistrations.filter((r) => r.role_preference === 'Judge'),
    [sessionRegistrations],
  )

  const checkedInCount = useMemo(
    () => sessionRegistrations.filter((r) => r.status === 'CheckedIn').length,
    [sessionRegistrations],
  )

  const juniorsCount = useMemo(
    () => sessionRegistrations.filter((r) => r.member?.rank === 'Junior').length,
    [sessionRegistrations],
  )

  const unregisteredMembers = useMemo(() => {
    const registeredSet = new Set(sessionRegistrations.map((r) => r.member_id))
    return members.filter(
      (m) => m.permissions !== 'Pending' && !registeredSet.has(m.id),
    )
  }, [members, sessionRegistrations])

  const activeScreeningEvents = useMemo(
    () => events.filter((e) => e.status === 'Active'),
    [events],
  )

  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeSession || !quickMemberId) return
    actions.upsertRegistration({
      sessionId: activeSession.id,
      memberId: quickMemberId,
      status: 'CheckedIn',
      rolePreference: quickRole,
      languagePreference: 'Hebrew',
    })
    setQuickMemberId('')
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Warm, airy top navigation */}
      <header className="sticky top-0 z-30 border-b border-border/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandMark className="size-10" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-tight text-primary sm:text-lg">
                  IDC Debate Society
                </h1>
                <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-bold text-secondary-foreground">
                  Main Office
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Weekly Club Training &amp; Annual Screening Platform
              </p>
            </div>
          </div>

          <nav
            aria-label="Primary Workspace Navigation"
            className="flex items-center gap-1.5 rounded-full border border-border bg-muted/60 p-1"
          >
            <Link
              to="/"
              className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-2xs transition"
            >
              Main Office
            </Link>
            <Link
              to="/training"
              className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-white"
            >
              Club Training
            </Link>
            <Link
              to="/admin"
              className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-foreground transition hover:bg-white"
            >
              Screening Queue
            </Link>
          </nav>

          <div className="flex items-center gap-2.5">
            <PaletteSwitcher />
            {user?.email && (
              <span className="hidden rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground lg:inline-block">
                {user.email}
              </span>
            )}
            <button
              type="button"
              onClick={() => signOut()}
              className="h-9 rounded-full border border-border bg-white px-3.5 text-xs font-semibold text-foreground transition hover:bg-muted"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-7 sm:px-6">
        {/* Hero Card: This Week's Training Overview */}
        <section
          aria-label="This Week's Training Overview"
          className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-white via-secondary/35 to-accent/35 p-6 shadow-sm sm:p-8"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground shadow-2xs">
                  Weekly Club Pulse
                </span>
                {activeSession && (
                  <span className="rounded-full border border-primary/20 bg-white/90 px-3 py-1 text-xs font-semibold text-primary">
                    {formatFriendlyDate(activeSession.date)} · {activeSession.time || '18:30'}
                  </span>
                )}
                {activeSession && (
                  <span className="rounded-full bg-accent/80 px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">
                    {activeSession.status}
                  </span>
                )}
              </div>

              <h2 className="text-2xl font-extrabold tracking-tight text-primary sm:text-3xl">
                {activeSession
                  ? activeSession.title
                  : 'Welcome to the IDC Debate Lounge'}
              </h2>

              <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                See who signed up for training tonight, check in arriving debaters and judges,
                and generate a balanced British Parliamentary room draw in one click.
              </p>

              {/* Session Switcher Pills */}
              {sessions.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Training Session:
                  </span>
                  {sessions.map((sess) => {
                    const isCurrent = sess.id === activeSession?.id
                    const count = registrations.filter(
                      (r) => r.session_id === sess.id && r.status !== 'Cancelled',
                    ).length
                    return (
                      <button
                        key={sess.id}
                        type="button"
                        onClick={() => setSelectedSessionId(sess.id)}
                        className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                          isCurrent
                            ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                            : 'border-border bg-white/85 text-foreground hover:bg-white'
                        }`}
                      >
                        <span>{formatFriendlyDate(sess.date)}</span>
                        <span className="opacity-80">({sess.time || '18:30'})</span>
                        <span
                          className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                            isCurrent
                              ? 'bg-white/20 text-white'
                              : 'bg-secondary text-secondary-foreground'
                          }`}
                        >
                          {count} signed up
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Primary CTAs */}
            <div className="flex flex-col gap-2.5 sm:flex-row lg:flex-col xl:flex-row">
              <Link
                to="/training"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-sm transition hover:opacity-95"
              >
                <span>Open Training Hub</span>
                <span aria-hidden="true">→</span>
              </Link>
              <Link
                to="/training?tab=draw"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-primary/25 bg-white/95 px-5 text-sm font-bold text-primary shadow-2xs transition hover:bg-secondary/40"
              >
                <span>Smart BP Room Draw</span>
              </Link>
              <Link
                to="/training/projection"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-border bg-white/80 px-4 text-xs font-semibold text-muted-foreground transition hover:bg-white hover:text-foreground"
              >
                <span>Projector View</span>
              </Link>
            </div>
          </div>

          {/* 4 Chill At-A-Glance Stat Cards */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-2xs backdrop-blur-xs">
              <p className="text-xs font-semibold text-muted-foreground">Total Signed Up</p>
              <div className="mt-1 flex items-baseline justify-between">
                <p className="text-2xl font-extrabold text-primary">
                  {sessionRegistrations.length}
                </p>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">
                  {checkedInCount} checked in
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-2xs backdrop-blur-xs">
              <p className="text-xs font-semibold text-muted-foreground">Debaters Ready</p>
              <div className="mt-1 flex items-baseline justify-between">
                <p className="text-2xl font-extrabold text-primary">
                  {debatersSignedUp.length}
                </p>
                <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-foreground">
                  {Math.floor(debatersSignedUp.length / 8)} full BP{' '}
                  {Math.floor(debatersSignedUp.length / 8) === 1 ? 'room' : 'rooms'}
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-2xs backdrop-blur-xs">
              <p className="text-xs font-semibold text-muted-foreground">Judges Signed Up</p>
              <div className="mt-1 flex items-baseline justify-between">
                <p className="text-2xl font-extrabold text-primary">
                  {judgesSignedUp.length}
                </p>
                <span className="text-xs font-medium text-muted-foreground">
                  Chairs &amp; Wings
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-2xs backdrop-blur-xs">
              <p className="text-xs font-semibold text-muted-foreground">Session Time &amp; Mix</p>
              <div className="mt-1 flex items-baseline justify-between">
                <p className="text-2xl font-extrabold text-primary">
                  {activeSession?.time || '18:30'}
                </p>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {juniorsCount} Juniors
                </span>
              </div>
            </div>
          </div>

          {activeSession?.motion && (
            <div className="mt-4 rounded-2xl border border-primary/15 bg-white/90 px-4 py-3 text-xs text-foreground shadow-2xs">
              <span className="font-bold tracking-wider text-primary uppercase">
                Tonight&apos;s Motion:{' '}
              </span>
              <span className="font-medium">{activeSession.motion}</span>
            </div>
          )}
        </section>

        {/* Who Signed Up for Training Tonight? (Live Check-In & Role Overview) */}
        {activeSession && (
          <section
            aria-label="Who Signed Up for Training"
            className="rounded-3xl border border-border bg-white p-6 shadow-xs sm:p-7"
          >
            <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-lg font-extrabold text-primary sm:text-xl">
                  Who Signed Up for {activeSession.title}
                </h2>
                <p className="text-xs text-muted-foreground sm:text-sm">
                  {formatFriendlyDate(activeSession.date)} at {activeSession.time || '18:30'}{' '}
                  · Click any member to toggle arrival check-in or switch role.
                </p>
              </div>

              {/* Quick Add Member Form */}
              {unregisteredMembers.length > 0 && (
                <form
                  onSubmit={handleQuickAdd}
                  className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-muted/40 p-1.5"
                >
                  <select
                    aria-label="Select member to sign up"
                    value={quickMemberId}
                    onChange={(e) => setQuickMemberId(e.target.value)}
                    className="h-8 rounded-xl border border-input bg-white px-2.5 text-xs font-medium text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="">+ Quick sign-up member…</option>
                    {unregisteredMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name_eng} ({m.rank})
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Select training role"
                    value={quickRole}
                    onChange={(e) => setQuickRole(e.target.value as RolePreference)}
                    className="h-8 rounded-xl border border-input bg-white px-2.5 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="Debate">as Debater</option>
                    <option value="Judge">as Judge</option>
                  </select>
                  <button
                    type="submit"
                    disabled={!quickMemberId}
                    className="h-8 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground transition hover:opacity-95 disabled:opacity-40"
                  >
                    Sign Up
                  </button>
                </form>
              )}
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              {/* Debaters Column */}
              <div className="rounded-2xl border border-border bg-muted/30 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-palette-cerulean" />
                    <h3 className="text-sm font-extrabold text-primary">
                      Debaters ({debatersSignedUp.length})
                    </h3>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {debatersSignedUp.filter((d) => d.status === 'CheckedIn').length} arrived
                  </span>
                </div>

                {debatersSignedUp.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    No debaters signed up for this session yet.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {debatersSignedUp.map((reg) => {
                      const m = reg.member!
                      const isCheckedIn = reg.status === 'CheckedIn'
                      return (
                        <div
                          key={reg.id}
                          className={`flex items-center justify-between rounded-xl border p-2.5 transition ${
                            isCheckedIn
                              ? 'border-palette-teal/50 bg-white shadow-2xs'
                              : 'border-border bg-white/60 opacity-80'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <p className="truncate text-xs font-bold text-foreground">
                              {m.full_name_eng || m.full_name_heb}
                            </p>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span
                                className={`rounded-md px-1.5 py-0.2 text-[10px] font-semibold ${
                                  m.rank === 'Junior'
                                    ? 'bg-secondary text-secondary-foreground'
                                    : 'bg-accent text-accent-foreground'
                                }`}
                              >
                                {m.rank}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  actions.upsertRegistration({
                                    sessionId: activeSession.id,
                                    memberId: m.id,
                                    status: reg.status,
                                    rolePreference: 'Judge',
                                    languagePreference: reg.language_preference,
                                    partnerId: reg.partner_id,
                                    notes: reg.notes,
                                  })
                                }
                                className="text-[10px] font-medium text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                              >
                                Switch to Judge
                              </button>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => actions.toggleCheckIn(activeSession.id, m.id)}
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                                isCheckedIn
                                  ? 'bg-primary text-primary-foreground'
                                  : 'border border-border bg-muted text-muted-foreground hover:bg-secondary'
                              }`}
                            >
                              {isCheckedIn ? 'Checked In' : 'Registered'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                actions.cancelRegistration(activeSession.id, m.id)
                              }
                              title="Remove from session"
                              aria-label={`Remove ${m.full_name_eng}`}
                              className="rounded-lg px-1.5 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Judges Column */}
              <div className="rounded-2xl border border-border bg-muted/30 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full bg-palette-teal" />
                    <h3 className="text-sm font-extrabold text-primary">
                      Judges &amp; Chairs ({judgesSignedUp.length})
                    </h3>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">
                    {judgesSignedUp.filter((j) => j.status === 'CheckedIn').length} arrived
                  </span>
                </div>

                {judgesSignedUp.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    No judges signed up for this session yet.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {judgesSignedUp.map((reg) => {
                      const m = reg.member!
                      const isCheckedIn = reg.status === 'CheckedIn'
                      return (
                        <div
                          key={reg.id}
                          className={`flex items-center justify-between rounded-xl border p-2.5 transition ${
                            isCheckedIn
                              ? 'border-palette-teal/50 bg-white shadow-2xs'
                              : 'border-border bg-white/60 opacity-80'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <p className="truncate text-xs font-bold text-foreground">
                              {m.full_name_eng || m.full_name_heb}
                            </p>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="rounded-md bg-accent px-1.5 py-0.2 text-[10px] font-semibold text-accent-foreground">
                                {m.official_judgement_level}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  actions.upsertRegistration({
                                    sessionId: activeSession.id,
                                    memberId: m.id,
                                    status: reg.status,
                                    rolePreference: 'Debate',
                                    languagePreference: reg.language_preference,
                                    partnerId: reg.partner_id,
                                    notes: reg.notes,
                                  })
                                }
                                className="text-[10px] font-medium text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
                              >
                                Switch to Debater
                              </button>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => actions.toggleCheckIn(activeSession.id, m.id)}
                              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
                                isCheckedIn
                                  ? 'bg-primary text-primary-foreground'
                                  : 'border border-border bg-muted text-muted-foreground hover:bg-secondary'
                              }`}
                            >
                              {isCheckedIn ? 'Checked In' : 'Registered'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                actions.cancelRegistration(activeSession.id, m.id)
                              }
                              title="Remove from session"
                              aria-label={`Remove ${m.full_name_eng}`}
                              className="rounded-lg px-1.5 py-1 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Two Core Club Spaces: Weekly Training vs Annual Candidate Screening */}
        <section aria-label="Club Spaces" className="grid gap-6 lg:grid-cols-12">
          {/* Primary Space: Weekly Club Training (7 cols) */}
          <div className="flex flex-col justify-between rounded-3xl border border-border bg-white p-6 shadow-xs lg:col-span-7">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold text-secondary-foreground">
                  3× A Week · Primary Workspace
                </span>
                <span className="text-xs font-semibold text-muted-foreground">
                  {members.length} Club Members · {results.length} Past Entries
                </span>
              </div>

              <h2 className="mt-4 text-xl font-extrabold text-primary">
                Club Training &amp; Smart BP Room Draw
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Manage weekly debate practices, track who signed up as a Debater or Judge,
                auto-balance British Parliamentary positions (OG, OO, CG, CO), and ensure every
                first-year Junior is seen by different Senior Chairs across the semester.
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <Link
                  to="/training?tab=draw"
                  className="group rounded-2xl border border-border bg-muted/35 p-3.5 transition hover:border-primary/40 hover:bg-secondary/35"
                >
                  <p className="text-xs font-extrabold text-primary group-hover:underline">
                    Smart BP Room Draw →
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Auto-pair 8 debaters + chairs &amp; wings per room using historical exposure weights.
                  </p>
                </Link>

                <Link
                  to="/training?tab=results"
                  className="group rounded-2xl border border-border bg-muted/35 p-3.5 transition hover:border-primary/40 hover:bg-secondary/35"
                >
                  <p className="text-xs font-extrabold text-primary group-hover:underline">
                    Ballots &amp; Knowledge Matrix →
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Record speaker scores (50–100) and inspect the Chair × Junior exposure matrix.
                  </p>
                </Link>

                <Link
                  to="/training?tab=roster"
                  className="group rounded-2xl border border-border bg-muted/35 p-3.5 transition hover:border-primary/40 hover:bg-secondary/35"
                >
                  <p className="text-xs font-extrabold text-primary group-hover:underline">
                    Club Roster &amp; Approvals →
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Approve Google SSO signups, tag Juniors vs Seniors, and view position balance.
                  </p>
                </Link>

                <Link
                  to="/training?tab=motions"
                  className="group rounded-2xl border border-border bg-muted/35 p-3.5 transition hover:border-primary/40 hover:bg-secondary/35"
                >
                  <p className="text-xs font-extrabold text-primary group-hover:underline">
                    Motion Bank &amp; Infoslides →
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Curate motions by theme and difficulty and launch the full-screen Projector.
                  </p>
                </Link>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Link
                to="/training"
                className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground transition hover:opacity-95"
              >
                Enter Club Training Workspace
              </Link>
              <Link
                to="/training/projection"
                className="inline-flex h-10 items-center rounded-xl border border-border bg-white px-4 text-xs font-semibold text-foreground transition hover:bg-muted"
              >
                Open Classroom Projector
              </Link>
            </div>
          </div>

          {/* Secondary Space: Annual Screening & Candidate Queue (5 cols) */}
          <div className="flex flex-col justify-between rounded-3xl border border-border bg-white p-6 shadow-xs lg:col-span-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-accent px-3 py-1 text-xs font-bold text-accent-foreground">
                  Annual Tryouts · Screening
                </span>
                <span className="text-xs font-semibold text-muted-foreground">
                  {activeScreeningEvents.length} Active · {events.length} Total Events
                </span>
              </div>

              <h2 className="mt-4 text-xl font-extrabold text-primary">
                Candidate Queue &amp; Annual Screening
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                Run annual club tryout days: check in candidates, dispatch Personal &amp; Debate
                interviews across rooms, customize interviewer rubrics, and review live analytics.
              </p>

              <div className="mt-5 space-y-2.5">
                {activeScreeningEvents.slice(0, 2).map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-center justify-between rounded-2xl border border-border bg-muted/35 px-4 py-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-status-finished" />
                        <p className="text-xs font-bold text-foreground">{ev.name}</p>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {ev.candidate_count} candidates · {ev.room_count} rooms
                      </p>
                    </div>
                    <Link
                      to={`/admin/event/${ev.id}/queue`}
                      className="rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition hover:opacity-95"
                    >
                      Live Queue
                    </Link>
                  </div>
                ))}

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <Link
                    to="/admin/event/new"
                    className="rounded-2xl border border-border bg-muted/25 p-3 text-xs font-semibold text-foreground transition hover:border-primary/40 hover:bg-secondary/30"
                  >
                    + Plan Screening Day
                  </Link>
                  <Link
                    to="/admin/forms"
                    className="rounded-2xl border border-border bg-muted/25 p-3 text-xs font-semibold text-foreground transition hover:border-primary/40 hover:bg-secondary/30"
                  >
                    Interview Form Studio
                  </Link>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Link
                to="/admin"
                className="inline-flex h-10 items-center rounded-xl border border-primary/30 bg-secondary/45 px-4 text-xs font-bold text-primary transition hover:bg-secondary"
              >
                Open Screening Back Office →
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
