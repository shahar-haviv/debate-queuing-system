import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { isConfigured, supabase } from '../lib/supabase'
import { formatTimestamp } from '../lib/time'

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  )
}

function StatusBadge({ done, label }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
        done ? 'border-status-debate/30 bg-accent' : 'border-border bg-card'
      }`}
    >
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <span
        className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-bold ${
          done ? 'bg-status-debate text-primary-foreground' : 'bg-muted text-muted-foreground'
        }`}
      >
        {done ? '✓ Done' : 'Pending'}
      </span>
    </div>
  )
}

export default function CandidateView() {
  const { id } = useParams()
  const [candidate, setCandidate] = useState(null)
  const [room, setRoom] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(async () => {
    if (!isConfigured) {
      setLoading(false)
      return
    }
    // Fetch only what this page renders. The candidate's own screen must never
    // receive their serial number or phone number — not even in the payload.
    const { data, error } = await supabase
      .from('candidates')
      .select(
        'name, planned_time, arrival_time, assigned_room, current_task_assignment, debate_interview_completed, personal_interview_completed',
      )
      .eq('id', id)
      .maybeSingle()
    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setCandidate(data)
    setNotFound(false)

    if (data.assigned_room) {
      const { data: roomData } = await supabase
        .from('rooms')
        .select('id, room_name, room_type')
        .eq('id', data.assigned_room)
        .maybeSingle()
      setRoom(roomData ?? null)
    } else {
      setRoom(null)
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  useEffect(() => {
    if (!isConfigured) return undefined

    const channel = supabase
      .channel(`candidate-${id}`)
      .on(
        'postgres_changes',
        // '*' rather than 'UPDATE' so a candidate deleted by an admin makes
        // this page fall back to "not found" immediately instead of waiting
        // up to 30s for the safety-net poll.
        { event: '*', schema: 'public', table: 'candidates', filter: `id=eq.${id}` },
        () => load(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => load())
      .subscribe()

    const poll = setInterval(load, 30_000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(poll)
    }
  }, [id, load])

  if (loading) return <Spinner />

  if (notFound || !candidate) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-2xl">🔍</div>
          <h1 className="mt-4 text-lg font-bold tracking-tight text-foreground">Candidate not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link may be invalid or the candidate may have been removed.
          </p>
          <Link to="/login" className="mt-6 inline-block text-sm font-medium text-primary underline">
            Staff sign in
          </Link>
        </div>
      </div>
    )
  }

  const hasRoom = Boolean(candidate.assigned_room)
  const bothDone = candidate.debate_interview_completed && candidate.personal_interview_completed

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-lg px-4 py-6">
        <header className="rounded-lg border border-border bg-card px-5 py-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Candidate</p>
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground">{candidate.name}</h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {candidate.planned_time && <span>Planned: {candidate.planned_time}</span>}
            {candidate.arrival_time && <span>Arrived: {formatTimestamp(candidate.arrival_time)}</span>}
          </div>
        </header>

        <section className="mt-4">
          {/* "All done" wins: a finished candidate must never be told to go to a room. */}
          {!bothDone && hasRoom && room ? (
            <div className="rounded-lg border-2 border-status-initial bg-status-initial/5 p-6 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-status-initial text-2xl text-primary-foreground">
                ➜
              </div>
              <p className="mt-3 text-lg font-bold tracking-tight text-foreground">
                Please proceed to {room.room_name}
              </p>
              <p className="mt-1 text-sm font-medium text-muted-foreground">
                for your {candidate.current_task_assignment ?? 'interview'}
              </p>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
                <span className="size-2 animate-pulse rounded-full bg-status-initial" />
                Live status
              </div>
            </div>
          ) : bothDone ? (
            <div className="rounded-lg border-2 border-status-debate/40 bg-accent p-6 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-status-debate text-2xl text-primary-foreground">
                ✓
              </div>
              <p className="mt-3 text-lg font-bold tracking-tight text-accent-foreground">All done — thank you!</p>
              <p className="mt-1 text-sm font-medium text-muted-foreground">
                You have completed all of your interviews.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border-2 border-status-arrived/40 bg-late-surface p-6 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-status-arrived text-2xl text-primary-foreground">
                ⏳
              </div>
              <p className="mt-3 text-lg font-bold tracking-tight text-foreground">
                Please wait, you are in the queue.
              </p>
              <p className="mt-1 text-sm font-medium text-muted-foreground">
                Stay nearby — this page updates automatically.
              </p>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
                <span className="size-2 animate-pulse rounded-full bg-status-arrived" />
                Live status
              </div>
            </div>
          )}
        </section>

        <section className="mt-4 space-y-3">
          <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Your progress</h2>
          <StatusBadge done={candidate.debate_interview_completed} label="Debate Interview" />
          <StatusBadge done={candidate.personal_interview_completed} label="Personal Interview" />
        </section>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          This page updates in real time. No sign-in required.
        </p>
      </div>
    </div>
  )
}
