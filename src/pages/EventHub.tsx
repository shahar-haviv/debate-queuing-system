/**
 * The Back Office hub: every interview day, grouped by lifecycle.
 *
 * This page is deliberately read-mostly. It does not load candidates or rooms;
 * the repository gives each card its two counts in the same query, and the live
 * board only starts fetching once an admin opens a specific event.
 */
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { EventStatus, EventSummary, QueueEvent } from '../core/types'
import { useAuth } from '../hooks/useAuth'
import { useEvents } from '../hooks/useEvents'
import { formatEventDate } from '../domain/events'
import BrandMark from '../components/ui/BrandMark'
import EventSettingsModal from '../components/features/EventSettingsModal'

type TabKey = 'upcoming' | 'active' | 'past'

const TABS: Array<{ key: TabKey; label: string; status: EventStatus }> = [
  { key: 'upcoming', label: 'Upcoming', status: 'Draft' },
  { key: 'active', label: 'Active', status: 'Active' },
  { key: 'past', label: 'Past', status: 'Completed' },
]

const STATUS_TONE: Record<EventStatus, string> = {
  Draft: 'bg-status-pending/15 text-status-pending',
  Active: 'bg-status-debate/15 text-status-debate',
  Completed: 'bg-muted text-muted-foreground',
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="size-4"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function EventCard({
  event,
  onEdit,
}: {
  event: EventSummary
  onEdit: (event: QueueEvent) => void
}) {
  return (
    <article className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold tracking-tight text-foreground" title={event.name}>
            {event.name}
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarIcon />
            {formatEventDate(event.date)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS_TONE[event.status]}`}
        >
          {event.status}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Candidates
          </dt>
          <dd className="mt-0.5 text-xl font-bold tabular-nums text-foreground">
            {event.candidate_count.toLocaleString('en-US')}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Rooms</dt>
          <dd className="mt-0.5 text-xl font-bold tabular-nums text-foreground">
            {event.room_count.toLocaleString('en-US')}
          </dd>
        </div>
      </dl>

      {event.notes && (
        <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{event.notes}</p>
      )}

      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        <Link
          to={`/admin/event/${event.id}/queue`}
          className="col-span-2 inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:brightness-110"
        >
          Open Live Queue
        </Link>
        <Link
          to={`/admin/event/${event.id}/forms`}
          className="inline-flex items-center justify-center rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          Configure Forms
        </Link>
        <Link
          to={`/admin/event/${event.id}/analytics`}
          className="inline-flex items-center justify-center rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
        >
          View Analytics
        </Link>
        <button
          type="button"
          onClick={() => onEdit(event)}
          className="col-span-2 inline-flex items-center justify-center rounded-md border border-input bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          Edit Settings
        </button>
      </div>
    </article>
  )
}

export default function EventHub() {
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { events, loading, error, reload, update } = useEvents()
  const [tab, setTab] = useState<TabKey>('upcoming')
  const [editing, setEditing] = useState<QueueEvent | null>(null)

  const grouped = useMemo(() => {
    const byStatus = (status: EventStatus) => {
      const rows = events.filter((event) => event.status === status)
      return rows.sort((a, b) => a.date.localeCompare(b.date))
    }
    return {
      upcoming: byStatus('Draft'),
      active: byStatus('Active'),
      past: byStatus('Completed').reverse(),
    }
  }, [events])

  const current = grouped[tab]
  const activeTab = TABS.find((entry) => entry.key === tab) ?? TABS[0]

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <BrandMark className="size-11" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Back Office</h1>
              <p className="text-sm text-muted-foreground">
                Plan, run and review every interview day
                {!loading && ` · ${events.length} event${events.length === 1 ? '' : 's'}`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/admin/forms"
              className="inline-flex items-center gap-2 rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              Form Studio
            </Link>
            <Link
              to="/admin/event/new"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110"
            >
              <PlusIcon />
              New Event
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

      <main className="mx-auto max-w-7xl px-4 py-6">
        {error && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-late-surface px-4 py-3 text-sm text-destructive"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void reload()}
              className="rounded border border-destructive/30 px-2 py-1 text-xs font-semibold"
            >
              Retry
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
          <div role="tablist" aria-label="Event groups" className="flex gap-1">
            {TABS.map((entry) => {
              const selected = entry.key === tab
              return (
                <button
                  key={entry.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(entry.key)}
                  className={`border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                    selected
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {entry.label}
                  <span className="ms-2 rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums">
                    {grouped[entry.key].length}
                  </span>
                </button>
              )
            })}
          </div>

          <p className="pb-2 text-xs text-muted-foreground">
            {tab === 'upcoming' && 'Drafts. Set a draft to Active when the day starts.'}
            {tab === 'active' && 'Events currently running.'}
            {tab === 'past' && 'Completed events, newest first.'}
          </p>
        </div>

        {loading ? (
          <p className="py-20 text-center text-sm text-muted-foreground">Loading events…</p>
        ) : current.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <h2 className="text-lg font-bold text-foreground">No {activeTab.label.toLowerCase()} events</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              {tab === 'upcoming'
                ? 'Create the next interview day, allocate its rooms and import its roster.'
                : tab === 'active'
                  ? 'Open a draft event and change its status to Active when the day begins.'
                  : 'Completed events will appear here with their analytics and ledger.'}
            </p>
            {tab === 'upcoming' && (
              <Link
                to="/admin/event/new"
                className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110"
              >
                <PlusIcon />
                Create an event
              </Link>
            )}
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {current.map((event) => (
              <EventCard key={event.id} event={event} onEdit={setEditing} />
            ))}
          </div>
        )}
      </main>

      <EventSettingsModal
        event={editing}
        onClose={() => setEditing(null)}
        onSave={(patch) => (editing ? update(editing.id, patch) : Promise.resolve())}
      />
    </div>
  )
}
