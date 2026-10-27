import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Candidate, CandidatePatch } from '../../core/types'
import { normalizeTime } from '../../domain/time'
import { constraintsToText, parseConstraintList } from '../../domain/conflicts'

const EMPTY: FormState = {
  serial_number: '',
  name: '',
  phone_number: '',
  planned_time: '',
  interviewer_constraints: '',
}

interface FormState {
  serial_number: string
  name: string
  phone_number: string
  planned_time: string
  interviewer_constraints: string
}

const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring'

export interface AddEditCandidateModalProps {
  open: boolean
  candidate: Candidate | null
  onClose: () => void
  onSave: (values: CandidatePatch, id?: string) => Promise<unknown>
}

export default function AddEditCandidateModal({
  open,
  candidate,
  onClose,
  onSave,
}: AddEditCandidateModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    if (candidate) {
      setForm({
        serial_number: candidate.serial_number ?? '',
        name: candidate.name ?? '',
        phone_number: candidate.phone_number ?? '',
        planned_time: normalizeTime(candidate.planned_time) ?? '',
        interviewer_constraints: constraintsToText(candidate),
      })
    } else {
      setForm(EMPTY)
    }
  }, [open, candidate])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const update =
    (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      setForm((prev) => ({ ...prev, [field]: value }))
    }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(
        {
          serial_number: form.serial_number.trim() || null,
          name: form.name.trim(),
          phone_number: form.phone_number.trim() || null,
          planned_time: normalizeTime(form.planned_time),
          interviewer_constraints: parseConstraintList(form.interviewer_constraints),
        },
        candidate?.id,
      )
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the candidate.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={candidate ? 'Edit candidate' : 'Add candidate'}
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl"
      >
        <h2 className="text-lg font-bold tracking-tight text-foreground">
          {candidate ? 'Edit candidate' : 'Add candidate'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {candidate ? 'Update the candidate details.' : 'Register a new candidate in the queue.'}
        </p>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-3 gap-3">
            <label className="col-span-1 block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">Serial #</span>
              <input className={inputClass} value={form.serial_number} onChange={update('serial_number')} placeholder="42" />
            </label>
            <label className="col-span-2 block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                Full name <span className="text-destructive">*</span>
              </span>
              <input
                className={inputClass}
                value={form.name}
                onChange={update('name')}
                placeholder="שם מלא"
                required
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">Phone</span>
              <input
                dir="ltr"
                className={inputClass}
                value={form.phone_number}
                onChange={update('phone_number')}
                placeholder="050-0000000"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">Planned time</span>
              <input type="time" className={inputClass} value={form.planned_time} onChange={update('planned_time')} />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">Interviewer conflicts</span>
            <input
              className={inputClass}
              value={form.interviewer_constraints}
              onChange={update('interviewer_constraints')}
              placeholder="daniel, Dana"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Comma-separated. These interviewers will never be assigned to this candidate - their rooms are
              greyed out and Auto-Assign skips them. Matching ignores case and extra spaces.
            </span>
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
              {saving ? 'Saving...' : candidate ? 'Save changes' : 'Add candidate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
