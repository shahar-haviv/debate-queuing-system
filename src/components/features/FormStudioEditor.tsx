/**
 * Visual Form Builder & Live Side-by-Side Preview for Interview Rubrics.
 *
 * Lets Back Office coordinators customize sections, question types, required
 * flags, interviewer hints, scale ranges/anchors, choice options, language
 * direction (RTL/LTR) and submit/skip button labels — while testing the exact
 * form live in a simulated interviewer room screen.
 */
import { useEffect, useMemo, useState } from 'react'
import type {
  Answers,
  FormDirection,
  FormQuestion,
  FormTemplate,
  QuestionType,
  TaskAssignment,
  TaskFormConfig,
  ValidationProblems,
} from '../../core/types'
import { DEBATE_INTERVIEW, PERSONAL_INTERVIEW } from '../../core/constants'
import {
  emptyAnswers,
  flattenQuestions,
  initialAnswers,
  problemMap,
  validateAnswers,
} from '../../domain/evaluation'
import {
  addQuestion,
  addSection,
  cloneTaskFormConfig,
  defaultTaskFormConfig,
  duplicateQuestion,
  moveQuestion,
  moveSection,
  removeQuestion,
  removeSection,
  updateQuestion,
  updateSection,
} from '../../domain/formBuilder'
import EvaluationForm from './EvaluationForm'

const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring'

const QUESTION_TYPE_LABELS: Array<{ value: QuestionType; label: string }> = [
  { value: 'text', label: 'Short text (שורה אחת)' },
  { value: 'textarea', label: 'Long paragraph (פסקה ארוכה)' },
  { value: 'number', label: 'Number (מספר)' },
  { value: 'scale', label: 'Rating scale (דירוג מספרי)' },
  { value: 'select', label: 'Single choice dropdown (בחירה יחידה)' },
  { value: 'multiselect', label: 'Multiple choice checkboxes (בחירה מרובה)' },
  { value: 'boolean', label: 'Yes / No toggle (כן / לא)' },
]

const PREFILL_OPTIONS: Array<{ value: '' | 'interviewer' | 'name' | 'serial'; label: string }> = [
  { value: '', label: 'None (Manual entry)' },
  { value: 'interviewer', label: 'Room interviewer panel (מי מראיין)' },
  { value: 'name', label: 'Candidate full name (שם המועמד)' },
  { value: 'serial', label: 'Candidate serial # (מספר מרואיין)' },
]

export interface FormStudioEditorProps {
  task: TaskAssignment
  onTaskChange: (task: TaskAssignment) => void
  config: TaskFormConfig
  onChange: (next: TaskFormConfig) => void
  templates: FormTemplate[]
  onSaveAsTemplate: (name: string, description: string) => void
  onDeleteTemplate?: (templateId: string) => void
  onSaveEventForms?: () => void
  savingEvent?: boolean
  eventName?: string
}

const SAMPLE_CANDIDATE = {
  name: 'דנה כהן (Dana Cohen)',
  serial_number: '1042',
}

const SAMPLE_ROOM = {
  interviewers: [{ name: 'רומי לוי' }, { name: 'יעל שחר' }],
}

function QuestionEditorCard({
  sectionId,
  question,
  index,
  total,
  config,
  onChange,
}: {
  sectionId: string
  question: FormQuestion
  index: number
  total: number
  config: TaskFormConfig
  onChange: (next: TaskFormConfig) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const scaleMin = question.scaleMin ?? 1
  const scaleMax = question.scaleMax ?? 5
  const lowAnchor = question.scaleLabels?.[scaleMin] ?? question.scaleLabels?.[1] ?? ''
  const highAnchor = question.scaleLabels?.[scaleMax] ?? question.scaleLabels?.[5] ?? ''
  const optionsText = (question.options ?? []).join(', ')

  const patch = (updates: Partial<FormQuestion>) => {
    onChange(updateQuestion(config, sectionId, question.key, updates))
  }

  return (
    <div className="rounded-lg border border-border bg-background/60 p-3 transition hover:border-primary/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              #{index + 1}
            </span>
            <input
              aria-label={`Question ${index + 1} label`}
              value={question.label}
              onChange={(event) => patch({ label: event.target.value })}
              placeholder="Question prompt / label"
              className={`${inputClass} flex-1 font-medium`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Type for ${question.label || question.key}`}
              value={question.type}
              onChange={(event) => patch({ type: event.target.value as QuestionType })}
              className="rounded-md border border-input bg-card px-2.5 py-1 text-xs font-medium text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              {QUESTION_TYPE_LABELS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground">
              <input
                type="checkbox"
                checked={question.required}
                onChange={(event) => patch({ required: event.target.checked })}
                className="accent-primary"
              />
              Required
            </label>

            {question.prefill && (
              <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                Auto-fill: {question.prefill}
              </span>
            )}

            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="rounded px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {expanded ? 'Hide details ▲' : 'Details & options ▼'}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onChange(moveQuestion(config, sectionId, question.key, 'up'))}
            title="Move question up"
            aria-label={`Move ${question.label} up`}
            className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground transition hover:bg-muted disabled:opacity-35"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => onChange(moveQuestion(config, sectionId, question.key, 'down'))}
            title="Move question down"
            aria-label={`Move ${question.label} down`}
            className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground transition hover:bg-muted disabled:opacity-35"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onChange(duplicateQuestion(config, sectionId, question.key))}
            title="Duplicate question"
            aria-label={`Duplicate ${question.label}`}
            className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground transition hover:bg-muted"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => onChange(removeQuestion(config, sectionId, question.key))}
            title="Remove question"
            aria-label={`Remove ${question.label}`}
            className="rounded border border-destructive/30 bg-card px-2 py-1 text-xs text-destructive transition hover:bg-destructive/10"
          >
            ✕
          </button>
        </div>
      </div>

      {(expanded || question.type === 'scale' || question.type === 'select' || question.type === 'multiselect') && (
        <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
              Interviewer hint / guidance note (optional)
            </span>
            <input
              value={question.hint ?? ''}
              onChange={(event) => patch({ hint: event.target.value || undefined })}
              placeholder="Shown below the question with a ↳ prefix"
              className={inputClass}
            />
          </label>

          {expanded && (
            <>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                  Auto-prefill from board
                </span>
                <select
                  value={question.prefill ?? ''}
                  onChange={(event) => {
                    const value = event.target.value as '' | 'interviewer' | 'name' | 'serial'
                    patch({ prefill: value || undefined })
                  }}
                  className={inputClass}
                >
                  {PREFILL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                  Field key (stored in JSONB)
                </span>
                <input value={question.key} readOnly className={`${inputClass} bg-muted/40 font-mono text-xs`} />
              </label>
            </>
          )}

          {question.type === 'scale' && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:col-span-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Minimum score</span>
                  <input
                    type="number"
                    min={0}
                    max={9}
                    value={scaleMin}
                    onChange={(event) => {
                      const nextMin = Number(event.target.value)
                      if (Number.isInteger(nextMin) && nextMin < scaleMax) {
                        patch({
                          scaleMin: nextMin,
                          scaleLabels: {
                            ...(question.scaleLabels ?? {}),
                            [nextMin]: lowAnchor,
                            [scaleMax]: highAnchor,
                          },
                        })
                      }
                    }}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Maximum score</span>
                  <input
                    type="number"
                    min={2}
                    max={10}
                    value={scaleMax}
                    onChange={(event) => {
                      const nextMax = Number(event.target.value)
                      if (Number.isInteger(nextMax) && nextMax > scaleMin) {
                        patch({
                          scaleMax: nextMax,
                          scaleLabels: {
                            ...(question.scaleLabels ?? {}),
                            [scaleMin]: lowAnchor,
                            [nextMax]: highAnchor,
                          },
                        })
                      }
                    }}
                    className={inputClass}
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                  Low anchor label ({scaleMin})
                </span>
                <input
                  value={lowAnchor}
                  onChange={(event) =>
                    patch({
                      scaleLabels: {
                        ...(question.scaleLabels ?? {}),
                        [scaleMin]: event.target.value,
                      },
                    })
                  }
                  placeholder={`Meaning of ${scaleMin}`}
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                  High anchor label ({scaleMax})
                </span>
                <input
                  value={highAnchor}
                  onChange={(event) =>
                    patch({
                      scaleLabels: {
                        ...(question.scaleLabels ?? {}),
                        [scaleMax]: event.target.value,
                      },
                    })
                  }
                  placeholder={`Meaning of ${scaleMax}`}
                  className={inputClass}
                />
              </label>
            </>
          )}

          {(question.type === 'select' || question.type === 'multiselect') && (
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                Options (comma-separated)
              </span>
              <input
                aria-label={`Options for ${question.label}`}
                value={optionsText}
                onChange={(event) =>
                  patch({
                    options: event.target.value
                      .split(',')
                      .map((opt) => opt.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Option 1, Option 2, Option 3"
                className={inputClass}
              />
            </label>
          )}
        </div>
      )}
    </div>
  )
}

export default function FormStudioEditor({
  task,
  onTaskChange,
  config,
  onChange,
  templates,
  onSaveAsTemplate,
  onDeleteTemplate,
  onSaveEventForms,
  savingEvent = false,
  eventName,
}: FormStudioEditorProps) {
  const [previewFrame, setPreviewFrame] = useState<'phone' | 'desktop'>('phone')
  const [previewAnswers, setPreviewAnswers] = useState<Answers>(() =>
    initialAnswers(SAMPLE_CANDIDATE, SAMPLE_ROOM, config.sections),
  )
  const [previewErrors, setPreviewErrors] = useState<ValidationProblems>({})
  const [previewMessage, setPreviewMessage] = useState('')
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')

  useEffect(() => {
    setPreviewAnswers(initialAnswers(SAMPLE_CANDIDATE, SAMPLE_ROOM, config.sections))
    setPreviewErrors({})
    setPreviewMessage('')
  }, [config.sections, task])

  const taskTemplates = useMemo(
    () => templates.filter((item) => item.task === task),
    [task, templates],
  )

  const totalQuestions = useMemo(() => flattenQuestions(config.sections).length, [config.sections])
  const requiredQuestions = useMemo(
    () => flattenQuestions(config.sections).filter((q) => q.required).length,
    [config.sections],
  )

  const handlePreviewChange = (key: string, value: string) => {
    setPreviewAnswers((prev) => ({ ...prev, [key]: value }))
    setPreviewErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
    setPreviewMessage('')
  }

  const handlePreviewSubmit = () => {
    const problems = validateAnswers(config.sections, previewAnswers)
    if (problems.length > 0) {
      setPreviewErrors(problemMap(problems))
      setPreviewMessage(`Validation caught ${problems.length} required/invalid field(s).`)
      return
    }
    setPreviewErrors({})
    setPreviewMessage('Preview validation passed! All required answers are valid.')
  }

  const handleSaveTemplateSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!templateName.trim()) return
    onSaveAsTemplate(templateName.trim(), templateDescription.trim())
    setTemplateName('')
    setTemplateDescription('')
    setShowTemplateModal(false)
  }

  return (
    <div className="space-y-6">
      {/* Top control bar: task selector, template library, and save actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Interview type">
          {([PERSONAL_INTERVIEW, DEBATE_INTERVIEW] as const).map((item) => {
            const active = task === item
            return (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTaskChange(item)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {item}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowTemplateModal(true)}
            className="rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            Save as Reusable Template
          </button>
          <button
            type="button"
            onClick={() => onChange(defaultTaskFormConfig(task, true))}
            className="rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            Reset to Default
          </button>
          {onSaveEventForms && (
            <button
              type="button"
              disabled={savingEvent}
              onClick={onSaveEventForms}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
            >
              {savingEvent ? 'Saving…' : `Save Forms${eventName ? ` for ${eventName}` : ''}`}
            </button>
          )}
        </div>
      </div>

      {/* Template Quick-Load Shelf */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-foreground">Template Library · {task}</h2>
            <p className="text-xs text-muted-foreground">
              Start from a built-in club rubric or one of your saved Back Office templates, then customize any section
              or question below.
            </p>
          </div>
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {config.sections.length} sections · {totalQuestions} questions ({requiredQuestions} required)
          </span>
        </div>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {taskTemplates.map((tpl) => (
            <div
              key={tpl.id}
              className="flex flex-col justify-between rounded-lg border border-border bg-muted/20 p-3 transition hover:border-primary/40"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{tpl.name}</h3>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                    {tpl.builtIn ? 'Built-in' : 'Custom'}
                  </span>
                </div>
                {tpl.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tpl.description}</p>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 pt-2">
                <span className="text-[11px] text-muted-foreground">
                  {flattenQuestions(tpl.config.sections).length} questions · {tpl.config.direction.toUpperCase()}
                </span>
                <div className="flex items-center gap-1.5">
                  {!tpl.builtIn && onDeleteTemplate && (
                    <button
                      type="button"
                      onClick={() => onDeleteTemplate(tpl.id)}
                      className="rounded px-2 py-1 text-xs font-medium text-destructive transition hover:bg-destructive/10"
                    >
                      Delete
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Load template ${tpl.name}`}
                    onClick={() => onChange(cloneTaskFormConfig({ ...tpl.config, enabled: true }))}
                    className="rounded bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground transition hover:brightness-95"
                  >
                    Load template
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Main Split Studio: Left = Form & Section Builder, Right = Live Room Preview */}
      <div className="grid items-start gap-6 xl:grid-cols-12">
        {/* Builder Column */}
        <div className="space-y-4 xl:col-span-7">
          {/* Form Appearance & Behavior Card */}
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-foreground">Form Appearance & Behavior</h2>
                <p className="text-xs text-muted-foreground">
                  Configure how this form renders on the interviewer's device inside the room view.
                </p>
              </div>

              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-sm font-semibold text-foreground">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(event) => onChange({ ...config, enabled: event.target.checked })}
                  className="size-4 accent-primary"
                />
                Digital form enabled for {task}
              </label>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">Form title</span>
                <input
                  value={config.title}
                  onChange={(event) => onChange({ ...config, title: event.target.value })}
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Layout & language direction
                </span>
                <select
                  aria-label="Layout & language direction"
                  value={config.direction}
                  onChange={(event) => onChange({ ...config, direction: event.target.value as FormDirection })}
                  className={inputClass}
                >
                  <option value="rtl">Right-to-Left (Hebrew / עברית)</option>
                  <option value="ltr">Left-to-Right (English)</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">Submit button text</span>
                <input
                  value={config.submitLabel}
                  onChange={(event) => onChange({ ...config, submitLabel: event.target.value })}
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">Skip button text</span>
                <input
                  value={config.skipLabel}
                  onChange={(event) => onChange({ ...config, skipLabel: event.target.value })}
                  className={inputClass}
                />
              </label>
            </div>
          </section>

          {/* Sections & Questions */}
          {config.sections.map((section, sIdx) => (
            <section key={section.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
                <div className="grid flex-1 gap-2 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                      Section eyebrow (e.g. חלק 1)
                    </span>
                    <input
                      aria-label={`Section ${sIdx + 1} part`}
                      value={section.part}
                      onChange={(event) =>
                        onChange(updateSection(config, section.id, { part: event.target.value }))
                      }
                      className={inputClass}
                    />
                  </label>

                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                      Section heading (optional)
                    </span>
                    <input
                      aria-label={`Section ${sIdx + 1} heading`}
                      value={section.heading ?? ''}
                      onChange={(event) =>
                        onChange(
                          updateSection(config, section.id, {
                            heading: event.target.value ? event.target.value : null,
                          }),
                        )
                      }
                      placeholder="e.g. פרטים כלליים"
                      className={inputClass}
                    />
                  </label>

                  <label className="block sm:col-span-3">
                    <span className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                      Section intro / instructions banner (optional)
                    </span>
                    <input
                      aria-label={`Section ${sIdx + 1} intro`}
                      value={section.intro ?? ''}
                      onChange={(event) =>
                        onChange(
                          updateSection(config, section.id, {
                            intro: event.target.value ? event.target.value : null,
                          }),
                        )
                      }
                      placeholder="Instructions displayed at the top of this card"
                      className={inputClass}
                    />
                  </label>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={sIdx === 0}
                    onClick={() => onChange(moveSection(config, section.id, 'up'))}
                    aria-label={`Move section ${section.part} up`}
                    className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground transition hover:bg-muted disabled:opacity-35"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={sIdx === config.sections.length - 1}
                    onClick={() => onChange(moveSection(config, section.id, 'down'))}
                    aria-label={`Move section ${section.part} down`}
                    className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground transition hover:bg-muted disabled:opacity-35"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    disabled={config.sections.length <= 1}
                    onClick={() => onChange(removeSection(config, section.id))}
                    aria-label={`Remove section ${section.part}`}
                    className="rounded border border-destructive/30 bg-card px-2 py-1 text-xs text-destructive transition hover:bg-destructive/10 disabled:opacity-35"
                  >
                    Delete section
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-2.5">
                {section.questions.map((question, qIdx) => (
                  <QuestionEditorCard
                    key={question.key}
                    sectionId={section.id}
                    question={question}
                    index={qIdx}
                    total={section.questions.length}
                    config={config}
                    onChange={onChange}
                  />
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => onChange(addQuestion(config, section.id, { type: 'text' }))}
                  className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary hover:bg-muted/50"
                >
                  + Add text question
                </button>
                <button
                  type="button"
                  onClick={() => onChange(addQuestion(config, section.id, { type: 'textarea' }))}
                  className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary hover:bg-muted/50"
                >
                  + Add paragraph
                </button>
                <button
                  type="button"
                  onClick={() => onChange(addQuestion(config, section.id, { type: 'scale', required: true }))}
                  className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary hover:bg-muted/50"
                >
                  + Add rating scale
                </button>
                <button
                  type="button"
                  onClick={() => onChange(addQuestion(config, section.id, { type: 'select' }))}
                  className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary hover:bg-muted/50"
                >
                  + Add choice field
                </button>
              </div>
            </section>
          ))}

          <button
            type="button"
            onClick={() => onChange(addSection(config))}
            className="w-full rounded-xl border-2 border-dashed border-border bg-card py-3 text-sm font-semibold text-foreground transition hover:border-primary hover:bg-muted/30"
          >
            + Add New Section
          </button>
        </div>

        {/* Live Interactive Preview Column */}
        <div className="xl:sticky xl:top-24 xl:col-span-5">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                  Interactive Live Preview
                </span>
                <h2 className="text-base font-bold text-foreground">{config.title}</h2>
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
                <button
                  type="button"
                  onClick={() => setPreviewFrame('phone')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    previewFrame === 'phone' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                  }`}
                >
                  Phone
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFrame('desktop')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                    previewFrame === 'desktop' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                  }`}
                >
                  Wide
                </button>
              </div>
            </div>

            {previewMessage && (
              <div className="mt-3 rounded-md border border-primary/30 bg-accent/50 px-3 py-2 text-xs font-medium text-foreground">
                {previewMessage}
              </div>
            )}

            {!config.enabled ? (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
                <p className="text-sm font-semibold text-foreground">
                  Digital form is currently disabled for {task}.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Interviewers in a {task} will see a paper-interview notice instead of a digital rubric. Tick
                  “Digital form enabled” to activate this form in the room view.
                </p>
              </div>
            ) : (
              <div
                className={`mt-4 max-h-[75vh] overflow-y-auto rounded-xl border border-border bg-background p-3 ${
                  previewFrame === 'phone' ? 'mx-auto max-w-[410px] shadow-inner' : ''
                }`}
              >
                <EvaluationForm
                  form={config.sections}
                  values={previewAnswers}
                  errors={previewErrors}
                  direction={config.direction}
                  submitLabel={config.submitLabel}
                  skipLabel={config.skipLabel}
                  onChange={handlePreviewChange}
                  onSubmit={handlePreviewSubmit}
                  onSkip={() => {
                    setPreviewAnswers(emptyAnswers(config.sections))
                    setPreviewErrors({})
                    setPreviewMessage('Preview answers cleared.')
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Save as Reusable Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Save as reusable template"
            className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl"
          >
            <h2 className="text-lg font-bold text-foreground">Save to Template Library</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Save this {task} form layout so you can reuse it when planning future interview days.
            </p>

            <form onSubmit={handleSaveTemplateSubmit} className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Template name <span className="text-destructive">*</span>
                </span>
                <input
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="e.g. Spring 2027 Personal Interview Rubric"
                  required
                  autoFocus
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted-foreground">Description</span>
                <textarea
                  rows={2}
                  value={templateDescription}
                  onChange={(event) => setTemplateDescription(event.target.value)}
                  placeholder="When should coordinators pick this template?"
                  className={inputClass}
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTemplateModal(false)}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:brightness-110"
                >
                  Save Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
