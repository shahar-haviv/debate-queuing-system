import { useEffect, useRef, useState } from 'react'
import { cleanInterviewerRows, roomInterviewers } from '../lib/conflicts'

/**
 * The interviewer panel for one room.
 *
 * A room can host several interviewers at once, so this lists all of them and
 * the edit mode grows and shrinks the list in place. It opens read-only so a
 * stray click can never change a phone number; the admin has to press "Edit"
 * first. `onSave` is expected to resolve to `true` on success and `false` on
 * failure, which keeps the form open for a retry.
 */
function nextKeyFactory() {
  let counter = 0
  return () => {
    counter += 1
    return `panel-${counter}`
  }
}

export default function InterviewerModal({ room, saving, onSave, onClose }) {
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const keyRef = useRef(null)

  // Re-seed the form each time a different room is opened — never on every
  // room update, or realtime pushes would wipe what the admin is typing.
  useEffect(() => {
    if (!room) return
    const keys = nextKeyFactory()
    keyRef.current = keys
    setEditing(false)
    setError('')
    setRows(roomInterviewers(room).map((person) => ({ key: keys(), ...person })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id])

  useEffect(() => {
    if (!room) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [room, onClose])

  if (!room) return null

  const panel = roomInterviewers(room)
  const keys = keyRef.current ?? nextKeyFactory()

  const addRow = () => {
    setRows((current) => [...current, { key: keys(), name: '', phone: '' }])
  }

  const updateRow = (key, field, value) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)))
  }

  const removeRow = (key) => {
    setRows((current) => current.filter((row) => row.key !== key))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    const cleaned = cleanInterviewerRows(rows)
    const ok = await onSave({ interviewers: cleaned })
    if (ok === false) {
      setError('Could not save — please try again.')
      return
    }
    setEditing(false)
    setRows(cleaned.map((person) => ({ key: keys(), ...person })))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl">
        <h2 className="text-lg font-bold tracking-tight text-foreground">{room.room_name}</h2>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {room.room_type} room ·{' '}
          {panel.length === 0
            ? 'no interviewers'
            : `${panel.length} interviewer${panel.length === 1 ? '' : 's'}`}
        </p>

        {editing ? (
          <form className="mt-5 space-y-3 text-start" onSubmit={handleSubmit}>
            {rows.length === 0 && (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                Nobody in this panel. Add an interviewer to start one.
              </p>
            )}

            {rows.map((row, index) => (
              <div
                key={row.key}
                className="rounded-md border border-border bg-muted/30 p-3"
                data-testid="interviewer-row"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Interviewer {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    aria-label={`Remove interviewer ${index + 1}`}
                    className="rounded-md px-2 py-0.5 text-xs font-medium text-destructive transition hover:bg-destructive/10"
                  >
                    Remove
                  </button>
                </div>

                <label className="mt-2 block">
                  <span className="sr-only">Name</span>
                  <input
                    value={row.name}
                    onChange={(event) => updateRow(row.key, 'name', event.target.value)}
                    placeholder="Name, e.g. Dana Levi"
                    aria-label={`Interviewer ${index + 1} name`}
                    className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>

                <label className="mt-2 block">
                  <span className="sr-only">Phone number</span>
                  <input
                    value={row.phone ?? ''}
                    onChange={(event) => updateRow(row.key, 'phone', event.target.value)}
                    inputMode="tel"
                    dir="ltr"
                    placeholder="Phone, e.g. 050-1234567"
                    aria-label={`Interviewer ${index + 1} phone`}
                    className="mt-2 w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>
            ))}

            <button
              type="button"
              onClick={addRow}
              className="w-full rounded-md border border-dashed border-input bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              + Add interviewer
            </button>

            {error && <p className="text-xs font-medium text-destructive">{error}</p>}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setError('')
                  const fresh = nextKeyFactory()
                  keyRef.current = fresh
                  setRows(roomInterviewers(room).map((person) => ({ key: fresh(), ...person })))
                }}
                className="rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save panel'}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-5 space-y-3 text-start">
            {panel.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                No interviewers recorded. An empty panel never blocks an assignment.
              </p>
            ) : (
              <ul className="space-y-2" data-testid="interviewer-panel">
                {panel.map((person) => (
                  <li
                    key={person.name}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-foreground">{person.name}</span>
                    {person.phone ? (
                      <a
                        href={`tel:${person.phone}`}
                        dir="ltr"
                        className="text-sm font-medium text-primary underline underline-offset-2"
                      >
                        {person.phone}
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">no phone</span>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              onClick={() => setEditing(true)}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              {panel.length === 0 ? 'Add interviewer' : 'Edit panel'}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          Close
        </button>
      </div>
    </div>
  )
}
