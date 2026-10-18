import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useCandidates } from '../hooks/useCandidates'
import { supabase } from '../lib/supabase'
import { dedupeKey, parseCandidatesCsv } from '../lib/csv'
import { isLate, nowMinutes, parseTimeToMinutes } from '../lib/time'
import {
  DEBATE_INTERVIEW,
  PERSONAL_INTERVIEW,
  neededTasks,
  pickPlacement,
  queuePositions,
  roomLoads,
  roomTypeForTask,
  roomsForTask,
  waitingInLine,
} from '../lib/autoAssign'
import { blockedInterviewers } from '../lib/conflicts'
import { createLogger } from '../lib/logger'
import Column from '../components/Column'
import BrandMark from '../components/BrandMark'
import CandidateCard from '../components/CandidateCard'
import RoomsPanel from '../components/RoomsPanel'
import AddEditCandidateModal from '../components/AddEditCandidateModal'
import QrModal from '../components/QrModal'
import Toast from '../components/Toast'

const log = createLogger('admin')
const UNPLANNED = Number.MAX_SAFE_INTEGER

/** Every applicable room is unusable because of the candidate's restrictions. */
const ALL_RESTRICTED_MESSAGE =
  'Auto-Assign Failed: All applicable rooms have a restricted interviewer for this candidate.'

/**
 * "Nowhere to go" — the other dead end, for the case where the board has no room
 * of the needed kind at all. A General room counts for either interview, so when
 * this fires there is genuinely nothing to use.
 *
 * A candidate who still owes both interviews is judged across both tracks, so the
 * sentence has to be able to name both.
 */
function noRoomMessage(needed) {
  const types = [...new Set(needed.map(roomTypeForTask))]
  if (types.length === 1) return `No ${types[0]} or General room is available for a ${needed[0]}.`
  const short = needed.map((task) => task.replace(' Interview', ''))
  return `No room is available for a ${short.join(' or ')} interview.`
}

/**
 * Mirrors the `handle_candidate_changes` trigger so the board reacts instantly
 * instead of waiting for the round-trip. The server response is applied right
 * afterwards, so the database always has the final say.
 */
function applyServerRules(patch, previous = null) {
  const next = { ...patch }

  if (next.has_arrived === false) {
    return {
      ...next,
      arrival_time: null,
      assigned_room: null,
      current_task_assignment: null,
      room_entry_time: null,
      debate_interview_completed: false,
      personal_interview_completed: false,
    }
  }

  if (next.debate_interview_completed === true || next.personal_interview_completed === true) {
    next.assigned_room = null
    next.current_task_assignment = null
  }

  if (next.assigned_room === null) {
    next.current_task_assignment = null
    next.room_entry_time = null
  } else if (next.assigned_room) {
    // Rule 5 — being put in a room (or moved) starts the in-room clock. Landing
    // in the room they are already standing in leaves that clock running, which
    // is what the server does, so auto-assign can't rewind a running timer.
    if (next.assigned_room !== previous?.assigned_room || !previous?.room_entry_time) {
      next.room_entry_time = new Date().toISOString()
    }
  }

  return next
}

function UserPlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5M12 3v12" />
    </svg>
  )
}

/** Lightning bolt — "call the next person in line". */
function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
      <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
    </svg>
  )
}

export default function Admin() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const {
    candidates,
    rooms,
    loading,
    error,
    reload,
    patchLocal,
    addLocal,
    removeLocal,
    patchRoomLocal,
    addRoomLocal,
    removeRoomLocal,
  } = useCandidates()

  const [clock, setClock] = useState(() => nowMinutes())
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(null)
  const [qrTarget, setQrTarget] = useState(null)
  const [toast, setToast] = useState(null)
  const [busyIds, setBusyIds] = useState(() => new Set())
  const [busyRoomId, setBusyRoomId] = useState(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef(null)
  /** Latest board state, for callbacks that must stay identity-stable. */
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates
  /** Per-candidate request counter — a slow reply must not overwrite a newer edit. */
  const patchSeqRef = useRef(new Map())

  useEffect(() => {
    const timer = setInterval(() => setClock(nowMinutes()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    log.info('dashboard mounted', { user: user?.email })
  }, [user])

  useEffect(() => {
    if (!loading) log.info('board state', { candidates: candidates.length, rooms: rooms.length })
  }, [loading, candidates.length, rooms.length])

  const notify = useCallback((message, tone = 'info') => {
    setToast({ message, tone, id: Date.now() })
  }, [])

  const dismissToast = useCallback(() => setToast(null), [])

  /** Sign out and return to the login form rather than a dead-end panel. */
  const handleSignOut = useCallback(async () => {
    await signOut()
    navigate('/login', { replace: true })
  }, [navigate, signOut])

  const markBusy = useCallback((id, on) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  /* ----------------------------- candidates ----------------------------- */
  const patchCandidate = useCallback(
    async (id, patch) => {
      // Two quick clicks on the same row can resolve out of order. Only the
      // newest request for a row is allowed to write its result into state.
      const seq = (patchSeqRef.current.get(id) ?? 0) + 1
      patchSeqRef.current.set(id, seq)

      markBusy(id, true)
      log.debug('patch candidate', { id, patch })
      const previous = candidatesRef.current.find((candidate) => candidate.id === id) ?? null
      patchLocal(id, applyServerRules(patch, previous))

      const { data, error: updateError } = await supabase
        .from('candidates')
        .update(patch)
        .eq('id', id)
        .select()
        .single()

      if (patchSeqRef.current.get(id) !== seq) {
        log.debug('ignoring superseded patch response', { id })
        return false
      }
      markBusy(id, false)

      if (updateError) {
        log.error('patch failed — reloading to resync', {
          id,
          patch,
          code: updateError.code,
          message: updateError.message,
        })
        notify(updateError.message, 'error')
        reload('patch-failed')
        return false
      }
      patchLocal(id, data)
      return true
    },
    [markBusy, notify, patchLocal, reload],
  )

  /* ----------------------------- auto-assign ------------------------------ */
  /**
   * The shared decision, with no toast attached: where should this candidate go,
   * and if nowhere, why not.
   *
   * A candidate who still owes both interviews may be routable down *either*
   * track, so "nowhere" has to be judged across both: there may be no Debate room
   * at all, or every Debate room may be blocked for them, and the Personal rooms
   * can still save the day. Only when both tracks are dead is there a failure.
   *
   * Returning a reason instead of notifying lets the two callers explain the
   * same failure differently — the wand is talking about one person the admin
   * picked, while "call next" has to name whoever is holding up the line.
   */
  const choosePlacement = useCallback(
    async (candidate) => {
      const needed = neededTasks(candidate)
      if (!needed.length) return { reason: 'done' }

      // "There is no such room" and "every such room is off-limits" are
      // different problems and get different explanations — and each question
      // is asked across every track the candidate can use, not just one.
      if (!needed.some((task) => roomsForTask(task, rooms).length > 0)) {
        return { reason: 'no-room', needed }
      }
      if (!needed.some((task) => roomsForTask(task, rooms, candidate).length > 0)) {
        return { reason: 'restricted', needed }
      }

      // The queues are counted from the database rather than from the last
      // realtime snapshot: another admin may have assigned somebody a second
      // ago, and the whole point of the button is to balance the load that
      // actually exists.
      const { data, error: loadError } = await supabase
        .from('candidates')
        .select('id, assigned_room')
        .not('assigned_room', 'is', null)

      if (loadError) return { reason: 'error', message: loadError.message }

      const loads = roomLoads(data ?? [], candidate.id)
      const placement = pickPlacement(candidate, rooms, loads)
      // Unreachable in practice (the filtered check above already proved a room
      // exists), but a null here must never be read as "place them anywhere".
      if (!placement) return { reason: 'restricted', needed }

      return { reason: 'ok', ...placement }
    },
    [rooms],
  )

  /**
   * Send a candidate to the room the board can best afford to use.
   */
  const autoAssign = useCallback(
    async (candidate) => {
      const placement = await choosePlacement(candidate)

      if (placement.reason === 'done') {
        notify(`${candidate.name} has no interviews left to assign.`, 'info')
        return
      }
      if (placement.reason === 'no-room') {
        log.warn('auto-assign found nowhere to send the candidate', {
          id: candidate.id,
          name: candidate.name,
          needed: placement.needed,
        })
        notify(noRoomMessage(placement.needed), 'error')
        return
      }
      if (placement.reason === 'restricted') {
        log.warn('auto-assign blocked by interviewer conflicts', {
          id: candidate.id,
          name: candidate.name,
          needed: placement.needed,
          restricted: blockedInterviewers(candidate),
        })
        notify(ALL_RESTRICTED_MESSAGE, 'error')
        return
      }
      if (placement.reason === 'error') {
        log.error('auto-assign could not read the queue', { message: placement.message })
        notify(placement.message, 'error')
        return
      }

      const { room, task, load, pools } = placement
      log.info('auto-assign chose a track', {
        name: candidate.name,
        task,
        room: room.room_name,
        queue: load,
        debateMin: pools[DEBATE_INTERVIEW],
        personalMin: pools[PERSONAL_INTERVIEW],
      })

      const ok = await patchCandidate(candidate.id, {
        assigned_room: room.id,
        current_task_assignment: task,
      })
      if (ok) notify(`Candidate assigned to ${room.room_name} for ${task}.`, 'success')
    },
    [choosePlacement, notify, patchCandidate],
  )

  /**
   * Dispatch the head of the line.
   *
   * Arrival order is the dispatch order: the earliest arrival still waiting goes
   * first, and their planned time does not enter into it. Strict FIFO — if the
   * head of the line cannot be placed, we say so and stop rather than quietly
   * promoting somebody who arrived later. The per-candidate wand is still there
   * for the admin's overrides.
   */
  const autoAssignNext = useCallback(
    async (head) => {
      if (!head) {
        notify('Nobody is waiting for an interview.', 'info')
        return
      }

      const placement = await choosePlacement(head)

      if (placement.reason === 'done') {
        notify(`${head.name} has no interviews left to assign.`, 'info')
        return
      }
      if (placement.reason === 'no-room') {
        log.warn('call-next stalled: nowhere to send the head of the line', {
          id: head.id,
          name: head.name,
          needed: placement.needed,
        })
        const types = [...new Set(placement.needed.map(roomTypeForTask))]
        notify(
          types.length === 1
            ? `${head.name} is first in line, but no ${types[0]} or General room is available for a ${placement.needed[0]}.`
            : `${head.name} is first in line, but no room is available for a Debate or Personal interview.`,
          'error',
        )
        return
      }
      if (placement.reason === 'restricted') {
        log.warn('call-next stalled: interviewer conflicts', {
          id: head.id,
          name: head.name,
          needed: placement.needed,
        })
        notify(
          `${head.name} is first in line, but every applicable room has a restricted interviewer for them.`,
          'error',
        )
        return
      }
      if (placement.reason === 'error') {
        log.error('call-next could not read the queue', { message: placement.message })
        notify(placement.message, 'error')
        return
      }

      const { room, task, load, pools } = placement
      log.info('call-next assigns the head of the line', {
        id: head.id,
        name: head.name,
        task,
        room: room.room_name,
        queue: load,
        debateMin: pools[DEBATE_INTERVIEW],
        personalMin: pools[PERSONAL_INTERVIEW],
      })

      const ok = await patchCandidate(head.id, {
        assigned_room: room.id,
        current_task_assignment: task,
      })
      if (ok) notify(`${head.name} — you're up. Assigned to ${room.room_name} for ${task}.`, 'success')
    },
    [choosePlacement, notify, patchCandidate],
  )

  const saveCandidate = useCallback(
    async (values, id) => {
      if (id) {
        log.info('update candidate', { id, values })
        const { data, error: updateError } = await supabase
          .from('candidates')
          .update(values)
          .eq('id', id)
          .select()
          .single()
        if (updateError) {
          log.error('update candidate failed', { id, message: updateError.message })
          throw updateError
        }
        patchLocal(id, data)
        notify('Candidate updated.', 'success')
      } else {
        log.info('add candidate', { values })
        const { data, error: insertError } = await supabase.from('candidates').insert(values).select().single()
        if (insertError) {
          log.error('add candidate failed', { message: insertError.message })
          throw insertError
        }
        addLocal(data)
        notify('Candidate added.', 'success')
      }
    },
    [addLocal, notify, patchLocal],
  )

  const deleteCandidate = useCallback(
    async (candidate) => {
      if (!window.confirm(`Delete “${candidate.name}”? This cannot be undone.`)) return
      log.info('delete candidate', { id: candidate.id, name: candidate.name })
      const { error: deleteError } = await supabase.from('candidates').delete().eq('id', candidate.id)
      if (deleteError) {
        log.error('delete candidate failed', { id: candidate.id, message: deleteError.message })
        notify(deleteError.message, 'error')
        return
      }
      removeLocal(candidate.id)
      notify('Candidate deleted.', 'success')
    },
    [notify, removeLocal],
  )

  /* -------------------------------- rooms -------------------------------- */
  const addRoom = useCallback(
    async (values) => {
      log.info('add room', values)
      const { data, error: insertError } = await supabase.from('rooms').insert(values).select().single()
      if (insertError) {
        log.error('add room failed', { values, message: insertError.message })
        notify(insertError.message, 'error')
        return false
      }
      addRoomLocal(data)
      notify(`Room “${values.room_name}” added.`, 'success')
      return true
    },
    [addRoomLocal, notify],
  )

  const updateRoom = useCallback(
    async (room, patch) => {
      log.info('update room', { id: room.id, name: room.room_name, patch })
      patchRoomLocal(room.id, patch) // optimistic — otherwise the select snaps back
      setBusyRoomId(room.id)

      const { data, error: updateError } = await supabase
        .from('rooms')
        .update(patch)
        .eq('id', room.id)
        .select()
        .single()
      setBusyRoomId(null)

      if (updateError) {
        log.error('update room failed', { id: room.id, message: updateError.message })
        // Roll back exactly the fields this patch touched, whatever they were.
        patchRoomLocal(room.id, Object.fromEntries(Object.keys(patch).map((key) => [key, room[key]])))
        notify(updateError.message, 'error')
        return false
      }
      patchRoomLocal(room.id, data)
      return true
    },
    [notify, patchRoomLocal],
  )

  const deleteRoom = useCallback(
    async (room) => {
      if (!window.confirm(`Delete “${room.room_name}”? Candidates in it will be unassigned.`)) return
      log.info('delete room', { id: room.id, name: room.room_name })

      // The database clears the room + task for everyone in it (FK + trigger).
      // Mirror that locally so a card never briefly shows a room that is gone.
      const affected = candidatesRef.current.filter((candidate) => candidate.assigned_room === room.id)

      removeRoomLocal(room.id)
      affected.forEach((candidate) =>
        patchLocal(candidate.id, { assigned_room: null, current_task_assignment: null }),
      )

      const { error: deleteError } = await supabase.from('rooms').delete().eq('id', room.id)
      if (deleteError) {
        log.error('delete room failed', { id: room.id, message: deleteError.message })
        addRoomLocal(room)
        affected.forEach((candidate) =>
          patchLocal(candidate.id, {
            assigned_room: candidate.assigned_room,
            current_task_assignment: candidate.current_task_assignment,
          }),
        )
        notify(deleteError.message, 'error')
        return
      }
      notify(`Room “${room.room_name}” deleted.`, 'success')
    },
    [addRoomLocal, notify, patchLocal, removeRoomLocal],
  )

  /* ------------------------------- import -------------------------------- */
  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setImporting(true)
    try {
      log.info('csv import started', { file: file.name, bytes: file.size })
      const { rows, skipped, total } = await parseCandidatesCsv(file)

      if (!rows.length) {
        log.warn('csv import rejected — no usable rows', { total, skipped })
        notify('No valid rows found. Check that the CSV has a “שם מלא” (name) column.', 'error')
        return
      }

      // Guard against re-importing the same sheet (or a duplicated row).
      // The keys come from the database, not from local state, so a fast
      // double-import can't slip a duplicate through on a stale snapshot.
      const { data: existingRows, error: existingError } = await supabase
        .from('candidates')
        .select('serial_number, name, planned_time, phone_number')
      if (existingError) throw existingError
      const existing = new Set((existingRows ?? []).map((row) => dedupeKey(row)))
      const seen = new Set()
      const fresh = []
      let duplicates = 0
      for (const row of rows) {
        const key = dedupeKey(row)
        if (existing.has(key) || seen.has(key)) {
          duplicates += 1
          continue
        }
        seen.add(key)
        fresh.push(row)
      }

      if (!fresh.length) {
        log.info('csv import skipped — every row already present', { rows: rows.length })
        notify(`All ${rows.length} row(s) are already in the queue — nothing was imported.`, 'info')
        return
      }

      const { data, error: insertError } = await supabase.from('candidates').insert(fresh).select()
      if (insertError) throw insertError

      const imported = data?.length ?? fresh.length
      log.info('csv import complete', { imported, duplicates, skippedBlankNames: skipped })
      notify(
        `Imported ${imported} candidate(s)` +
          (duplicates ? `, skipped ${duplicates} duplicate(s)` : '') +
          (skipped ? `, skipped ${skipped} empty row(s)` : '') +
          '.',
        'success',
      )
      reload('after-import')
    } catch (err) {
      log.error('csv import failed', { error: err })
      notify(err?.message || 'Import failed.', 'error')
    } finally {
      setImporting(false)
    }
  }

  /* ------------------------------- lists --------------------------------- */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return candidates
    return candidates.filter((candidate) =>
      [candidate.name, candidate.serial_number, candidate.phone_number]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    )
  }, [candidates, query])

  const notArrived = useMemo(
    () =>
      visible
        .filter((candidate) => !candidate.has_arrived)
        .map((candidate) => ({ candidate, late: isLate(candidate.planned_time, clock) }))
        .sort((a, b) => {
          if (a.late !== b.late) return a.late ? -1 : 1
          const left = parseTimeToMinutes(a.candidate.planned_time) ?? UNPLANNED
          const right = parseTimeToMinutes(b.candidate.planned_time) ?? UNPLANNED
          return left - right
        }),
    [visible, clock],
  )

  const inProgress = useMemo(
    () =>
      visible
        .filter(
          (candidate) =>
            candidate.has_arrived &&
            !(candidate.debate_interview_completed && candidate.personal_interview_completed),
        )
        .sort((a, b) => {
          const left = a.arrival_time ? new Date(a.arrival_time).getTime() : UNPLANNED
          const right = b.arrival_time ? new Date(b.arrival_time).getTime() : UNPLANNED
          return left - right
        }),
    [visible],
  )

  const finished = useMemo(
    () =>
      visible
        .filter(
          (candidate) =>
            candidate.has_arrived &&
            candidate.debate_interview_completed &&
            candidate.personal_interview_completed,
        )
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'he')),
    [visible],
  )

  /*
   * The line itself. Position is a property of the queue, not of the filtered
   * view, so it is computed from every candidate — searching the board must not
   * renumber who is actually next.
   */
  const waiting = useMemo(() => waitingInLine(candidates), [candidates])
  const positions = useMemo(() => queuePositions(candidates), [candidates])

  const lateCount = notArrived.filter((entry) => entry.late).length

  const renderCard = (candidate, late = false) => (
    <CandidateCard
      key={candidate.id}
      candidate={candidate}
      rooms={rooms}
      late={late}
      busy={busyIds.has(candidate.id)}
      queuePosition={positions.get(candidate.id) ?? null}
      onPatch={patchCandidate}
      onEdit={setEditing}
      onDelete={deleteCandidate}
      onShowQr={setQrTarget}
      onAutoAssign={autoAssign}
    />
  )

  return (
    <div className="min-h-screen bg-background">
      {/* ------------------------------ header ------------------------------ */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-start justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <BrandMark className="size-11" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Candidate Queue</h1>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-block size-2 animate-pulse rounded-full bg-status-debate" />
                Live · {candidates.length} candidates · {rooms.length} rooms
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {lateCount > 0 && (
              <span className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-sm font-semibold text-destructive">
                {lateCount} late
              </span>
            )}
            <button
              type="button"
              onClick={() => setEditing({})}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110"
            >
              <UserPlusIcon />
              Add Candidate
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
            >
              <UploadIcon />
              {importing ? 'Importing…' : 'Import CSV'}
            </button>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
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

      {/* ------------------------------- body ------------------------------- */}
      <main className="mx-auto max-w-[1600px] px-4 py-5">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-late-surface px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <RoomsPanel
          rooms={rooms}
          candidates={candidates}
          busyId={busyRoomId}
          onAddRoom={addRoom}
          onUpdateRoom={updateRoom}
          onDeleteRoom={deleteRoom}
        />

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name…"
                className="min-w-[12rem] flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />

              {/*
                The line, dispatched in arrival order. Whoever walked in first is
                next — their planned time has no say once they are in the
                building. Strict FIFO: if the head cannot be placed the button
                explains why and stops, rather than promoting somebody behind
                them.
              */}
              <button
                type="button"
                onClick={() => autoAssignNext(waiting[0])}
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
          </>
        )}
      </main>

      {/* ------------------------------ overlays ---------------------------- */}
      <AddEditCandidateModal
        open={Boolean(editing)}
        candidate={editing && editing.id ? editing : null}
        onClose={() => setEditing(null)}
        onSave={saveCandidate}
      />
      <QrModal candidate={qrTarget} onClose={() => setQrTarget(null)} />
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
