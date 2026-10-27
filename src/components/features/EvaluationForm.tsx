/**
 * The interviewer's rubric, rendered.
 *
 * Pure presentation: the questions come from `domain/evaluation`, the answers
 * and errors arrive as props, and the component only knows how to draw a `text`,
 * `number`, `textarea` or `scale` question.
 *
 * `dir="rtl"` is set on the form itself rather than inherited from `<html>`,
 * because the rest of the app is English chrome. The two closing buttons live in
 * a `sticky bottom-0` bar so they cannot be scrolled out of reach.
 */
import type { Answers, FormQuestion, RubricForm, ValidationProblems } from '../../core/types'
import { flattenQuestions } from '../../domain/evaluation'

const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-60'

const fieldId = (key: string): string => `evaluation-field-${key}`

/** The `*` on a mandatory question. Outside the `<label>` so the field's
 * accessible name stays exactly the question text. */
function RequiredMark() {
  return (
    <span aria-hidden="true" title="שדה חובה" className="shrink-0 font-bold text-destructive">
      *
    </span>
  )
}

function QuestionShell({
  question,
  error,
  children,
}: {
  question: FormQuestion
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-1">
        <label htmlFor={fieldId(question.key)} className="text-sm font-semibold leading-relaxed text-foreground">
          {question.label}
        </label>
        {question.required && <RequiredMark />}
      </div>

      {question.hint && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span aria-hidden="true">&#8627; </span>
          {question.hint}
        </p>
      )}

      {children}

      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function ScaleQuestion({
  question,
  value,
  error,
  disabled,
  onChange,
}: {
  question: FormQuestion
  value?: string
  error?: string
  disabled: boolean
  onChange: (key: string, value: string) => void
}) {
  const labels = question.scaleLabels ?? {}
  const values = [1, 2, 3, 4, 5]

  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <div className="flex items-start gap-1">
        <legend className="text-sm font-semibold leading-relaxed text-foreground">{question.label}</legend>
        {question.required && <RequiredMark />}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((score) => {
          const id = `${fieldId(question.key)}-${score}`
          const selected = String(value) === String(score)
          return (
            <label
              key={score}
              htmlFor={id}
              className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium tabular-nums transition focus-within:ring-2 focus-within:ring-ring ${
                selected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-card text-foreground hover:border-primary/50'
              }`}
            >
              <input
                id={id}
                type="radio"
                name={question.key}
                value={score}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(question.key, String(score))}
                aria-label={`${question.label} — ${score}`}
                className="sr-only"
              />
              {score}
            </label>
          )
        })}
      </div>

      {(labels[1] || labels[5]) && (
        <div className="flex items-start justify-between gap-3 text-[11px] leading-snug text-muted-foreground">
          <span className="max-w-[45%]">{labels[1] && `1 — ${labels[1]}`}</span>
          <span className="max-w-[45%] text-end">{labels[5] && `5 — ${labels[5]}`}</span>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  )
}

function Question({
  question,
  value,
  error,
  disabled,
  onChange,
}: {
  question: FormQuestion
  value?: string
  error?: string
  disabled: boolean
  onChange: (key: string, value: string) => void
}) {
  if (question.type === 'scale') {
    return (
      <ScaleQuestion question={question} value={value} error={error} disabled={disabled} onChange={onChange} />
    )
  }

  const id = fieldId(question.key)

  if (question.type === 'textarea') {
    return (
      <QuestionShell question={question} error={error}>
        <textarea
          id={id}
          rows={3}
          value={value ?? ''}
          disabled={disabled}
          onChange={(event) => onChange(question.key, event.target.value)}
          className={`${inputClass} resize-y leading-relaxed`}
        />
      </QuestionShell>
    )
  }

  return (
    <QuestionShell question={question} error={error}>
      <input
        id={id}
        type={question.type === 'number' ? 'number' : 'text'}
        inputMode={question.type === 'number' ? 'numeric' : undefined}
        dir={question.type === 'number' ? 'ltr' : undefined}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(question.key, event.target.value)}
        className={inputClass}
      />
    </QuestionShell>
  )
}

export interface EvaluationFormProps {
  form: RubricForm
  values?: Answers
  errors?: ValidationProblems
  busy?: boolean
  onChange: (key: string, value: string) => void
  onSubmit?: () => void
  onSkip?: () => void
  submitLabel?: string
  skipLabel?: string
}

export default function EvaluationForm({
  form,
  values = {},
  errors = {},
  busy = false,
  onChange,
  onSubmit,
  onSkip,
  submitLabel = 'Submit Evaluation & Release Room',
  skipLabel = 'Skip Digital Feedback & Release Room',
}: EvaluationFormProps) {
  const questions = flattenQuestions(form)
  const missing = questions.filter(
    (question) => question.required && String(values[question.key] ?? '').trim() === '',
  ).length

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit?.()
  }

  return (
    <form dir="rtl" lang="he" onSubmit={handleSubmit} aria-busy={busy} className="space-y-4">
      {form.map((section) => (
        <section key={section.id} className="rounded-lg border border-border bg-card p-4 shadow-sm sm:p-5">
          <header className="border-b border-border pb-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {section.part}
              {section.heading ? ` — ${section.heading}` : ''}
            </p>
            {section.intro && (
              <p className="mt-2 text-sm font-medium leading-relaxed text-foreground">{section.intro}</p>
            )}
          </header>

          <div className="mt-4 space-y-5">
            {(section.questions ?? []).map((question) => (
              <Question
                key={question.key}
                question={question}
                value={values[question.key]}
                error={errors[question.key]}
                disabled={busy}
                onChange={onChange}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Sticks to the bottom of the viewport while the rubric scrolls past, so
          neither button can be scrolled out of reach. */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60 sm:w-auto"
          >
            {busy ? 'Submitting...' : submitLabel}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => onSkip?.()}
            className="w-full rounded-md border border-input bg-card px-5 py-3 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-60 sm:w-auto"
          >
            {skipLabel}
          </button>

          {missing > 0 && (
            <p className="self-center text-xs text-muted-foreground sm:me-auto">
              {missing} שדות חובה טרם מולאו
            </p>
          )}
        </div>
      </div>
    </form>
  )
}
