/**
 * Pure domain logic for designing, cloning, validating and resolving interview
 * forms and reusable templates in the Back Office Form Studio.
 *
 * No I/O, no React, no Supabase.
 */
import type {
  EventFormsConfig,
  FormDirection,
  FormQuestion,
  FormSection,
  FormTemplate,
  QuestionType,
  RubricForm,
  ScaleLabels,
  TaskAssignment,
  TaskFormConfig,
} from '../core/types'
import { DEBATE_INTERVIEW, PERSONAL_INTERVIEW } from '../core/constants'
import {
  DEBATE_INTERVIEW_FORM,
  PERSONAL_INTERVIEW_FORM,
  SCALE_MAX,
  SCALE_MIN,
  flattenQuestions,
} from './evaluation'

export const DEFAULT_SUBMIT_LABEL = 'Submit Evaluation & Release Room'
export const DEFAULT_SKIP_LABEL = 'Skip Digital Feedback & Release Room'

const QUESTION_TYPES: readonly QuestionType[] = [
  'text',
  'textarea',
  'number',
  'scale',
  'select',
  'multiselect',
  'boolean',
]

export function cloneQuestion(question: FormQuestion): FormQuestion {
  const next: FormQuestion = {
    key: question.key,
    label: question.label,
    type: question.type,
    required: Boolean(question.required),
  }
  if (question.prefill) next.prefill = question.prefill
  if (question.hint) next.hint = question.hint
  if (question.placeholder) next.placeholder = question.placeholder
  if (question.scaleMin !== undefined) next.scaleMin = question.scaleMin
  if (question.scaleMax !== undefined) next.scaleMax = question.scaleMax
  if (question.scaleLabels) next.scaleLabels = { ...question.scaleLabels }
  if (question.options) next.options = [...question.options]
  return next
}

export function cloneRubricForm(form: RubricForm): RubricForm {
  return form.map((section) => ({
    id: section.id,
    part: section.part,
    heading: section.heading ?? null,
    intro: section.intro ?? null,
    questions: (section.questions ?? []).map(cloneQuestion),
  }))
}

export function cloneTaskFormConfig(config: TaskFormConfig): TaskFormConfig {
  return {
    enabled: Boolean(config.enabled),
    title: config.title,
    direction: config.direction === 'ltr' ? 'ltr' : 'rtl',
    submitLabel: config.submitLabel || DEFAULT_SUBMIT_LABEL,
    skipLabel: config.skipLabel || DEFAULT_SKIP_LABEL,
    sections: cloneRubricForm(config.sections),
  }
}

export function defaultPersonalFormConfig(): TaskFormConfig {
  return {
    enabled: true,
    title: 'שאלון ראיון אישי — מועדון הדיבייט',
    direction: 'rtl',
    submitLabel: DEFAULT_SUBMIT_LABEL,
    skipLabel: DEFAULT_SKIP_LABEL,
    sections: cloneRubricForm(PERSONAL_INTERVIEW_FORM),
  }
}

/**
 * By default, Debate Interview starts with `enabled: false` (paper/dispatch
 * checkbox) unless the coordinator enables the digital rubric for the event.
 */
export function defaultDebateFormConfig(enabled = false): TaskFormConfig {
  return {
    enabled,
    title: 'משוב ראיון דיבייט — שיפוט והערכה',
    direction: 'rtl',
    submitLabel: DEFAULT_SUBMIT_LABEL,
    skipLabel: DEFAULT_SKIP_LABEL,
    sections: cloneRubricForm(DEBATE_INTERVIEW_FORM),
  }
}

export function defaultTaskFormConfig(task: TaskAssignment, enabled?: boolean): TaskFormConfig {
  if (task === DEBATE_INTERVIEW) return defaultDebateFormConfig(enabled ?? false)
  return { ...defaultPersonalFormConfig(), enabled: enabled ?? true }
}

export function defaultEventFormsConfig(): Required<EventFormsConfig> {
  return {
    [PERSONAL_INTERVIEW]: defaultPersonalFormConfig(),
    [DEBATE_INTERVIEW]: defaultDebateFormConfig(false),
  }
}

/**
 * Built-in starter templates available in the Back Office Form Studio.
 */
export const EXPRESS_PERSONAL_FORM: RubricForm = [
  {
    id: 'express_details',
    part: 'חלק 1',
    heading: 'פרטים כלליים וזמינות',
    intro: null,
    questions: [
      { key: 'interviewer_name', label: 'מי מראיין?', type: 'text', required: true, prefill: 'interviewer' },
      { key: 'candidate_name', label: 'שם מלא של המועמד', type: 'text', required: true, prefill: 'name' },
      { key: 'candidate_number', label: 'מספר מרואיין', type: 'text', required: true, prefill: 'serial' },
      { key: 'study_track', label: 'מסלול לימודים ושנה', type: 'text', required: true },
      {
        key: 'monday_available',
        label: 'האם פנוי/ה בימי שני 17:30–21:00 ללא התנגשויות?',
        type: 'boolean',
        required: true,
      },
      {
        key: 'motivation_summary',
        label: 'מוטיבציה והתרשמות מרכזית מהשיחה',
        type: 'textarea',
        required: true,
      },
    ],
  },
  {
    id: 'express_rating',
    part: 'חלק 2',
    heading: 'דירוג מהיר',
    intro: 'ממלאים לאחר יציאת המועמד מהחדר.',
    questions: [
      {
        key: 'rating_availability',
        label: 'זמינות ומחוייבות',
        type: 'scale',
        required: true,
        scaleLabels: { 1: 'התנגשויות קבועות', 5: 'פנוי/ה ומחויב/ת לחלוטין' },
      },
      {
        key: 'rating_vibe',
        label: 'התאמה חברתית ווייב',
        type: 'scale',
        required: true,
        scaleLabels: { 1: 'לא מתאים', 5: 'התאמה מצוינת למועדון' },
      },
      {
        key: 'interviewer_notes',
        label: 'הערות מסכמות',
        type: 'textarea',
        required: false,
      },
    ],
  },
]

export const BP_ENGLISH_DEBATE_FORM: RubricForm = [
  {
    id: 'bp_details',
    part: 'Part 1',
    heading: 'Round & Speaker Info',
    intro: null,
    questions: [
      { key: 'interviewer_name', label: 'Judge / Panel', type: 'text', required: true, prefill: 'interviewer' },
      { key: 'candidate_name', label: 'Candidate Name', type: 'text', required: true, prefill: 'name' },
      { key: 'candidate_number', label: 'Candidate #', type: 'text', required: true, prefill: 'serial' },
      {
        key: 'speaker_position',
        label: 'Assigned Position',
        type: 'select',
        required: true,
        options: ['Proposition / Government', 'Opposition', 'Reply / Summary'],
      },
    ],
  },
  {
    id: 'bp_evaluation',
    part: 'Part 2',
    heading: 'Argumentation & Rebuttal',
    intro: 'Evaluate logical rigor, comparative weighing, and engagement with POIs.',
    questions: [
      {
        key: 'strengths_observed',
        label: 'Key Strengths Observed',
        type: 'multiselect',
        required: false,
        options: ['Clear structure', 'Strong mechanism', 'Sharp rebuttal', 'Comparative weighing', 'Persuasive style'],
      },
      {
        key: 'argument_notes',
        label: 'Speech Breakdown & Rebuttal Notes',
        type: 'textarea',
        required: true,
      },
      {
        key: 'rating_analytical',
        label: 'Analytical Rigor & Logic',
        type: 'scale',
        required: true,
        scaleMin: 1,
        scaleMax: 5,
        scaleLabels: { 1: 'Assertions only', 5: 'Deeply mechanized & comparative' },
      },
      {
        key: 'rating_rebuttal',
        label: 'Responsiveness & Engagement',
        type: 'scale',
        required: true,
        scaleMin: 1,
        scaleMax: 5,
        scaleLabels: { 1: 'Drops core clashes', 5: 'Directly flips strongest points' },
      },
    ],
  },
]

export const BUILT_IN_TEMPLATES: FormTemplate[] = [
  {
    id: 'builtin-personal-standard',
    name: 'ראיון אישי — שאלון מועדון מלא (22 שאלות)',
    description: 'השאלון המלא של מועדון הדיבייט ב-4 חלקים: פרטים כלליים, 3 קריטריונים, מחויבות ודירוג 1–5.',
    task: PERSONAL_INTERVIEW,
    builtIn: true,
    config: defaultPersonalFormConfig(),
    updated_at: '2026-10-01T00:00:00Z',
  },
  {
    id: 'builtin-personal-express',
    name: 'ראיון אישי — שאלון מקוצר לימי עומס',
    description: 'גרסה ממוקדת ומהירה לבדיקת זמינות בימי שני, מוטיבציה ודירוג התאמה.',
    task: PERSONAL_INTERVIEW,
    builtIn: true,
    config: {
      enabled: true,
      title: 'שאלון ראיון אישי מקוצר',
      direction: 'rtl',
      submitLabel: DEFAULT_SUBMIT_LABEL,
      skipLabel: DEFAULT_SKIP_LABEL,
      sections: cloneRubricForm(EXPRESS_PERSONAL_FORM),
    },
    updated_at: '2026-10-01T00:00:00Z',
  },
  {
    id: 'builtin-debate-standard',
    name: 'ראיון דיבייט — דף שיפוט והערכה (עברית)',
    description: 'טופס שיפוט דיגיטלי לראיון דיבייט: מושן, בניית טיעון, מענה לריבאטל ודירוג אנליטי.',
    task: DEBATE_INTERVIEW,
    builtIn: true,
    config: defaultDebateFormConfig(true),
    updated_at: '2026-10-01T00:00:00Z',
  },
  {
    id: 'builtin-debate-bp-en',
    name: 'Debate Interview — BP Judging Rubric (English)',
    description: 'Left-to-right English rubric with position selector, strength tags, and analytical/rebuttal scales.',
    task: DEBATE_INTERVIEW,
    builtIn: true,
    config: {
      enabled: true,
      title: 'Debate Trial — Adjudication Rubric',
      direction: 'ltr',
      submitLabel: DEFAULT_SUBMIT_LABEL,
      skipLabel: DEFAULT_SKIP_LABEL,
      sections: cloneRubricForm(BP_ENGLISH_DEBATE_FORM),
    },
    updated_at: '2026-10-01T00:00:00Z',
  },
]

/* ------------------------ Normalization & Resolution ----------------------- */

function normalizeScaleLabels(raw: unknown): ScaleLabels | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: ScaleLabels = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const num = Number(k)
    const text = String(v ?? '').trim()
    if (Number.isInteger(num) && text) out[num] = text
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeQuestion(raw: unknown, fallbackIndex: number): FormQuestion | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const key = String(row.key ?? '').trim() || `question_${fallbackIndex}`
  const label = String(row.label ?? '').trim()
  if (!label) return null

  const rawType = String(row.type ?? 'text') as QuestionType
  const type: QuestionType = QUESTION_TYPES.includes(rawType) ? rawType : 'text'

  const question: FormQuestion = {
    key,
    label,
    type,
    required: Boolean(row.required),
  }

  if (row.prefill === 'interviewer' || row.prefill === 'name' || row.prefill === 'serial') {
    question.prefill = row.prefill
  }
  const hint = String(row.hint ?? '').trim()
  if (hint) question.hint = hint
  const placeholder = String(row.placeholder ?? '').trim()
  if (placeholder) question.placeholder = placeholder

  if (type === 'scale') {
    const min = Number(row.scaleMin)
    const max = Number(row.scaleMax)
    if (Number.isInteger(min) && Number.isInteger(max) && min < max) {
      question.scaleMin = min
      question.scaleMax = max
    }
    const labels = normalizeScaleLabels(row.scaleLabels)
    if (labels) question.scaleLabels = labels
  }

  if (type === 'select' || type === 'multiselect') {
    const options = Array.isArray(row.options)
      ? row.options.map((item) => String(item ?? '').trim()).filter(Boolean)
      : []
    question.options = options
  }

  return question
}

function normalizeSection(raw: unknown, index: number): FormSection | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = String(row.id ?? '').trim() || `section_${index + 1}`
  const part = String(row.part ?? '').trim() || `חלק ${index + 1}`
  const heading = row.heading === null || row.heading === undefined ? null : String(row.heading).trim() || null
  const intro = row.intro === null || row.intro === undefined ? null : String(row.intro).trim() || null

  const rawQuestions = Array.isArray(row.questions) ? row.questions : []
  const questions = rawQuestions
    .map((q, qIdx) => normalizeQuestion(q, index * 100 + qIdx + 1))
    .filter((q): q is FormQuestion => q !== null)

  return { id, part, heading, intro, questions }
}

export function normalizeTaskFormConfig(raw: unknown, fallbackTask: TaskAssignment): TaskFormConfig {
  const defaults = defaultTaskFormConfig(fallbackTask)
  if (!raw || typeof raw !== 'object') return defaults

  const obj = raw as Record<string, unknown>
  const direction: FormDirection = obj.direction === 'ltr' ? 'ltr' : 'rtl'
  const rawSections = Array.isArray(obj.sections) ? obj.sections : null
  const sections = rawSections
    ? rawSections.map((s, idx) => normalizeSection(s, idx)).filter((s): s is FormSection => s !== null)
    : defaults.sections

  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : defaults.enabled,
    title: String(obj.title ?? '').trim() || defaults.title,
    direction,
    submitLabel: String(obj.submitLabel ?? '').trim() || DEFAULT_SUBMIT_LABEL,
    skipLabel: String(obj.skipLabel ?? '').trim() || DEFAULT_SKIP_LABEL,
    sections: sections.length > 0 ? sections : defaults.sections,
  }
}

export function normalizeEventForms(raw: unknown): EventFormsConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const out: EventFormsConfig = {}

  if (obj[PERSONAL_INTERVIEW]) {
    out[PERSONAL_INTERVIEW] = normalizeTaskFormConfig(obj[PERSONAL_INTERVIEW], PERSONAL_INTERVIEW)
  }
  if (obj[DEBATE_INTERVIEW]) {
    out[DEBATE_INTERVIEW] = normalizeTaskFormConfig(obj[DEBATE_INTERVIEW], DEBATE_INTERVIEW)
  }

  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Resolves the active `TaskFormConfig` for a given event and interview task,
 * falling back to the club defaults when the event has no custom override.
 */
export function resolveTaskFormConfig(
  forms: EventFormsConfig | undefined,
  task: TaskAssignment,
): TaskFormConfig {
  const custom = forms?.[task]
  if (custom) return normalizeTaskFormConfig(custom, task)
  return defaultTaskFormConfig(task)
}

/* -------------------------- Builder Mutations ----------------------------- */

export function generateQuestionKey(label: string, existingKeys: Iterable<string>): string {
  const taken = new Set(existingKeys)
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = slug ? `q_${slug.slice(0, 24)}` : 'custom_field'
  if (!taken.has(base)) return base
  let counter = 2
  while (taken.has(`${base}_${counter}`)) counter += 1
  return `${base}_${counter}`
}

export function addSection(
  config: TaskFormConfig,
  partial: Partial<Omit<FormSection, 'id' | 'questions'>> = {},
): TaskFormConfig {
  const index = config.sections.length + 1
  const existingIds = new Set(config.sections.map((section) => section.id))
  let id = `section_${index}`
  while (existingIds.has(id)) id = `${id}_${Math.floor(Math.random() * 900 + 100)}`

  const defaultPart = config.direction === 'ltr' ? `Part ${index}` : `חלק ${index}`
  const defaultHeading = config.direction === 'ltr' ? 'New Section' : 'חלק חדש'
  const defaultQuestionLabel = config.direction === 'ltr' ? 'New question' : 'שאלה חדשה'

  const existingKeys = flattenQuestions(config.sections).map((q) => q.key)
  const firstQuestion: FormQuestion = {
    key: generateQuestionKey('question', existingKeys),
    label: defaultQuestionLabel,
    type: 'text',
    required: false,
  }

  const nextSection: FormSection = {
    id,
    part: partial.part ?? defaultPart,
    heading: partial.heading !== undefined ? partial.heading : defaultHeading,
    intro: partial.intro ?? null,
    questions: [firstQuestion],
  }

  return {
    ...config,
    sections: [...config.sections, nextSection],
  }
}

export function updateSection(
  config: TaskFormConfig,
  sectionId: string,
  patch: Partial<Omit<FormSection, 'id' | 'questions'>>,
): TaskFormConfig {
  return {
    ...config,
    sections: config.sections.map((section) =>
      section.id === sectionId
        ? {
            ...section,
            ...patch,
          }
        : section,
    ),
  }
}

export function removeSection(config: TaskFormConfig, sectionId: string): TaskFormConfig {
  return {
    ...config,
    sections: config.sections.filter((section) => section.id !== sectionId),
  }
}

export function moveSection(
  config: TaskFormConfig,
  sectionId: string,
  direction: 'up' | 'down',
): TaskFormConfig {
  const idx = config.sections.findIndex((section) => section.id === sectionId)
  if (idx < 0) return config
  const target = direction === 'up' ? idx - 1 : idx + 1
  if (target < 0 || target >= config.sections.length) return config

  const next = [...config.sections]
  const [moved] = next.splice(idx, 1)
  next.splice(target, 0, moved)
  return { ...config, sections: next }
}

export function addQuestion(
  config: TaskFormConfig,
  sectionId: string,
  partial: Partial<FormQuestion> = {},
): TaskFormConfig {
  const existingKeys = flattenQuestions(config.sections).map((q) => q.key)
  const defaultLabel =
    partial.label?.trim() || (config.direction === 'ltr' ? 'New question' : 'שאלה חדשה')
  const type: QuestionType = partial.type ?? 'text'
  const key =
    partial.key && !existingKeys.includes(partial.key)
      ? partial.key
      : generateQuestionKey(type === 'scale' ? 'rating_score' : defaultLabel, existingKeys)

  const question: FormQuestion = {
    key,
    label: defaultLabel,
    type,
    required: partial.required ?? false,
    ...(partial.prefill ? { prefill: partial.prefill } : {}),
    ...(partial.hint ? { hint: partial.hint } : {}),
    ...(type === 'scale'
      ? {
          scaleMin: partial.scaleMin ?? SCALE_MIN,
          scaleMax: partial.scaleMax ?? SCALE_MAX,
          scaleLabels: partial.scaleLabels ?? { 1: '', 5: '' },
        }
      : {}),
    ...(type === 'select' || type === 'multiselect'
      ? {
          options:
            partial.options && partial.options.length > 0
              ? partial.options
              : config.direction === 'ltr'
                ? ['Option 1', 'Option 2']
                : ['אפשרות 1', 'אפשרות 2'],
        }
      : {}),
  }

  return {
    ...config,
    sections: config.sections.map((section) =>
      section.id === sectionId
        ? { ...section, questions: [...section.questions, question] }
        : section,
    ),
  }
}

export function updateQuestion(
  config: TaskFormConfig,
  sectionId: string,
  questionKey: string,
  patch: Partial<FormQuestion>,
): TaskFormConfig {
  return {
    ...config,
    sections: config.sections.map((section) => {
      if (section.id !== sectionId) return section
      return {
        ...section,
        questions: section.questions.map((question) => {
          if (question.key !== questionKey) return question
          const updated: FormQuestion = { ...question, ...patch }
          if (patch.type === 'scale' && !updated.scaleMin) {
            updated.scaleMin = SCALE_MIN
            updated.scaleMax = SCALE_MAX
          }
          if (
            (patch.type === 'select' || patch.type === 'multiselect') &&
            (!updated.options || updated.options.length === 0)
          ) {
            updated.options = config.direction === 'ltr' ? ['Option 1', 'Option 2'] : ['אפשרות 1', 'אפשרות 2']
          }
          return updated
        }),
      }
    }),
  }
}

export function removeQuestion(
  config: TaskFormConfig,
  sectionId: string,
  questionKey: string,
): TaskFormConfig {
  return {
    ...config,
    sections: config.sections.map((section) =>
      section.id === sectionId
        ? {
            ...section,
            questions: section.questions.filter((question) => question.key !== questionKey),
          }
        : section,
    ),
  }
}

export function moveQuestion(
  config: TaskFormConfig,
  sectionId: string,
  questionKey: string,
  direction: 'up' | 'down',
): TaskFormConfig {
  return {
    ...config,
    sections: config.sections.map((section) => {
      if (section.id !== sectionId) return section
      const idx = section.questions.findIndex((question) => question.key === questionKey)
      if (idx < 0) return section
      const target = direction === 'up' ? idx - 1 : idx + 1
      if (target < 0 || target >= section.questions.length) return section
      const next = [...section.questions]
      const [moved] = next.splice(idx, 1)
      next.splice(target, 0, moved)
      return { ...section, questions: next }
    }),
  }
}

export function duplicateQuestion(
  config: TaskFormConfig,
  sectionId: string,
  questionKey: string,
): TaskFormConfig {
  const existingKeys = flattenQuestions(config.sections).map((q) => q.key)
  return {
    ...config,
    sections: config.sections.map((section) => {
      if (section.id !== sectionId) return section
      const idx = section.questions.findIndex((question) => question.key === questionKey)
      if (idx < 0) return section
      const original = section.questions[idx]
      const copy: FormQuestion = {
        ...cloneQuestion(original),
        key: generateQuestionKey(original.key, existingKeys),
        label: `${original.label} (עותק)`,
      }
      const next = [...section.questions]
      next.splice(idx + 1, 0, copy)
      return { ...section, questions: next }
    }),
  }
}

/**
 * Validates that a form configuration is structurally sound before saving.
 */
export function validateFormConfig(config: TaskFormConfig): string[] {
  const problems: string[] = []
  if (!config.enabled) return problems

  if (!config.sections.length) {
    problems.push('An enabled form needs at least one section.')
    return problems
  }

  const allQuestions = flattenQuestions(config.sections)
  if (!allQuestions.length) {
    problems.push('An enabled form needs at least one question.')
    return problems
  }

  for (const section of config.sections) {
    if (!section.part.trim() && !(section.heading ?? '').trim()) {
      problems.push('Every section needs a part label or heading.')
    }
    for (const question of section.questions) {
      if (!question.label.trim()) {
        problems.push(`Question "${question.key}" has an empty label.`)
      }
      if (
        (question.type === 'select' || question.type === 'multiselect') &&
        (!question.options || question.options.filter((opt) => opt.trim()).length === 0)
      ) {
        problems.push(`Question "${question.label || question.key}" needs at least one choice option.`)
      }
    }
  }

  return problems
}
