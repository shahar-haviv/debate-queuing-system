/**
 * The dispatch board itself: search, "call next", and the three columns.
 *
 * This is the flagship presentation component. It owns only *view* state - the
 * search box and the clock used for the LATE badge - and receives every piece of
 * data and every action as a prop. The page above decides what a click means;
 * the card below decides how one candidate looks. Neither has to change when a
 * column is added here, and this file has no idea Supabase exists.
 */
import { useEffect, useState } from 'react'
import type { Candidate, CandidatePatch, Room } from '../../core/types'
import { nowMinutes } from '../../domain/time'
import { useQueueLogic } from '../../hooks/useQueueLogic'
import Column from '../ui/Column'
import CandidateCard from './CandidateCard'

/** Lightning bolt - "call the next person in line". */
function BoltIcon() {
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
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
    </svg>
  )
}

export interface CandidateQueueListProps {
  candidates: Candidate[]
  rooms: Room[]
  loading: boolean
  busyIds: ReadonlySet<string>
  onPatch: (id: string, patch: CandidatePatch) => unknown
  onEdit: (candidate: Candidate) => void
  onDelete: (candidate: Candidate) => void
  onShowQr: (candidate: Candidate) => void
  onAutoAssign: (candidate: Candidate) => void
  onCallNext: (head: Candidate | undefined) => void
}

export default function CandidateQueueList({
  candidates,
  rooms,
  loading,
  busyIds,
  onPatch,
  onEdit,
  onDelete,
  onShowQr,
  onAutoAssign,
  onCallNext,
}: CandidateQueueListProps) {
  const [query, setQuery] = useState('')
  const [clock, setClock] = useState(() => nowMinutes())

  useEffect(() => {
    const timer = setInterval(() => setClock(nowMinutes()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const { notArrived, inProgress, finished, waiting, positions, lateCount } = useQueueLogic(
    candidates,
    query,
    clock,
  )

  const renderCard = (candidate: Candidate, late = false) => (
    <CandidateCard
      key={candidate.id}
      candidate={candidate}
      rooms={rooms}
      late={late}
      busy={busyIds.has(candidate.id)}
      queuePosition={positions.get(candidate.id) ?? null}
      onPatch={onPatch}
      onEdit={onEdit}
      onDelete={onDelete}
      onShowQr={onShowQr}
      onAutoAssign={onAutoAssign}
    />
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    )
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name…"
          className="min-w-[12rem] flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

        {/*
          The line, dispatched in arrival order. Whoever walked in first is next -
          their planned time has no say once they are in the building. Strict FIFO:
          if the head cannot be placed the button explains why and stops, rather
          than promoting somebody behind them.
        */}
        <button
          type="button"
          onClick={() => onCallNext(waiting[0])}
          disabled={waiting.length === 0 || busyIds.size > 0}
          title={
            waiting.length
              ? `Send ${waiting[0].name}, who arrived first, to the best room for their next interview`
              : 'Nobody has arrived and is waiting for an interview'
          }
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <BoltIcon />
          {waiting.length ? `Call next — ${waiting[0].name}` : 'Call next'}
          {waiting.length > 1 && (
            <span className="rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums">
              +{waiting.length - 1} waiting
            </span>
          )}
        </button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Column
          title="Not Arrived"
          subtitle="Earliest planned first · late pinned to top"
          tone="amber"
          count={notArrived.length}
          emptyText="No candidates waiting to check in."
        >
          {notArrived.map((entry) => renderCard(entry.candidate, entry.late))}
        </Column>

        <Column
          title="Arrived"
          subtitle="Arrival order · first to arrive is first in line"
          tone="blue"
          count={inProgress.length}
          emptyText="No interviews in progress."
        >
          {inProgress.map((candidate) => renderCard(candidate))}
        </Column>

        <Column
          title="Finished"
          subtitle="Both interviews complete"
          tone="green"
          count={finished.length}
          emptyText="No candidates finished yet."
        >
          {finished.map((candidate) => renderCard(candidate))}
        </Column>
      </div>

      {lateCount > 0 && (
        <p className="mt-4 text-xs font-medium text-destructive">
          {lateCount} late candidate{lateCount === 1 ? '' : 's'} - pinned to the top of Not Arrived.
        </p>
      )}
    </>
  )
}
