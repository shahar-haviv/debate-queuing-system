import { useEffect, useState } from 'react'
import { ROOM_LONG_THRESHOLD_MINUTES, formatDuration, minutesInRoom } from '../lib/time'
import { roomInterviewers } from '../lib/conflicts'
import InterviewerModal from './InterviewerModal'

const ROOM_TYPES = ['General', 'Debate', 'Personal']

const TYPE_BAR = {
  Debate: 'bg-status-debate',
  Personal: 'bg-status-initial',
  General: 'bg-status-pending',
}

/**
 * Re-renders once a minute so the "time in room" counters stay live.
 *
 * The first tick is aligned to the wall-clock minute so the number flips
 * exactly when the minute changes rather than 60s after mount, and returning
 * to a backgrounded tab refreshes immediately — browsers throttle timers in
 * hidden tabs, which would otherwise leave a stale counter on screen.
 */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let interval
    const timeout = setTimeout(() => {
      setNow(Date.now())
      interval = setInterval(() => setNow(Date.now()), 60_000)
    }, 60_000 - (Date.now() % 60_000))

    const onVisible = () => {
      if (!document.hidden) setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return now
}

function RoomCard({ room, candidates, now, busy, onUpdateRoom, onDeleteRoom, onShowInterviewer }) {
  // Longest-waiting first: the person who has been in this room the longest is
  // at the top, so the interviewer can see who is next without doing sums. The
  // clock is the in-room one (Rule 5 owns it), with the arrival stamp as a
  // fallback for a row that predates it.
  const seatedSince = (candidate) => {
    const stamp = candidate.room_entry_time ?? candidate.arrival_time
    const ms = stamp ? new Date(stamp).getTime() : NaN
    return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms
  }
  const queue = candidates
    .filter((candidate) => candidate.assigned_room === room.id)
    .sort((a, b) => seatedSince(a) - seatedSince(b))
  const active = queue.length > 0
  const panel = roomInterviewers(room)
  const hasInterviewer = panel.length > 0

  return (
    <div
      className={`rounded-md border p-3 transition ${
        active
          ? 'border-status-debate bg-accent ring-1 ring-status-debate/30'
          : 'border-status-debate/40 bg-accent/60'
      } ${busy ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-block size-2 shrink-0 rounded-full ${TYPE_BAR[room.room_type] ?? 'bg-status-pending'}`} />
          <button
            type="button"
            onClick={() => onShowInterviewer(room)}
            title={hasInterviewer ? 'Edit interviewer panel' : 'Add interviewers'}
            className="min-w-0 truncate rounded font-semibold text-accent-foreground underline-offset-2 transition hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {room.room_name}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <select
            aria-label={`Type for ${room.room_name}`}
            value={room.room_type}
            onChange={(event) => onUpdateRoom(room, { room_type: event.target.value })}
            className="rounded border border-input bg-card px-1 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          >
            {ROOM_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Delete ${room.room_name}`}
            title={`Delete ${room.room_name}`}
            onClick={() => onDeleteRoom(room)}
            className="rounded px-1 text-sm leading-none text-muted-foreground transition hover:text-destructive"
          >
            ✕
          </button>
        </div>
      </div>

      {/* The whole panel shows in the card itself — the modal is only needed to edit it. */}
      {hasInterviewer ? (
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-accent-foreground/80">
          <span aria-hidden="true">👥</span>
          {panel.map((person) => (
            <span key={person.name} className="inline-flex min-w-0 items-center gap-1">
              <span className="truncate font-medium">{person.name}</span>
              {person.phone && (
                <a
                  href={`tel:${person.phone}`}
                  dir="ltr"
                  title={`Call ${person.name} — ${person.phone}`}
                  className="shrink-0 text-primary underline underline-offset-2"
                >
                  {person.phone}
                </a>
              )}
            </span>
          ))}
          <button
            type="button"
            onClick={() => onShowInterviewer(room)}
            title="Edit interviewer panel"
            aria-label={`Edit interviewer panel for ${room.room_name}`}
            className="shrink-0 rounded px-0.5 text-muted-foreground transition hover:text-primary"
          >
            ✎
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onShowInterviewer(room)}
          className="mt-1.5 text-[11px] text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline"
        >
          + Add interviewer
        </button>
      )}

      {active ? (
        <>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-status-debate">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-status-debate" />
            {queue.length} active
          </p>
          <ul className="mt-1.5 space-y-1">
            {queue.map((candidate) => {
              const minutes = minutesInRoom(candidate.room_entry_time, now)
              const runningLong = minutes != null && minutes >= ROOM_LONG_THRESHOLD_MINUTES
              return (
                <li
                  key={candidate.id}
                  className="flex items-center gap-1.5 rounded border border-status-debate/20 bg-card px-2 py-1 text-xs"
                >
                  <span className="truncate font-medium text-foreground">{candidate.name}</span>

                  {minutes != null && (
                    <span
                      title={`In ${room.room_name} for ${formatDuration(minutes)}${
                        runningLong ? ' — running long' : ''
                      }`}
                      className={`shrink-0 tabular-nums ${
                        runningLong ? 'font-semibold text-destructive' : 'text-muted-foreground'
                      }`}
                    >
                      ⏱️ {formatDuration(minutes)}
                      {runningLong && ' ⚠️'}
                    </span>
                  )}

                  <span className="ms-auto shrink-0 text-muted-foreground">
                    {(candidate.current_task_assignment ?? '').replace(' Interview', '') || '—'}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">Empty queue</p>
      )}
    </div>
  )
}

export default function RoomsPanel({ rooms, candidates, busyId, onAddRoom, onUpdateRoom, onDeleteRoom }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('General')
  const [adding, setAdding] = useState(false)
  const [interviewerRoomId, setInterviewerRoomId] = useState(null)
  const now = useMinuteClock()

  // Read the room back out of live state rather than keeping a snapshot, so a
  // save (or another admin's edit) shows up in the open modal immediately.
  const interviewerRoom = interviewerRoomId
    ? rooms.find((room) => room.id === interviewerRoomId) ?? null
    : null

  const handleSubmit = async (event) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setAdding(true)
    try {
      const ok = await onAddRoom({ room_name: trimmed, room_type: type })
      // Keep the typed name when the insert failed so it can be retried.
      if (ok !== false) setName('')
    } catch {
      /* onAddRoom surfaces its own error; just keep the field populated */
    } finally {
      setAdding(false)
    }
  }

  return (
    <section className="mb-6 border-b border-border pb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Rooms</h2>

        <form className="flex flex-wrap gap-2" onSubmit={handleSubmit}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New room name"
            className="w-40 rounded-md border border-input bg-card px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <select
            aria-label="New room type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="rounded-md border border-input bg-card px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {ROOM_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={adding || !name.trim()}
            className="rounded-md bg-secondary px-4 py-1.5 text-sm font-medium text-secondary-foreground transition hover:brightness-95 disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add room'}
          </button>
        </form>
      </div>

      {rooms.length === 0 ? (
        <p className="rounded-md border border-border bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">
          No rooms yet — add one to start assigning candidates.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              candidates={candidates}
              now={now}
              busy={busyId === room.id}
              onUpdateRoom={onUpdateRoom}
              onDeleteRoom={onDeleteRoom}
              onShowInterviewer={(target) => setInterviewerRoomId(target.id)}
            />
          ))}
        </div>
      )}

      <InterviewerModal
        room={interviewerRoom}
        saving={Boolean(interviewerRoom) && busyId === interviewerRoom.id}
        onSave={async (patch) => onUpdateRoom(interviewerRoom, patch)}
        onClose={() => setInterviewerRoomId(null)}
      />
    </section>
  )
}
