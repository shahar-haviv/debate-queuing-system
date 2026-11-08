/**
 * The future-event planner.
 *
 * The three steps are local until the final action: details, room allocation and
 * roster import are collected in one draft, then `useEventPlanner` creates the
 * event, its rooms and its candidates in that order. A failure rolls the draft
 * event back, so the hub never shows a half-built day.
 */
import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { EventFormsConfig, Interviewer, NewCandidate, Room, RoomType } from '../core/types'
import { DEBATE_INTERVIEW, PERSONAL_INTERVIEW } from '../core/constants'
import { parseCandidatesCsv, type ParsedCandidates } from '../domain/csv'
import { formatEventDate, todayIso } from '../domain/events'
import { cloneTaskFormConfig, defaultDebateFormConfig } from '../domain/formBuilder'
import { useEventPlanner, type PlannerRoom } from '../hooks/useEventPlanner'
import { useFormTemplates } from '../hooks/useFormTemplates'
import BrandMark from '../components/ui/BrandMark'
import InterviewerModal from '../components/features/InterviewerModal'

const ROOM_TYPES: RoomType[] = ['Debate', 'Personal', 'General']

const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring'

type Step = 1 | 2 | 3

const STEPS: Array<{ number: Step; title: string; hint: string }> = [
  { number: 1, title: 'Event details', hint: 'Name, date and notes' },
  { number: 2, title: 'Room allocation', hint: 'Rooms and interviewers' },
  { number: 3, title: 'Roster import', hint: 'Tie candidates to this event' },
]

function keyFactory(): () => string {
  let counter = 0
  return () => {
    counter += 1
    return `draft-room-${counter}`
  }
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}

export default function EventPlanner() {
  const navigate = useNavigate()
  const { create } = useEventPlanner()
  const { templates } = useFormTemplates()
  const nextKey = useRef(keyFactory())

  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState('')
  const [date, setDate] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [personalTemplateId, setPersonalTemplateId] = useState('builtin-personal-standard')
  const [debateTemplateId, setDebateTemplateId] = useState('paper-only')
  const [rooms, setRooms] = useState<PlannerRoom[]>([])
  const [roomName, setRoomName] = useState('')
  const [roomType, setRoomType] = useState<RoomType>('General')
  const [editingRoomKey, setEditingRoomKey] = useState<string | null>(null)
  const [roster, setRoster] = useState<ParsedCandidates | null>(null)
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const editingRoom = editingRoomKey ? rooms.find((room) => room.key === editingRoomKey) ?? null : null
  const modalRoom: Room | null = editingRoom
    ? {
        id: editingRoom.key,
        event_id: 'draft',
        room_name: editingRoom.room_name,
        room_type: editingRoom.room_type,
        interviewers: editingRoom.interviewers,
      }
    : null

  const panelCount = useMemo(
    () => rooms.reduce((total, room) => total + room.interviewers.length, 0),
    [rooms],
  )

  const addRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = roomName.trim()
    if (!trimmed) return
    setRooms((prev) => [
      ...prev,
      { key: nextKey.current(), room_name: trimmed, room_type: roomType, interviewers: [] },
    ])
    setRoomName('')
  }

  const updateRoom = (key: string, patch: Partial<PlannerRoom>) => {
    setRooms((prev) => prev.map((room) => (room.key === key ? { ...room, ...patch } : room)))
  }

  const removeRoom = (key: string) => {
    setRooms((prev) => prev.filter((room) => room.key !== key))
    if (editingRoomKey === key) setEditingRoomKey(null)
  }

  const savePanel = async (interviewers: Interviewer[]) => {
    if (!editingRoomKey) return false
    updateRoom(editingRoomKey, { interviewers })
    return true
  }

  const next = () => {
    setError('')
    if (step === 1) {
      if (!name.trim() || !date) {
        setError('Give the event a name and a date before continuing.')
        return
      }
      setStep(2)
      return
    }
    if (step === 2) {
      if (rooms.some((room) => !room.room_name.trim())) {
        setError('Every room needs a name before continuing.')
        return
      }
      setStep(3)
    }
  }

  const back = () => {
    setError('')
    setStep((current) => (current === 1 ? 1 : ((current - 1) as Step)))
  }

  const handleFile = async (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0]
    change.target.value = ''
    if (!file) return

    setParsing(true)
    setError('')
    try {
      const parsed = await parseCandidatesCsv(file)
      setRoster(parsed)
      setFileName(file.name)
      if (!parsed.rows.length) {
        setError('That CSV had no usable rows. Check that it has a "שם מלא" (name) column.')
      }
    } catch (cause) {
      setRoster(null)
      setFileName('')
      setError(cause instanceof Error ? cause.message : 'Could not read that CSV.')
    } finally {
      setParsing(false)
    }
  }

  const finish = async () => {
    setCreating(true)
    setError('')
    try {
      const hasCustomForms =
        personalTemplateId !== 'builtin-personal-standard' || debateTemplateId !== 'paper-only'
      let forms: EventFormsConfig | undefined
      if (hasCustomForms) {
        const personalTpl = templates.find((t) => t.id === personalTemplateId)
        const debateTpl = templates.find((t) => t.id === debateTemplateId)
        forms = {
          ...(personalTpl
            ? { [PERSONAL_INTERVIEW]: cloneTaskFormConfig({ ...personalTpl.config, enabled: true }) }
            : {}),
          ...(debateTemplateId === 'paper-only'
            ? { [DEBATE_INTERVIEW]: defaultDebateFormConfig(false) }
            : debateTpl
              ? { [DEBATE_INTERVIEW]: cloneTaskFormConfig({ ...debateTpl.config, enabled: true }) }
              : {}),
        }
      }

      const result = await create({
        name,
        date,
        notes,
        rooms,
        candidates: roster?.rows ?? [],
        ...(forms ? { forms } : {}),
      })
      navigate(`/admin/event/${result.event.id}/queue`, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the event.')
      setCreating(false)
    }
  }

  const candidates: NewCandidate[] = roster?.rows ?? []

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <BrandMark className="size-11" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">New Event</h1>
              <p className="text-sm text-muted-foreground">Plan an interview day before it goes live</p>
            </div>
          </div>
          <Link
            to="/admin"
            className="rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            Back Office
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <ol className="grid gap-2 sm:grid-cols-3" aria-label="Event creation steps">
          {STEPS.map((entry) => {
            const done = entry.number < step
            const active = entry.number === step
            return (
              <li
                key={entry.number}
                className={`rounded-lg border px-4 py-3 ${
                  active
                    ? 'border-primary bg-card shadow-sm'
                    : done
                      ? 'border-status-debate/40 bg-accent/50'
                      : 'border-border bg-muted/30'
                }`}
                aria-current={active ? 'step' : undefined}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-bold ${
                      done
                        ? 'bg-status-debate text-primary-foreground'
                        : active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {done ? <CheckIcon /> : entry.number}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{entry.title}</span>
                </div>
                <p className="mt-1 ps-8 text-xs text-muted-foreground">{entry.hint}</p>
              </li>
            )
          })}
        </ol>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-destructive/30 bg-late-surface px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <section className="mt-5 rounded-xl border border-border bg-card p-5 shadow-sm">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-bold text-foreground">Event details</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  This name appears on the hub and above the live queue.
                </p>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Event name <span className="text-destructive">*</span>
                </span>
                <input
                  className={inputClass}
                  value={name}
                  onChange={(change) => setName(change.target.value)}
                  placeholder="Fall 2026 Tryouts — Day 1"
                  autoFocus
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Date <span className="text-destructive">*</span>
                  </span>
                  <input
                    type="date"
                    className={inputClass}
                    value={date}
                    onChange={(change) => setDate(change.target.value)}
                  />
                  {date && <p className="mt-1 text-xs text-muted-foreground">{formatEventDate(date)}</p>}
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">Status</span>
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    Draft — activate it from the Back Office when the day starts.
                  </div>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">Internal notes</span>
                <textarea
                  className={`${inputClass} min-h-28 resize-y`}
                  value={notes}
                  onChange={(change) => setNotes(change.target.value)}
                  placeholder="Panel arrivals, venue changes, accessibility notes — anything the next coordinator needs."
                />
              </label>

              <div className="rounded-lg border border-border bg-muted/20 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-foreground">
                      Interviewer Form Templates
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Choose starting forms for this day (you can further customize them anytime in the Form Studio).
                    </p>
                  </div>
                  <Link
                    to="/admin/forms"
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Open Form Studio →
                  </Link>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                      Personal Interview Form
                    </span>
                    <select
                      aria-label="Personal Interview Form"
                      value={personalTemplateId}
                      onChange={(change) => setPersonalTemplateId(change.target.value)}
                      className={inputClass}
                    >
                      {templates
                        .filter((tpl) => tpl.task === PERSONAL_INTERVIEW)
                        .map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {tpl.name}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                      Debate Interview Form
                    </span>
                    <select
                      aria-label="Debate Interview Form"
                      value={debateTemplateId}
                      onChange={(change) => setDebateTemplateId(change.target.value)}
                      className={inputClass}
                    >
                      <option value="paper-only">Paper / Dispatch Checkbox Only (Default)</option>
                      {templates
                        .filter((tpl) => tpl.task === DEBATE_INTERVIEW)
                        .map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {tpl.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-foreground">Room allocation</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pre-define the rooms that belong to this day. Candidates will never see another event's rooms.
                </p>
              </div>

              <form onSubmit={addRoom} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
                <label className="min-w-48 flex-1">
                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">Room name</span>
                  <input
                    className={inputClass}
                    value={roomName}
                    onChange={(change) => setRoomName(change.target.value)}
                    placeholder="e.g. A206"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">Type</span>
                  <select
                    className={inputClass}
                    value={roomType}
                    onChange={(change) => setRoomType(change.target.value as RoomType)}
                  >
                    {ROOM_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={!roomName.trim()}
                  className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:brightness-95 disabled:opacity-50"
                >
                  Add room
                </button>
              </form>

              {rooms.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                  No rooms yet. You can also create the event first and add rooms from the live queue.
                </p>
              ) : (
                <ul className="space-y-2">
                  {rooms.map((room) => (
                    <li key={room.key} className="rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          aria-label="Room name"
                          className={`${inputClass} min-w-40 flex-1`}
                          value={room.room_name}
                          onChange={(change) => updateRoom(room.key, { room_name: change.target.value })}
                        />
                        <select
                          aria-label={`Type for ${room.room_name || 'room'}`}
                          className={`${inputClass} w-36`}
                          value={room.room_type}
                          onChange={(change) => updateRoom(room.key, { room_type: change.target.value as RoomType })}
                        >
                          {ROOM_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setEditingRoomKey(room.key)}
                          className="rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
                        >
                          {room.interviewers.length
                            ? `Panel (${room.interviewers.length})`
                            : 'Assign interviewers'}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRoom(room.key)}
                          aria-label={`Remove ${room.room_name || 'room'}`}
                          className="rounded-md px-2 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10"
                        >
                          Remove
                        </button>
                      </div>
                      {room.interviewers.length > 0 && (
                        <p className="mt-1.5 truncate text-xs text-muted-foreground">
                          {room.interviewers.map((person) => person.name).join(', ')}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-muted-foreground">
                {rooms.length} room{rooms.length === 1 ? '' : 's'} · {panelCount} interviewer
                {panelCount === 1 ? '' : 's'} assigned
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-foreground">Roster import</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Every candidate in this CSV is permanently tied to{' '}
                  <span className="font-semibold text-foreground">{name || 'this event'}</span>.
                </p>
              </div>

              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-5 text-center">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleFile}
                />
                <p className="text-sm text-muted-foreground">
                  {parsing
                    ? 'Reading the CSV…'
                    : fileName
                      ? `${fileName} — ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`
                      : 'Upload the same CSV format the dispatch board already understands.'}
                </p>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={parsing}
                  className="mt-3 rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
                >
                  {fileName ? 'Choose another CSV' : 'Choose CSV'}
                </button>
                {roster && roster.skipped > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {roster.skipped} empty row{roster.skipped === 1 ? '' : 's'} skipped.
                  </p>
                )}
              </div>

              {candidates.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Candidate</th>
                        <th className="px-3 py-2 font-semibold">Serial</th>
                        <th className="px-3 py-2 font-semibold">Planned</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.slice(0, 8).map((candidate, index) => (
                        <tr key={`${candidate.serial_number ?? candidate.name}-${index}`} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-foreground">{candidate.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{candidate.serial_number || '—'}</td>
                          <td className="px-3 py-2 text-muted-foreground">{candidate.planned_time || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {candidates.length > 8 && (
                    <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                      +{candidates.length - 8} more candidate{candidates.length - 8 === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">Ready to create</p>
                <p className="mt-1">
                  {rooms.length} room{rooms.length === 1 ? '' : 's'} · {candidates.length} candidate
                  {candidates.length === 1 ? '' : 's'} · Draft status
                </p>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={back}
              disabled={step === 1 || creating}
              className="rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-40"
            >
              Back
            </button>

            {step < 3 ? (
              <button
                type="button"
                onClick={next}
                className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void finish()}
                disabled={creating || parsing}
                className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
              >
                {creating ? 'Creating event…' : 'Create event'}
              </button>
            )}
          </div>
        </section>

        <p className="mt-4 pb-6 text-center text-xs text-muted-foreground">
          The event is created as a Draft. Open its live queue to verify the rooms and roster, then activate it from
          the Back Office.
        </p>
      </main>

      <InterviewerModal
        room={modalRoom}
        saving={false}
        onSave={async (patch) => {
          if (!patch.interviewers) return false
          return savePanel(patch.interviewers)
        }}
        onClose={() => setEditingRoomKey(null)}
      />
    </div>
  )
}
