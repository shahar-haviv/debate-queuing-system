/**
 * The in-room queue board: what the room's interviewers keep open on a phone.
 *
 * Two jobs. First, show who is sitting in this room and for how long. Second,
 * when that candidate is in a **Personal Interview**, put the club's rubric in
 * front of the interviewer and let them file it.
 *
 * The page is behind the same admin gate as the dispatcher view — it names
 * candidates, shows the panel's phone numbers and writes scores, so it is
 * staff-only by design and the `evaluations` table has no anonymous grant.
 *
 * Filing the rubric is two writes, in this order:
 *   1. the evaluation itself (upsert, so a second click edits rather than
 *      duplicates);
 *   2. `personal_interview_completed = true`, which is what releases the room —
 *      database Rule 3 owns the release, so this page never clears the room
 *      itself and can't disagree with the dispatcher view about it.
 * If step 2 fails the evaluation is already safe, so the interviewer is told to
 * retry the release rather than losing what they typed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import EvaluationForm from '../components/EvaluationForm'
import BrandMark from '../components/BrandMark'
import Toast from '../components/Toast'
import { useAuth } from '../hooks/useAuth'
import { useCandidates } from '../hooks/useCandidates'
import { isConfigured, supabase } from '../lib/supabase'
import { createLogger } from '../lib/logger.js'
import { formatDuration, minutesInRoom } from '../lib/time'
import { longestWaitingOccupant, occupantsOf } from '../lib/rooms.js'
import {
  PERSONAL_INTERVIEW,
  PERSONAL_INTERVIEW_FORM,
  buildScores,
  emptyAnswers,
  initialAnswers,
  problemMap,
  recapRows,
  validateAnswers,
} from '../lib/evaluation.js'

const log = createLogger('room')

const TYPE_BAR = {
  Debate: 'bg-status-debate',
  Personal: 'bg-status-initial',
  General: 'bg-status-pending',
}

/** A read-only rendering of a saved rubric, used for the post-submit recap. */
function Recap({ rows, name }) {
  return (
    <section
      dir="rtl"
      lang="he"
      className="rounded-lg border border-status-debate/40 bg-accent/40 p-4 sm:p-5"
    >
      <h2 className="text-sm font-bold text-foreground">
        ההערכה של {name} נשמרה
      </h2>

      <div className="mt-4 space-y-4">
        {rows.map((section) => (
          <div key={section.id}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {section.part}
              {section.heading ? ` — ${section.heading}` : ''}
            </p>
            <dl className="mt-2 space-y-2">
              {section.rows.map((row) => (
                <div key={row.key} className="rounded-md border border-border bg-card p-2.5">
                  <dt className="text-sm font-semibold leading-relaxed text-foreground">{row.label}</dt>
                  <dd
                    className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed ${
                      row.blank ? 'italic text-muted-foreground' : 'text-foreground'
                    }`}
                  >
                    {row.blank ? 'לא הוזן' : row.answer}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  )
}

/** One previously filed evaluation, collapsed to a summary row. */
function RecentEvaluation({ evaluation }) {
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => recapRows(PERSONAL_INTERVIEW_FORM, evaluation.scores ?? {}), [evaluation.scores])
  const name = evaluation.candidate?.name ?? 'Candidate'
  const at = evaluation.created_at ? new Date(evaluation.created_at) : null

  return (
    <li className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start"
      >
        <span className="truncate text-sm font-medium text-foreground">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {evaluation.interviewer_name || '—'}
          {at ? ` · ${at.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
      </button>

      {open && (
        <div dir="rtl" lang="he" className="border-t border-border px-3 py-2">
          <dl className="space-y-2">
            {rows.flatMap((section) =>
              section.rows.map((row) => (
                <div key={row.key}>
                  <dt className="text-xs font-semibold text-foreground">{row.label}</dt>
                  <dd className={`text-xs ${row.blank ? 'italic text-muted-foreground' : 'text-muted-foreground'}`}>
                    {row.blank ? 'לא הוזן' : row.answer}
                  </dd>
                </div>
              )),
            )}
          </dl>
        </div>
      )}
    </li>
  )
}

export default function RoomView() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { candidates, rooms, loading, error } = useCandidates()

  const [answers, setAnswers] = useState(() => emptyAnswers(PERSONAL_INTERVIEW_FORM))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [recap, setRecap] = useState(null)
  const [evaluations, setEvaluations] = useState([])
  const [toast, setToast] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const room = useMemo(() => rooms.find((entry) => entry.id === roomId) ?? null, [rooms, roomId])
  const seated = useMemo(() => (room ? occupantsOf(candidates, room.id) : []), [candidates, room])
  // Longest-waiting first, so the person at the top of the room's queue is the
  // one the rubric is about — the same order the dispatcher's rooms panel lists.
  const occupant = room ? longestWaitingOccupant(candidates, room.id) : null
  const task = occupant?.current_task_assignment ?? null
  const isPersonal = task === PERSONAL_INTERVIEW

  const notify = useCallback((message, tone = 'info') => setToast({ message, tone, id: Date.now() }), [])
  const dismissToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    log.info('room view mounted', { roomId, room: room?.room_name, user: user?.email })
  }, [roomId, room?.room_name, user?.email])

  /* --------------------------- the filed rubrics --------------------------- */
  const loadEvaluations = useCallback(
    async (reason = 'manual') => {
      if (!isConfigured || !roomId) return
      const { data, error: loadError } = await supabase
        .from('evaluations')
        .select('id, candidate_id, task, interviewer_name, scores, created_at, candidate:candidates(name, serial_number)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(25)

      if (loadError) {
        log.error('loading evaluations failed', { roomId, reason, message: loadError.message })
        return
      }
      log.debug('evaluations loaded', { roomId, reason, count: data?.length ?? 0 })
      setEvaluations(data ?? [])
    },
    [roomId],
  )

  useEffect(() => {
    loadEvaluations('mount')
  }, [loadEvaluations])

  /* ------------------------------ the answers ------------------------------ */
  /*
   * The blank form for whichever candidate is in the room, with the two fields
   * the board can supply already filled in. Also the baseline for "has the
   * interviewer actually typed anything" — the prefilled name and serial number
   * are not typing, and treating them as such would make "skip" nag every time.
   */
  const initial = useMemo(
    () =>
      occupant && room
        ? initialAnswers(occupant, room, PERSONAL_INTERVIEW_FORM)
        : emptyAnswers(PERSONAL_INTERVIEW_FORM),
    [occupant, room],
  )

  /*
   * Fill the inputs whenever the room changes hands. Keyed on the candidate id
   * so a realtime update to the room (which hands us a fresh row object every
   * second) cannot wipe what the interviewer has typed.
   *
   * The recap is deliberately *not* cleared when the room empties: filing a
   * rubric releases the room, so the candidate leaving is the expected result of
   * a successful submit and the recap is that submit's confirmation. It is
   * cleared when a *different* candidate turns up, because then the recap on
   * screen would be about somebody who is no longer in front of the interviewer.
   */
  const initialisedForRef = useRef(null)
  useEffect(() => {
    const key = occupant && room ? `${occupant.id}:${room.id}` : null
    if (initialisedForRef.current === key) return
    initialisedForRef.current = key
    setErrors({})
    setAnswers(initial)
    setRecap((current) => (current && occupant && current.candidateId !== occupant.id ? null : current))
  }, [initial, occupant, room])

  /** Anything the interviewer has entered beyond what the board prefilled. */
  const typedSomething = useMemo(
    () =>
      Object.keys(answers).some(
        (key) => String(answers[key] ?? '').trim() !== String(initial[key] ?? '').trim(),
      ),
    [answers, initial],
  )

  const handleChange = useCallback((key, value) => {
    setAnswers((previous) => ({ ...previous, [key]: value }))
    // Clear the error as soon as the field is touched — the inline message has
    // done its job and a stale red line next to a filled field reads as a bug.
    setErrors((previous) => (previous[key] ? { ...previous, [key]: undefined } : previous))
  }, [])

  /** Completing the interview is what releases the room (database Rule 3). */
  const releaseRoom = useCallback(async (candidate) => {
    const { data, error: releaseError } = await supabase
      .from('candidates')
      .update({ personal_interview_completed: true })
      .eq('id', candidate.id)
      .select()
      .single()

    if (releaseError) {
      log.error('release failed', { id: candidate.id, code: releaseError.code, message: releaseError.message })
      return releaseError
    }
    log.info('room released', { id: candidate.id, room: data?.assigned_room ?? null })
    return null
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!occupant || !room) return

    const problems = validateAnswers(PERSONAL_INTERVIEW_FORM, answers)
    if (problems.length > 0) {
      setErrors(problemMap(problems))
      log.warn('evaluation blocked by validation', {
        candidate: occupant.id,
        missing: problems.map((problem) => problem.key),
      })
      document.getElementById(`evaluation-field-${problems[0].key}`)?.focus()
      return
    }

    setBusy(true)
    const scores = buildScores(PERSONAL_INTERVIEW_FORM, answers)
    log.info('submitting evaluation', { candidate: occupant.id, room: room.id })

    const { error: saveError } = await supabase.from('evaluations').upsert(
      {
        candidate_id: occupant.id,
        room_id: room.id,
        task: PERSONAL_INTERVIEW,
        interviewer_name: String(answers.interviewer_name ?? '').trim() || null,
        scores,
        submitted_by: user?.email ?? null,
      },
      { onConflict: 'candidate_id,task' },
    )

    if (saveError) {
      log.error('saving evaluation failed', { candidate: occupant.id, code: saveError.code, message: saveError.message })
      notify(`Could not save the evaluation: ${saveError.message}`, 'error')
      setBusy(false)
      return
    }

    const releaseError = await releaseRoom(occupant)
    setBusy(false)

    if (releaseError) {
      // The scores are already stored, so say so — the interviewer only needs to
      // retry the release, not re-type the rubric.
      notify(`Evaluation saved, but the room was not released: ${releaseError.message}`, 'error')
      return
    }

    setRecap({ candidateId: occupant.id, name: occupant.name, rows: recapRows(PERSONAL_INTERVIEW_FORM, scores) })
    notify('Evaluation saved and the room released.', 'success')
    loadEvaluations('after-submit')
  }, [answers, loadEvaluations, notify, occupant, releaseRoom, room, user?.email])

  const handleSkip = useCallback(async () => {
    if (!occupant) return

    // Only worth a confirmation if there is typing to lose. An untouched form
    // skips straight through — and "untouched" means beyond the name and serial
    // number the board filled in, which are not answers the interviewer wrote.
    if (
      typedSomething &&
      !window.confirm(`Skip the digital feedback for ${occupant.name}? What you typed will not be saved.`)
    ) {
      return
    }

    setBusy(true)
    log.info('skipping digital feedback', { candidate: occupant.id, room: room?.id })
    const releaseError = await releaseRoom(occupant)
    setBusy(false)

    if (releaseError) {
      notify(`Could not release the room: ${releaseError.message}`, 'error')
      return
    }

    setRecap({ candidateId: occupant.id, name: occupant.name, rows: null })
    notify('Room released without an evaluation.', 'info')
    loadEvaluations('after-skip')
  }, [answers, loadEvaluations, notify, occupant, releaseRoom, room?.id, typedSomething])

  const handleSignOut = useCallback(async () => {
    await signOut()
    navigate('/login', { replace: true })
  }, [navigate, signOut])

  /* -------------------------------- render -------------------------------- */
  const minutes = occupant ? minutesInRoom(occupant.room_entry_time, now) : null

  const header = (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <BrandMark className="size-10" />
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
              {room ? (
                <>
                  <span className={`inline-block size-2.5 rounded-full ${TYPE_BAR[room.room_type] ?? 'bg-status-pending'}`} />
                  {room.room_name}
                </>
              ) : (
                'Interview room'
              )}
              {room && (
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {room.room_type}
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              {seated.length > 0 ? `${seated.length} in the room` : 'Empty right now'}
              {minutes != null && ` · ⏱️ ${formatDuration(minutes)}`}
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
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        {header}
        <p className="mx-auto max-w-4xl px-4 py-10 text-sm text-muted-foreground">Loading the room…</p>
      </div>
    )
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-background">
        {header}
        <div className="mx-auto max-w-4xl px-4 py-10">
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <h2 className="text-lg font-bold text-foreground">Room not found</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This room may have been deleted. Open the dispatch board to pick another one.
            </p>
            <Link
              to="/admin"
              className="mt-5 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110"
            >
              Back to the dispatch board
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {header}

      <main className="mx-auto max-w-4xl px-4 py-5">
        {error && (
          <p className="mb-4 rounded-md border border-destructive/30 bg-late-surface px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* The candidate in front of the interviewer right now. */}
        <section className="mb-5 rounded-lg border border-border bg-card p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            With the interviewer now
          </h2>

          {occupant ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-foreground">{occupant.name}</p>
                <p className="text-xs text-muted-foreground">
                  {occupant.serial_number ? `#${occupant.serial_number} · ` : ''}
                  {task ?? 'No interview selected'}
                  {minutes != null && ` · in the room ${formatDuration(minutes)}`}
                </p>
              </div>
              <span className="shrink-0 rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                {task ? task.replace(' Interview', '') : 'Idle'}
              </span>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Nobody is in this room. Candidates appear here the moment the dispatcher assigns them.
            </p>
          )}

          {seated.length > 1 && (
            <ul className="mt-3 space-y-1 border-t border-border pt-3">
              {seated.slice(1).map((candidate) => (
                <li key={candidate.id} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{candidate.name}</span>
                  <span className="shrink-0">next in the room</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* The rubric — only for a Personal Interview. */}
        {recap ? (
          <div className="space-y-4">
            {recap.rows ? (
              <Recap rows={recap.rows} name={recap.name} />
            ) : (
              <section className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-foreground">
                  {recap.name} was released without an evaluation.
                </p>
              </section>
            )}
            <p className="text-xs text-muted-foreground">
              The room is free again — the dispatcher board already shows it as empty.
            </p>
          </div>
        ) : occupant && isPersonal ? (
          <EvaluationForm
            form={PERSONAL_INTERVIEW_FORM}
            values={answers}
            errors={errors}
            busy={busy}
            onChange={handleChange}
            onSubmit={handleSubmit}
            onSkip={handleSkip}
          />
        ) : occupant ? (
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">
              This candidate is in a {task ?? 'different interview'}.
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The digital rubric is only defined for a Personal Interview. Mark a Debate Interview complete from the
              dispatch board once it is done.
            </p>
            <Link
              to="/admin"
              className="mt-4 inline-block rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              Open the dispatch board
            </Link>
          </section>
        ) : (
          <section className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
            The rubric appears here as soon as somebody in a Personal Interview is in this room.
          </section>
        )}

        {/* Everything filed in this room, newest first. */}
        {evaluations.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Filed in this room
            </h2>
            <ul className="mt-2 space-y-1.5">
              {evaluations.map((evaluation) => (
                <RecentEvaluation key={evaluation.id} evaluation={evaluation} />
              ))}
            </ul>
          </section>
        )}
      </main>

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
