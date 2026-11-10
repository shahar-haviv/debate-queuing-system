import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/ui/AppHeader'
import { useTraining } from '../training/hooks/useTraining'
import type { RolePreference, TrainingEventType } from '../training/types'

function formatShortDate(dateStr: string): string {
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
  const { members, sessions, registrations, memberById, actions } = useTraining()

  const nextTraining = sessions[0] ?? null
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    () => nextTraining?.id ?? '',
  )

  // Quick-add expected member to the currently selected training
  const [quickMemberId, setQuickMemberId] = useState('')
  const [quickRole, setQuickRole] = useState<RolePreference>('Debate')

  // Plan Custom Training form state
  const [planOpen, setPlanOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [newTime, setNewTime] = useState('18:30')
  const [newType, setNewType] = useState<TrainingEventType>('Practice')
  const [expectedIds, setExpectedIds] = useState<string[]>([])

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? nextTraining,
    [sessions, selectedSessionId, nextTraining],
  )

  const approvedMembers = useMemo(
    () => members.filter((m) => m.permissions !== 'Pending'),
    [members],
  )

  const enrolledList = useMemo(() => {
    if (!selectedSession) return []
    return registrations
      .filter((r) => r.session_id === selectedSession.id && r.status !== 'Cancelled')
      .map((r) => ({
        ...r,
        member: memberById.get(r.member_id),
      }))
      .filter((r) => Boolean(r.member))
  }, [selectedSession, registrations, memberById])

  const debaters = useMemo(
    () => enrolledList.filter((r) => r.role_preference !== 'Judge'),
    [enrolledList],
  )

  const judges = useMemo(
    () => enrolledList.filter((r) => r.role_preference === 'Judge'),
    [enrolledList],
  )

  const notYetEnrolled = useMemo(() => {
    const enrolledIds = new Set(enrolledList.map((r) => r.member_id))
    return approvedMembers.filter((m) => !enrolledIds.has(m.id))
  }, [approvedMembers, enrolledList])

  const handleQuickAdd = (e: FormEvent) => {
    e.preventDefault()
    if (!selectedSession || !quickMemberId) return
    actions.upsertRegistration({
      sessionId: selectedSession.id,
      memberId: quickMemberId,
      status: 'Registered',
      rolePreference: quickRole,
      languagePreference: 'Hebrew',
    })
    setQuickMemberId('')
  }

  const toggleExpectedMember = (memberId: string) => {
    setExpectedIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId],
    )
  }

  const handleCreateCustomTraining = (e: FormEvent) => {
    e.preventDefault()
    if (!newTitle.trim()) return
    const created = actions.createSession({
      title: newTitle.trim(),
      date: newDate,
      time: newTime,
      event_type: newType,
      expectedMemberIds: expectedIds,
    })
    setSelectedSessionId(created.id)
    setPlanOpen(false)
    setNewTitle('')
    setExpectedIds([])
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-7 sm:px-6">
        {/* 1. Planned Trainings for This Week */}
        <section aria-label="Planned Trainings This Week" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-extrabold tracking-tight text-primary">
                This Week&apos;s Trainings
              </h1>
              <p className="text-xs text-muted-foreground">
                Select a training to see who enrolled or plan a custom session.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setPlanOpen((prev) => !prev)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground shadow-2xs transition hover:opacity-95"
            >
              {planOpen ? 'Close Planner' : '+ Plan Custom Training'}
            </button>
          </div>

          {/* Inline Custom Training Planner */}
          {planOpen && (
            <form
              onSubmit={handleCreateCustomTraining}
              className="rounded-2xl border border-primary/25 bg-white p-5 shadow-sm"
            >
              <h2 className="text-sm font-bold text-primary">Plan Custom Training</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Training title (e.g. Tuesday Practice)"
                  className="h-9 rounded-xl border border-input bg-muted/30 px-3 text-xs font-medium text-foreground focus:border-primary focus:bg-white focus:outline-none sm:col-span-2"
                />
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="h-9 rounded-xl border border-input bg-muted/30 px-3 text-xs font-medium text-foreground focus:border-primary focus:bg-white focus:outline-none"
                />
                <div className="flex gap-2">
                  <input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    className="h-9 flex-1 rounded-xl border border-input bg-muted/30 px-2.5 text-xs font-medium text-foreground focus:border-primary focus:bg-white focus:outline-none"
                  />
                  <select
                    aria-label="Training type"
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as TrainingEventType)}
                    className="h-9 rounded-xl border border-input bg-muted/30 px-2.5 text-xs font-semibold text-foreground focus:border-primary focus:bg-white focus:outline-none"
                  >
                    <option value="Practice">Practice</option>
                    <option value="Lesson">Lesson</option>
                    <option value="Tournament Prep">Prep</option>
                  </select>
                </div>
              </div>

              {/* Select who you're expecting to arrive */}
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">
                    Who are you expecting to arrive? ({expectedIds.length} selected)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setExpectedIds(
                        expectedIds.length === approvedMembers.length
                          ? []
                          : approvedMembers.map((m) => m.id),
                      )
                    }
                    className="text-[11px] font-semibold text-primary hover:underline"
                  >
                    {expectedIds.length === approvedMembers.length ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {approvedMembers.map((m) => {
                    const selected = expectedIds.includes(m.id)
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleExpectedMember(m.id)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          selected
                            ? 'border-primary bg-secondary text-primary'
                            : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {m.full_name_eng} ({m.rank})
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setPlanOpen(false)}
                  className="h-8 rounded-xl border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-8 rounded-xl bg-primary px-4 text-xs font-bold text-primary-foreground"
                >
                  Save Training
                </button>
              </div>
            </form>
          )}

          {/* Planned Training Cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            {sessions.map((sess, idx) => {
              const isSelected = sess.id === selectedSession?.id
              const isNext = idx === 0
              const regs = registrations.filter(
                (r) => r.session_id === sess.id && r.status !== 'Cancelled',
              )
              const arrived = regs.filter((r) => r.status === 'CheckedIn').length

              return (
                <button
                  key={sess.id}
                  type="button"
                  onClick={() => setSelectedSessionId(sess.id)}
                  className={`flex flex-col justify-between rounded-2xl border p-4 text-left transition ${
                    isSelected
                      ? 'border-primary bg-white shadow-sm ring-2 ring-primary/15'
                      : 'border-border bg-white/75 hover:border-primary/40 hover:bg-white'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-muted-foreground">
                        {formatShortDate(sess.date)} · {sess.time || '18:30'}
                      </span>
                      {isNext ? (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                          Next Training
                        </span>
                      ) : (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                          {sess.event_type}
                        </span>
                      )}
                    </div>
                    <h2 className="mt-1.5 text-sm font-extrabold text-primary">{sess.title}</h2>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5 text-xs">
                    <span className="font-semibold text-foreground">
                      {regs.length} enrolled
                    </span>
                    <span className="text-muted-foreground">{arrived} arrived</span>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* 2. Enrolled & Expected Members for Selected Training */}
        {selectedSession && (
          <section
            aria-label="Enrolled Members"
            className="rounded-2xl border border-border bg-white p-5 shadow-2xs sm:p-6"
          >
            <div className="flex flex-col justify-between gap-3 border-b border-border pb-4 sm:flex-row sm:items-center">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-extrabold text-primary sm:text-lg">
                    {selectedSession.title}
                  </h2>
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-bold text-secondary-foreground">
                    {formatShortDate(selectedSession.date)} · {selectedSession.time || '18:30'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {enrolledList.length} enrolled ({debaters.length} debaters, {judges.length}{' '}
                  judges)
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {notYetEnrolled.length > 0 && (
                  <form onSubmit={handleQuickAdd} className="flex items-center gap-1.5">
                    <select
                      aria-label="Add expected member"
                      value={quickMemberId}
                      onChange={(e) => setQuickMemberId(e.target.value)}
                      className="h-8 rounded-xl border border-input bg-muted/40 px-2.5 text-xs font-medium text-foreground focus:border-primary focus:bg-white focus:outline-none"
                    >
                      <option value="">+ Add expected member…</option>
                      {notYetEnrolled.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name_eng} ({m.rank})
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Expected role"
                      value={quickRole}
                      onChange={(e) => setQuickRole(e.target.value as RolePreference)}
                      className="h-8 rounded-xl border border-input bg-muted/40 px-2 text-xs font-semibold text-foreground focus:border-primary focus:bg-white focus:outline-none"
                    >
                      <option value="Debate">Debater</option>
                      <option value="Judge">Judge</option>
                    </select>
                    <button
                      type="submit"
                      disabled={!quickMemberId}
                      className="h-8 rounded-xl bg-secondary px-3 text-xs font-bold text-primary transition hover:opacity-90 disabled:opacity-40"
                    >
                      Add
                    </button>
                  </form>
                )}

                <Link
                  to={`/training?session=${selectedSession.id}`}
                  className="inline-flex h-8 items-center rounded-xl bg-primary px-3.5 text-xs font-bold text-primary-foreground transition hover:opacity-95"
                >
                  Open Room Draw →
                </Link>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {/* Debaters */}
              <div className="rounded-xl border border-border bg-muted/25 p-3.5">
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-primary">
                    Debaters ({debaters.length})
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    {debaters.filter((d) => d.status === 'CheckedIn').length} arrived
                  </span>
                </div>

                {debaters.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    No debaters enrolled yet.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {debaters.map((reg) => {
                      const m = reg.member!
                      const arrived = reg.status === 'CheckedIn'
                      return (
                        <li
                          key={reg.id}
                          className="flex items-center justify-between rounded-xl border border-border/80 bg-white px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground">{m.full_name_eng}</span>
                            <span className="rounded bg-secondary/70 px-1.5 py-0.2 text-[10px] font-semibold text-secondary-foreground">
                              {m.rank}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                actions.upsertRegistration({
                                  sessionId: selectedSession.id,
                                  memberId: m.id,
                                  status: reg.status,
                                  rolePreference: 'Judge',
                                  languagePreference: reg.language_preference,
                                })
                              }
                              className="text-[10px] font-medium text-muted-foreground hover:text-primary"
                            >
                              → Judge
                            </button>
                            <button
                              type="button"
                              onClick={() => actions.toggleCheckIn(selectedSession.id, m.id)}
                              className={`rounded-lg px-2 py-0.5 text-[11px] font-bold transition ${
                                arrived
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-muted-foreground hover:bg-secondary'
                              }`}
                            >
                              {arrived ? 'Arrived' : 'Expected'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                actions.cancelRegistration(selectedSession.id, m.id)
                              }
                              aria-label={`Remove ${m.full_name_eng}`}
                              className="px-1 text-muted-foreground hover:text-destructive"
                            >
                              ×
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              {/* Judges */}
              <div className="rounded-xl border border-border bg-muted/25 p-3.5">
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider text-primary">
                    Judges ({judges.length})
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    {judges.filter((j) => j.status === 'CheckedIn').length} arrived
                  </span>
                </div>

                {judges.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    No judges enrolled yet.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {judges.map((reg) => {
                      const m = reg.member!
                      const arrived = reg.status === 'CheckedIn'
                      return (
                        <li
                          key={reg.id}
                          className="flex items-center justify-between rounded-xl border border-border/80 bg-white px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-foreground">{m.full_name_eng}</span>
                            <span className="rounded bg-accent px-1.5 py-0.2 text-[10px] font-semibold text-accent-foreground">
                              {m.official_judgement_level}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                actions.upsertRegistration({
                                  sessionId: selectedSession.id,
                                  memberId: m.id,
                                  status: reg.status,
                                  rolePreference: 'Debate',
                                  languagePreference: reg.language_preference,
                                })
                              }
                              className="text-[10px] font-medium text-muted-foreground hover:text-primary"
                            >
                              → Debater
                            </button>
                            <button
                              type="button"
                              onClick={() => actions.toggleCheckIn(selectedSession.id, m.id)}
                              className={`rounded-lg px-2 py-0.5 text-[11px] font-bold transition ${
                                arrived
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-muted-foreground hover:bg-secondary'
                              }`}
                            >
                              {arrived ? 'Arrived' : 'Expected'}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                actions.cancelRegistration(selectedSession.id, m.id)
                              }
                              aria-label={`Remove ${m.full_name_eng}`}
                              className="px-1 text-muted-foreground hover:text-destructive"
                            >
                              ×
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
