/**
 * Persistence helpers for reusable Back Office form templates and a seamless
 * local fallback for per-event form configurations when the remote database has
 * not yet had `events.forms` applied via `bun run db:push`.
 */
import type { EventFormsConfig, FormTemplate, TaskAssignment, TaskFormConfig } from '../core/types'
import { DEBATE_INTERVIEW, PERSONAL_INTERVIEW } from '../core/constants'
import {
  BUILT_IN_TEMPLATES,
  cloneTaskFormConfig,
  normalizeEventForms,
  normalizeTaskFormConfig,
} from '../domain/formBuilder'

const TEMPLATES_STORAGE_KEY = 'cq:formTemplates:v1'
const EVENT_FORMS_STORAGE_KEY = 'cq:eventForms:v1'

function safeReadJson<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return fallback
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function safeWriteJson(key: string, value: unknown): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage quota or private-mode restrictions.
  }
}

export function readEventFormsFallback(eventId: string): EventFormsConfig | undefined {
  if (!eventId) return undefined
  const map = safeReadJson<Record<string, unknown>>(EVENT_FORMS_STORAGE_KEY, {})
  return normalizeEventForms(map[eventId])
}

export function writeEventFormsFallback(eventId: string, forms: EventFormsConfig | undefined): void {
  if (!eventId) return
  const map = safeReadJson<Record<string, unknown>>(EVENT_FORMS_STORAGE_KEY, {})
  if (!forms || Object.keys(forms).length === 0) {
    delete map[eventId]
  } else {
    map[eventId] = forms
  }
  safeWriteJson(EVENT_FORMS_STORAGE_KEY, map)
}

function normalizeStoredTemplate(raw: unknown): FormTemplate | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const id = String(row.id ?? '').trim()
  const name = String(row.name ?? '').trim()
  if (!id || !name) return null
  const task: TaskAssignment = row.task === DEBATE_INTERVIEW ? DEBATE_INTERVIEW : PERSONAL_INTERVIEW
  return {
    id,
    name,
    description: String(row.description ?? '').trim(),
    task,
    builtIn: false,
    config: normalizeTaskFormConfig(row.config, task),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  }
}

export function listFormTemplates(): FormTemplate[] {
  const customRaw = safeReadJson<unknown[]>(TEMPLATES_STORAGE_KEY, [])
  const custom = Array.isArray(customRaw)
    ? customRaw.map(normalizeStoredTemplate).filter((item): item is FormTemplate => item !== null)
    : []

  return [
    ...BUILT_IN_TEMPLATES.map((tpl) => ({
      ...tpl,
      config: cloneTaskFormConfig(tpl.config),
    })),
    ...custom,
  ]
}

export function saveCustomFormTemplate(input: {
  id?: string
  name: string
  description?: string
  task: TaskAssignment
  config: TaskFormConfig
}): FormTemplate {
  const customRaw = safeReadJson<unknown[]>(TEMPLATES_STORAGE_KEY, [])
  const custom = Array.isArray(customRaw)
    ? customRaw.map(normalizeStoredTemplate).filter((item): item is FormTemplate => item !== null)
    : []

  const id = input.id && !input.id.startsWith('builtin-') ? input.id : `tpl-${Date.now()}`
  const saved: FormTemplate = {
    id,
    name: input.name.trim() || 'Custom Form Template',
    description: (input.description ?? '').trim(),
    task: input.task,
    builtIn: false,
    config: cloneTaskFormConfig(input.config),
    updated_at: new Date().toISOString(),
  }

  const next = custom.some((item) => item.id === id)
    ? custom.map((item) => (item.id === id ? saved : item))
    : [...custom, saved]

  safeWriteJson(TEMPLATES_STORAGE_KEY, next)
  return saved
}

export function deleteCustomFormTemplate(id: string): void {
  const customRaw = safeReadJson<unknown[]>(TEMPLATES_STORAGE_KEY, [])
  const custom = Array.isArray(customRaw)
    ? customRaw.map(normalizeStoredTemplate).filter((item): item is FormTemplate => item !== null)
    : []
  safeWriteJson(
    TEMPLATES_STORAGE_KEY,
    custom.filter((item) => item.id !== id),
  )
}
