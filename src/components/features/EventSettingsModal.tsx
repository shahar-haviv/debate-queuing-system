import { useEffect, useState, type FormEvent } from 'react'
import type { EventPatch, EventStatus, QueueEvent } from '../../core/types'
import { EVENT_STATUSES } from '../../domain/events'

const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-ring'

export interface EventSettingsModalProps {
  event: QueueEvent | null
  onClose: () => void
  onSave: (patch: EventPatch) => Promise<unknown>
}

interface FormState {
  name: string
  date: string
  status: EventStatus
  notes: string
}

export default function EventSettingsModal({ event, onClose, onSave }: EventSettingsModalProps) {
  const [form, setForm] = useState<FormState>({ name: '', date: '', status: 'Draft', notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!event) return
    setForm({
      name: event.name,
      date: event.date,
      status: event.status,
      notes: event.notes,
    })
    setError('')
  }, [event])

  useEffect(() => {
    if (!event) return undefined
    const onKey = (keyboard: KeyboardEvent) => {
      if (keyboard.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [event, onClose])

  if (!event) return null

  const handleSubmit = async (submit: FormEvent<HTMLFormElement>) => {
    submit.preventDefault()
    if (!form.name.trim() || !form.date) {
      setError('An event needs a name and a date.')
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSave({
        name: form.name.trim(),
        date: form.date,
        status: form.status,
        notes: form.notes.trim(),
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the event.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${event.name}`}
        className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="text-lg font-bold tracking-tight text-foreground">Event settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Dates, notes and lifecycle status. Rooms and candidates stay scoped to this event.
        </p>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">
              Event name <span className="text-destructive">*</span>
            </span>
            <input
              className={inputClass}
              value={form.name}
              onChange={(change) => setForm((prev) => ({ ...prev, name: change.target.value }))}
              placeholder="Fall 2026 Tryouts — Day 1"
              required
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
                value={form.date}
                onChange={(change) => setForm((prev) => ({ ...prev, date: change.target.value }))}
                required
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">Status</span>
              <select
                className={inputClass}
                value={form.status}
                onChange={(change) =>
                  setForm((prev) => ({ ...prev, status: change.target.value as EventStatus }))
                }
              >
                {EVENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">Internal notes</span>
            <textarea
              className={`${inputClass} min-h-24 resize-y`}
              value={form.notes}
              onChange={(change) => setForm((prev) => ({ ...prev, notes: change.target.value }))}
              placeholder="Panel arrivals, venue changes, anything the next coordinator needs."
            />
          </label>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-late-surface px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
