/**
 * The dispatcher's board.
 *
 * This page owns *orchestration* only: it wires the live read model
 * (`useCandidates`) to the write service (`useQueueActions`), decides what a
 * click means, and turns failures into toasts. Everything it renders is a
 * component; every rule it applies lives in `domain/`.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import type { Candidate, CandidatePatch, Room, RoomPatch, RoomType, TaskAssignment, ToastMessage, ToastTone } from '../core/types'
import { createLogger } from '../core/logger'
import { useAuth } from '../hooks/useAuth'
import { useCandidates } from '../hooks/useCandidates'
import { useQueueActions } from '../hooks/useQueueActions'
import { parseCandidatesCsv } from '../domain/csv'
import { blockedInterviewers } from '../domain/conflicts'
import { DEBATE_INTERVIEW, PERSONAL_INTERVIEW, roomTypeForTask } from '../domain/autoAssign'
import { applyServerRules } from '../domain/candidateRules'
import BrandMark from '../components/ui/BrandMark'
import Toast from '../components/ui/Toast'
import CandidateQueueList from '../components/features/CandidateQueueList'
import RoomsPanel from '../components/features/RoomsPanel'
import AddEditCandidateModal from '../components/features/AddEditCandidateModal'
import QrModal from '../components/features/QrModal'

const log = createLogger('admin')

/** Every applicable room is unusable because of the candidate's restrictions. */
const ALL_RESTRICTED_MESSAGE =
  'Auto-Assign Failed: All applicable rooms have a restricted interviewer for this candidate.'

/**
 * "Nowhere to go" - the other dead end, for the case where the board has no room
 * of the needed kind at all. A General room counts for either interview, so when
 * this fires there is genuinely nothing to use.
 */
function noRoomMessage(needed: TaskAssignment[]): string {
  const types = [...new Set(needed.map(roomTypeForTask))]
  if (types.length === 1) return `No ${types[0]} or General room is available for a ${needed[0]}.`
  const short = needed.map((task) => task.replace(' Interview', ''))
  return `No room is available for a ${short.join(' or ')} interview.`
}

function UserPlusIcon() {
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
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  )
}

function UploadIcon() {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5M12 3v12" />
    </svg>
  )
}

/** The "add" mode of the edit modal, as opposed to editing a real row. */
type EditingTarget = Candidate | 'new' | null

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
  const actions = useQueueActions()

  const [editing, setEditing] = useState<EditingTarget>(null)
  const [qrTarget, setQrTarget] = useState<Candidate | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set())
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /** Latest board state, for callbacks that must stay identity-stable. */
  const candidatesRef = useRef(candidates)
  candidatesRef.current = candidates
  /** Per-candidate request counter - a slow reply must not overwrite a newer edit. */
  const patchSeqRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    log.info('dashboard mounted', { user: user?.email })
  }, [user])

  useEffect(() => {
    if (!loading) log.info('board state', { candidates: candidates.length, rooms: rooms.length })
  }, [loading, candidates.length, rooms.length])

  const notify = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone, id: Date.now() })
  }, [])

  const dismissToast = useCallback(() => setToast(null), [])

  /** Sign out and return to the login form rather than a dead-end panel. */
  const handleSignOut = useCallback(async () => {
    await signOut()
    navigate('/login', { replace: true })
  }, [navigate, signOut])

  const markBusy = useCallback((id: string, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  /* ----------------------------- candidates ----------------------------- */
  const patchCandidate = useCallback(
    async (id: string, patch: CandidatePatch): Promise<boolean> => {
      // Two quick clicks on the same row can resolve out of order. Only the
      // newest request for a row is allowed to write its result into state.
      const seq = (patchSeqRef.current.get(id) ?? 0) + 1
      patchSeqRef.current.set(id, seq)

      markBusy(id, true)
      log.debug('patch candidate', { id, patch })
      const previous = candidatesRef.current.find((candidate) => candidate.id === id) ?? null
      patchLocal(id, applyServerRules(patch, previous))

      let updated: Candidate
      try {
        updated = await actions.patchCandidate(id, patch)
      } catch (cause) {
        if (patchSeqRef.current.get(id) !== seq) {
          log.debug('ignoring superseded patch response', { id })
          return false
        }
        markBusy(id, false)
        const message = cause instanceof Error ? cause.message : 'Could not update the candidate.'
        log.error('patch failed - reloading to resync', { id, patch, message })
        notify(message, 'error')
        await reload('patch-failed')
        return false
      }

      if (patchSeqRef.current.get(id) !== seq) {
        log.debug('ignoring superseded patch response', { id })
        return false
      }
      markBusy(id, false)
      patchLocal(id, updated)
      return true
    },
    [actions, markBusy, notify, patchLocal, reload],
  )

  /* ----------------------------- auto-assign ------------------------------ */
  /**
   * Send a candidate to the room the board can best afford to use.
   */
  const autoAssign = useCallback(
    async (candidate: Candidate) => {
      const placement = await actions.choosePlacement(candidate, rooms)

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
    [actions, notify, patchCandidate, rooms],
  )

  /**
   * Dispatch the head of the line.
   *
   * Arrival order is the dispatch order: the earliest arrival still waiting goes
   * first, and their planned time does not enter into it. Strict FIFO - if the
   * head of the line cannot be placed, we say so and stop rather than quietly
   * promoting somebody who arrived later.
   */
  const autoAssignNext = useCallback(
    async (head: Candidate | undefined) => {
      if (!head) {
        notify('Nobody is waiting for an interview.', 'info')
        return
      }

      const placement = await actions.choosePlacement(head, rooms)

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
    [actions, notify, patchCandidate, rooms],
  )

  const saveCandidate = useCallback(
    async (values: CandidatePatch, id?: string) => {
      if (id) {
        log.info('update candidate', { id, values })
        const updated = await actions.saveCandidate(values, id)
        patchLocal(id, updated)
        notify('Candidate updated.', 'success')
      } else {
        log.info('add candidate', { values })
        const created = await actions.saveCandidate(values)
        addLocal(created)
        notify('Candidate added.', 'success')
      }
    },
    [actions, addLocal, notify, patchLocal],
  )

  const deleteCandidate = useCallback(
    async (candidate: Candidate) => {
      if (!window.confirm(`Delete "${candidate.name}"? This cannot be undone.`)) return
      log.info('delete candidate', { id: candidate.id, name: candidate.name })
      try {
        await actions.deleteCandidate(candidate.id)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Could not delete the candidate.'
        log.error('delete candidate failed', { id: candidate.id, message })
        notify(message, 'error')
        return
      }
      removeLocal(candidate.id)
      notify('Candidate deleted.', 'success')
    },
    [actions, notify, removeLocal],
  )

  /* -------------------------------- rooms -------------------------------- */
  const addRoom = useCallback(
    async (values: { room_name: string; room_type: RoomType }) => {
      log.info('add room', values)
      try {
        const room = await actions.createRoom({ ...values, interviewers: [] })
        addRoomLocal(room)
        notify(`Room "${values.room_name}" added.`, 'success')
        return true
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Could not add the room.'
        log.error('add room failed', { values, message })
        notify(message, 'error')
        return false
      }
    },
    [actions, addRoomLocal, notify],
  )

  const updateRoom = useCallback(
    async (room: Room, patch: RoomPatch) => {
      log.info('update room', { id: room.id, name: room.room_name, patch })
      patchRoomLocal(room.id, patch) // optimistic - otherwise the select snaps back
      setBusyRoomId(room.id)

      try {
        const updated = await actions.updateRoom(room.id, patch)
        setBusyRoomId(null)
        patchRoomLocal(room.id, updated)
        return true
      } catch (cause) {
        setBusyRoomId(null)
        // Roll back exactly the fields this patch touched, whatever they were.
        const rollback = Object.fromEntries(
          Object.keys(patch).map((key) => [key, room[key as keyof Room]]),
        ) as RoomPatch
        patchRoomLocal(room.id, rollback)
        const message = cause instanceof Error ? cause.message : 'Could not update the room.'
        log.error('update room failed', { id: room.id, message })
        notify(message, 'error')
        return false
      }
    },
    [actions, notify, patchRoomLocal],
  )

  const deleteRoom = useCallback(
    async (room: Room) => {
      if (!window.confirm(`Delete "${room.room_name}"? Candidates in it will be unassigned.`)) return
      log.info('delete room', { id: room.id, name: room.room_name })

      // The database clears the room + task for everyone in it (FK + trigger).
      // Mirror that locally so a card never briefly shows a room that is gone.
      const affected = candidatesRef.current.filter((candidate) => candidate.assigned_room === room.id)

      removeRoomLocal(room.id)
      affected.forEach((candidate) =>
        patchLocal(candidate.id, { assigned_room: null, current_task_assignment: null }),
      )

      try {
        await actions.deleteRoom(room.id)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Could not delete the room.'
        log.error('delete room failed', { id: room.id, message })
        addRoomLocal(room)
        affected.forEach((candidate) =>
          patchLocal(candidate.id, {
            assigned_room: candidate.assigned_room,
            current_task_assignment: candidate.current_task_assignment,
          }),
        )
        notify(message, 'error')
        return
      }
      notify(`Room "${room.room_name}" deleted.`, 'success')
    },
    [actions, addRoomLocal, notify, patchLocal, removeRoomLocal],
  )

  /* ------------------------------- import -------------------------------- */
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setImporting(true)
    try {
      log.info('csv import started', { file: file.name, bytes: file.size })
      const { rows, skipped, total } = await parseCandidatesCsv(file)

      if (!rows.length) {
        log.warn('csv import rejected - no usable rows', { total, skipped })
        notify('No valid rows found. Check that the CSV has a "שם מלא" (name) column.', 'error')
        return
      }

      const { imported, duplicates } = await actions.importCandidates(rows)

      if (!imported) {
        log.info('csv import skipped - every row already present', { rows: rows.length })
        notify(`All ${rows.length} row(s) are already in the queue - nothing was imported.`, 'info')
        return
      }

      log.info('csv import complete', { imported, duplicates, skippedBlankNames: skipped })
      notify(
        `Imported ${imported} candidate(s)` +
          (duplicates ? `, skipped ${duplicates} duplicate(s)` : '') +
          (skipped ? `, skipped ${skipped} empty row(s)` : '') +
          '.',
        'success',
      )
      await reload('after-import')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Import failed.'
      log.error('csv import failed', { error: cause })
      notify(message, 'error')
    } finally {
      setImporting(false)
    }
  }

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
            <button
              type="button"
              onClick={() => setEditing('new')}
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
              {importing ? 'Importing...' : 'Import CSV'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFile}
            />
            <Link
              to="/admin/analytics"
              className="inline-flex items-center gap-2 rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              Analytics
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

        <CandidateQueueList
          candidates={candidates}
          rooms={rooms}
          loading={loading}
          busyIds={busyIds}
          onPatch={patchCandidate}
          onEdit={(candidate) => setEditing(candidate)}
          onDelete={deleteCandidate}
          onShowQr={setQrTarget}
          onAutoAssign={autoAssign}
          onCallNext={autoAssignNext}
        />
      </main>

      {/* ------------------------------ overlays ---------------------------- */}
      <AddEditCandidateModal
        open={editing !== null}
        candidate={editing && editing !== 'new' ? editing : null}
        onClose={() => setEditing(null)}
        onSave={saveCandidate}
      />
      <QrModal candidate={qrTarget} onClose={() => setQrTarget(null)} />
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}
