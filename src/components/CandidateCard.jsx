import { formatTimestamp } from '../lib/time'
import { neededTasks } from '../lib/autoAssign'
import { blockedInterviewers, conflictingInterviewers, constraintLabels, hasInterviewerConflict } from '../lib/conflicts'

function Chip({ children, tone = 'muted' }) {
  const tones = {
    muted: 'bg-muted text-muted-foreground',
    late: 'bg-destructive text-destructive-foreground',
    debate: 'bg-status-debate/15 text-status-debate',
    initial: 'bg-status-initial/15 text-status-initial',
    done: 'bg-accent text-accent-foreground',
    next: 'bg-primary text-primary-foreground',
  }
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  )
}

/** `1st`, `2nd`, `3rd`, `4th`… — for the place in line. */
function ordinal(n) {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

function IconButton({ label, onClick, tone = 'muted', disabled = false, children }) {
  const tones = {
    muted: 'text-muted-foreground hover:bg-muted hover:text-foreground',
    danger: 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
    accent: 'text-primary hover:bg-primary/10',
  }
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  )
}

/** Magic wand — "send them to the best room for me". */
function WandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
      aria-hidden="true"
    >
      <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M12.2 6.2 11 5" />
      <path d="m3 21 9-9" />
    </svg>
  )
}

const selectClass =
  'w-full rounded-md border border-input bg-card px-2 py-1 text-xs outline-none transition focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground'

/**
 * The interview a room's type implies (the same Rule 6 the database enforces).
 * A General room implies nothing, so it returns null and the admin chooses.
 */
function taskForRoomType(roomType) {
  if (roomType === 'Debate') return 'Debate Interview'
  if (roomType === 'Personal') return 'Personal Interview'
  return null
}

export default function CandidateCard({
  candidate,
  rooms,
  late = false,
  busy = false,
  queuePosition = null,
  onPatch,
  onEdit,
  onDelete,
  onShowQr,
  onAutoAssign,
}) {
  const locked = !candidate.has_arrived
  const room = rooms.find((item) => item.id === candidate.assigned_room)
  const allDone = candidate.debate_interview_completed && candidate.personal_interview_completed

  // Nothing left to dispatch once both interviews are done, so the wand only
  // appears on a candidate who still owes one. Once both are outstanding there
  // is no single answer: the wand picks whichever track has room for them, so
  // the label must not promise a particular interview.
  const needed = neededTasks(candidate)
  const autoTask = needed.length > 0
  const wandLabel =
    needed.length > 1
      ? 'Auto-assign to the emptiest room on either track'
      : `Auto-assign to the best room for a ${needed[0]}`

  // Rule 7 — interviewers this candidate must not be sent to.
  const blocked = blockedInterviewers(candidate)
  const blockedLabels = constraintLabels(candidate)
  const sittingWithConflict = Boolean(room) && hasInterviewerConflict(room, candidate)
  const sittingWith = sittingWithConflict ? conflictingInterviewers(room, candidate) : []

  // The task is a property of the room, not a choice — so the only time the
  // admin is asked for it is a General room, which implies nothing.
  const derivedTask = taskForRoomType(room?.room_type)
  const askForTask = Boolean(candidate.assigned_room) && !derivedTask

  const handleRoomChange = (value) => {
    const nextRoom = rooms.find((item) => item.id === value) ?? null
    onPatch(candidate.id, {
      assigned_room: value || null,
      // Mirror of the server rule: the room's type decides the task. A General
      // room implies nothing, so there we keep whatever was already chosen.
      current_task_assignment: value
        ? (taskForRoomType(nextRoom?.room_type) ?? candidate.current_task_assignment ?? null)
        : null,
    })
  }

  /**
   * Un-ticking "Arrived" resets the candidate server-side (room, task and both
   * interview results are cleared). Warn before silently discarding work.
   */
  const handleArrivalToggle = (next) => {
    if (!next) {
      const wouldDiscard =
        candidate.assigned_room ||
        candidate.debate_interview_completed ||
        candidate.personal_interview_completed
      if (wouldDiscard) {
        const confirmed = window.confirm(
          `Un-mark “${candidate.name}” as arrived?\n\nThis also clears their room assignment and both interview results, putting them back in the not-arrived queue.`,
        )
        if (!confirmed) return
      }
    }
    onPatch(candidate.id, { has_arrived: next })
  }

  return (
    <article
      className={`rounded-lg border p-3 transition ${busy ? 'opacity-50' : ''} ${
        late
          ? 'border-destructive/40 bg-late-surface'
          : allDone
            ? 'border-status-debate/30 bg-accent/40'
            : 'border-border bg-card'
      }`}
    >
      {/* identity */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {candidate.serial_number && (
            <span className="mt-0.5 shrink-0 rounded bg-foreground px-1.5 py-0.5 font-mono text-[11px] font-bold text-background">
              #{candidate.serial_number}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold text-foreground">{candidate.name}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>🕒 {candidate.planned_time || '—'}</span>
              {candidate.phone_number && <span dir="ltr">{candidate.phone_number}</span>}
              {candidate.arrival_time && <span>arrived {formatTimestamp(candidate.arrival_time)}</span>}
              {blocked.length > 0 && (
                <span className="font-semibold text-destructive">
                  🚫 no {blockedLabels.join(', ')}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {/* Place in the waiting line: pure arrival order, planned time has no say. */}
          {queuePosition && (
            <Chip tone={queuePosition === 1 ? 'next' : 'muted'}>{ordinal(queuePosition)} in line</Chip>
          )}
          {late && <Chip tone="late">LATE</Chip>}
          {allDone && <Chip tone="done">DONE</Chip>}
          {room && (
            <Chip tone={candidate.current_task_assignment === 'Personal Interview' ? 'initial' : 'debate'}>
              {room.room_name}
              {candidate.current_task_assignment
                ? ` · ${candidate.current_task_assignment.replace(' Interview', '')}`
                : ''}
            </Chip>
          )}
        </div>
      </div>

      {/* arrival */}
      <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-md bg-muted px-2.5 py-2 text-sm font-medium text-foreground">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={candidate.has_arrived}
          onChange={(event) => handleArrivalToggle(event.target.checked)}
        />
        Arrived
      </label>

      {/* interviews + dispatch */}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label
          className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-medium ${
            locked ? 'border-border bg-muted text-muted-foreground' : 'border-input bg-card text-foreground'
          }`}
        >
          <input
            type="checkbox"
            disabled={locked}
            className="size-3.5 accent-status-debate disabled:cursor-not-allowed"
            checked={candidate.debate_interview_completed}
            onChange={(event) => onPatch(candidate.id, { debate_interview_completed: event.target.checked })}
          />
          Debate done
        </label>

        <label
          className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs font-medium ${
            locked ? 'border-border bg-muted text-muted-foreground' : 'border-input bg-card text-foreground'
          }`}
        >
          <input
            type="checkbox"
            disabled={locked}
            className="size-3.5 accent-status-initial disabled:cursor-not-allowed"
            checked={candidate.personal_interview_completed}
            onChange={(event) => onPatch(candidate.id, { personal_interview_completed: event.target.checked })}
          />
          Personal done
        </label>

        <select
          disabled={locked}
          className={`${selectClass} ${askForTask ? '' : 'sm:col-span-2'}`}
          value={candidate.assigned_room ?? ''}
          onChange={(event) => handleRoomChange(event.target.value)}
          aria-label="Assigned room"
        >
          <option value="">No room assigned</option>
          {rooms.map((item) => {
            const conflict = hasInterviewerConflict(item, candidate)
            return (
              <option key={item.id} value={item.id} disabled={conflict}>
                {item.room_name} · {item.room_type}
                {conflict ? ' (Blocked: Conflict)' : ''}
              </option>
            )
          })}
        </select>

        {/* Only asked for when the room itself can't answer: a General room. */}
        {askForTask && (
          <select
            disabled={locked}
            className={selectClass}
            value={candidate.current_task_assignment ?? ''}
            onChange={(event) => onPatch(candidate.id, { current_task_assignment: event.target.value || null })}
            aria-label="Current task"
          >
            <option value="">Task…</option>
            <option value="Debate Interview">Debate Interview</option>
            <option value="Personal Interview">Personal Interview</option>
          </select>
        )}
      </div>

      {sittingWithConflict && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-late-surface px-2.5 py-2 text-[11px] font-medium text-destructive">
          ⚠️ Conflict of interest: {sittingWith.join(', ')} {sittingWith.length === 1 ? 'is' : 'are'} on this
          candidate’s restricted list — move them to another room.
        </p>
      )}

      {locked && (
        <p className="mt-2 text-[11px] text-status-arrived">
          🔒 Mark as arrived to unlock interviews and room assignment.
        </p>
      )}

      {/* actions */}
      <div className="mt-2 flex items-center justify-end gap-1 border-t border-border pt-2">
        {autoTask && (
          <IconButton
            label={wandLabel}
            tone="accent"
            disabled={busy}
            onClick={() => onAutoAssign(candidate)}
          >
            <span className="inline-flex items-center gap-1">
              <WandIcon />
              Auto
            </span>
          </IconButton>
        )}
        <IconButton label="Show QR code" onClick={() => onShowQr(candidate)}>
          QR
        </IconButton>
        <IconButton label="Edit candidate" onClick={() => onEdit(candidate)}>
          Edit
        </IconButton>
        <IconButton label="Delete candidate" tone="danger" onClick={() => onDelete(candidate)}>
          Delete
        </IconButton>
      </div>
    </article>
  )
}
