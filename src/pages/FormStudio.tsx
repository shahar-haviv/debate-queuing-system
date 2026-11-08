/**
 * Back Office Form Studio (`/admin/forms` and `/admin/event/:id/forms`).
 *
 * Allows coordinators to design, preview and save custom Personal Interview and
 * Debate Interview forms per event, or manage reusable form templates across
 * all interview days.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type {
  EventFormsConfig,
  QueueEvent,
  TaskAssignment,
  TaskFormConfig,
  ToastMessage,
  ToastTone,
} from '../core/types'
import { DEBATE_INTERVIEW, PERSONAL_INTERVIEW } from '../core/constants'
import {
  defaultEventFormsConfig,
  resolveTaskFormConfig,
  validateFormConfig,
} from '../domain/formBuilder'
import { formatEventDate } from '../domain/events'
import { useAuth } from '../hooks/useAuth'
import { useFormTemplates } from '../hooks/useFormTemplates'
import { useServices } from '../services/container'
import FormStudioEditor from '../components/features/FormStudioEditor'
import BrandMark from '../components/ui/BrandMark'
import Toast from '../components/ui/Toast'

export default function FormStudio() {
  const { id: routeEventId } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { events: eventRepo } = useServices()
  const eventRepoRef = useRef(eventRepo)
  eventRepoRef.current = eventRepo
  const { templates, saveTemplate, removeTemplate } = useFormTemplates()

  const [selectedEventId, setSelectedEventId] = useState<string>(routeEventId ?? '')
  const [event, setEvent] = useState<QueueEvent | null>(null)
  const [allEvents, setAllEvents] = useState<QueueEvent[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [saving, setSaving] = useState(false)
  const [task, setTask] = useState<TaskAssignment>(PERSONAL_INTERVIEW)
  const [forms, setForms] = useState<Required<EventFormsConfig>>(() => defaultEventFormsConfig())
  const [toast, setToast] = useState<ToastMessage | null>(null)

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone, id: Date.now() })
  }, [])

  // Load event list for the Back Office selector
  useEffect(() => {
    let active = true
    eventRepoRef.current
      .listSummaries()
      .then((rows) => {
        if (!active) return
        setAllEvents(rows)
        if (!routeEventId) {
          if (rows.length > 0) {
            const activeEvent = rows.find((item) => item.status === 'Active') ?? rows[0]
            setSelectedEventId((current) => current || activeEvent.id)
          } else {
            setLoading(false)
          }
        }
      })
      .catch(() => {
        if (active && !routeEventId) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [routeEventId])

  // Sync route param to selectedEventId
  useEffect(() => {
    if (routeEventId) setSelectedEventId(routeEventId)
  }, [routeEventId])

  // Load the selected event's form configuration
  useEffect(() => {
    if (!selectedEventId) return

    let active = true
    setLoading(true)
    eventRepoRef.current
      .findById(selectedEventId)
      .then((found) => {
        if (!active) return
        setEvent(found)
        setForms({
          [PERSONAL_INTERVIEW]: resolveTaskFormConfig(found?.forms, PERSONAL_INTERVIEW),
          [DEBATE_INTERVIEW]: resolveTaskFormConfig(found?.forms, DEBATE_INTERVIEW),
        })
      })
      .catch((cause: unknown) => {
        if (!active) return
        notify(cause instanceof Error ? cause.message : 'Could not load event forms.', 'error')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [notify, selectedEventId])

  const handleConfigChange = useCallback(
    (nextConfig: TaskFormConfig) => {
      setForms((prev) => ({
        ...prev,
        [task]: nextConfig,
      }))
    },
    [task],
  )

  const handleSaveAsTemplate = useCallback(
    (name: string, description: string) => {
      const current = forms[task]
      const problems = validateFormConfig(current)
      if (problems.length > 0) {
        notify(problems[0], 'error')
        return
      }
      const saved = saveTemplate({
        name,
        description,
        task,
        config: current,
      })
      notify(`Template "${saved.name}" saved to Back Office library.`, 'success')
    },
    [forms, notify, saveTemplate, task],
  )

  const handleDeleteTemplate = useCallback(
    (templateId: string) => {
      removeTemplate(templateId)
      notify('Custom template removed.', 'info')
    },
    [notify, removeTemplate],
  )

  const handleSaveToEvent = useCallback(async () => {
    if (!selectedEventId) {
      notify('Select an event first or save as a reusable template.', 'error')
      return
    }

    for (const currentTask of [PERSONAL_INTERVIEW, DEBATE_INTERVIEW] as const) {
      const problems = validateFormConfig(forms[currentTask])
      if (problems.length > 0) {
        notify(`${currentTask}: ${problems[0]}`, 'error')
        return
      }
    }

    setSaving(true)
    try {
      const updated = await eventRepoRef.current.update(selectedEventId, { forms })
      setEvent(updated)
      notify(`Forms saved for "${updated.name}".`, 'success')
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Could not save event forms.', 'error')
    } finally {
      setSaving(false)
    }
  }, [forms, notify, selectedEventId])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <BrandMark className="size-11" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  {event ? `Form Studio — ${event.name}` : 'Back Office Form Studio'}
                </h1>
                {event && (
                  <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {event.status}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Design interviewer rubrics, customize sections & ratings, and preview live
                {event && ` · ${formatEventDate(event.date)}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!routeEventId && allEvents.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <span>Target Event:</span>
                <select
                  aria-label="Target Event"
                  value={selectedEventId}
                  onChange={(change) => setSelectedEventId(change.target.value)}
                  className="rounded-md border border-input bg-card px-3 py-1.5 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  {allEvents.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name} ({ev.status})
                    </option>
                  ))}
                </select>
              </label>
            )}

            {selectedEventId && (
              <Link
                to={`/admin/event/${selectedEventId}/queue`}
                className="rounded-md border border-input bg-card px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
              >
                Open Live Queue
              </Link>
            )}

            <Link
              to="/admin"
              className="rounded-md border border-input bg-card px-3.5 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              Back Office
            </Link>

            <button
              type="button"
              onClick={handleSignOut}
              title={user?.email ?? 'Sign out'}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6">
        {loading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading form studio…</p>
        ) : (
          <FormStudioEditor
            task={task}
            onTaskChange={setTask}
            config={forms[task]}
            onChange={handleConfigChange}
            templates={templates}
            onSaveAsTemplate={handleSaveAsTemplate}
            onDeleteTemplate={handleDeleteTemplate}
            onSaveEventForms={selectedEventId ? handleSaveToEvent : undefined}
            savingEvent={saving}
            eventName={event?.name}
          />
        )}
      </main>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
