/**
 * Local in-browser implementation of `DatabaseService` (`localStorage` +
 * `BroadcastChannel`).
 *
 * Used for local development and testing without Supabase credentials or Docker.
 * Enforces Rules 1–7, writes to the append-only movement ledger, and broadcasts
 * realtime updates across browser tabs.
 */
import type {
  Candidate,
  CandidateAssignment,
  CandidateDedupeRow,
  CandidateEvent,
  CandidatePatch,
  Evaluation,
  EventPatch,
  EventSummary,
  NewCandidate,
  NewEvaluation,
  NewEvent,
  NewRoom,
  QueueEvent,
  Room,
  RoomPatch,
  TaskAssignment,
} from '../core/types'
import { DEBATE_INTERVIEW, PERSONAL_INTERVIEW, TASK_FOR_ROOM_TYPE } from '../core/constants'
import { cleanInterviewerRows, conflictingInterviewers, parseConstraintList } from '../domain/conflicts'
import { todayIso } from '../domain/events'
import { defaultDebateFormConfig, defaultPersonalFormConfig } from '../domain/formBuilder'
import type {
  AuthGateway,
  AuthSession,
  BoardRealtimeHandlers,
  CandidateRepository,
  DatabaseService,
  EvaluationRepository,
  EventRepository,
  LedgerRepository,
  PublicCandidate,
  PublicRoom,
  RealtimeEvent,
  RealtimeGateway,
  RoomRepository,
  RoomWithEvent,
} from './database'

const STORAGE_KEY = 'cq:localSandboxDb:v1'
const CHANNEL_NAME = 'cq:local-realtime'

interface LocalStore {
  events: QueueEvent[]
  rooms: Room[]
  candidates: Candidate[]
  evaluations: Evaluation[]
  candidate_events: CandidateEvent[]
  allowed_admins: string[]
  sessionEmail: string | null
  nextLedgerId: number
}

type RealtimeMessage =
  | {
      kind: 'candidate'
      eventId: string
      event: RealtimeEvent
      row: Partial<Candidate> & { id?: string }
      previous?: Partial<Candidate>
    }
  | {
      kind: 'room'
      eventId: string
      event: RealtimeEvent
      row: Partial<Room> & { id?: string }
      previous?: Partial<Room>
    }

const inTabListeners = new Set<(msg: RealtimeMessage) => void>()
const authListeners = new Set<(session: AuthSession | null) => void>()

let broadcastChannel: BroadcastChannel | null = null
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME)
    broadcastChannel.onmessage = (ev: MessageEvent<RealtimeMessage>) => {
      inTabListeners.forEach((listener) => listener(ev.data))
    }
  } catch {
    broadcastChannel = null
  }
}

function emitRealtime(msg: RealtimeMessage): void {
  inTabListeners.forEach((listener) => listener(msg))
  try {
    broadcastChannel?.postMessage(msg)
  } catch {
    // Ignore channel errors
  }
}

function createSeedStore(): LocalStore {
  const today = todayIso()
  const now = Date.now()
  const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString()

  const mainEventId = 'local-event-main'
  const draftEventId = 'local-event-draft'

  const events: QueueEvent[] = [
    {
      id: mainEventId,
      name: 'Main event (Local Sandbox)',
      date: today,
      status: 'Active',
      notes: 'Local sandbox environment with pre-loaded rooms, candidates, and evaluations.',
      created_at: minsAgo(240),
      forms: {
        [PERSONAL_INTERVIEW]: defaultPersonalFormConfig(),
        [DEBATE_INTERVIEW]: defaultDebateFormConfig(true),
      },
    },
    {
      id: draftEventId,
      name: 'Fall 2026 Tryouts — Day 2',
      date: '2026-11-15',
      status: 'Draft',
      notes: 'Planned second screening day. Activate from Edit Settings when ready.',
      created_at: minsAgo(120),
    },
  ]

  const rooms: Room[] = [
    {
      id: 'room-a206',
      event_id: mainEventId,
      room_name: 'A206',
      room_type: 'Debate',
      interviewers: [
        { name: 'Daniel Levi', phone: '050-1112233' },
        { name: 'Noa Shapira', phone: '052-3334455' },
      ],
    },
    {
      id: 'room-a207',
      event_id: mainEventId,
      room_name: 'A207',
      room_type: 'Debate',
      interviewers: [{ name: 'Omer Katz', phone: '054-5556677' }],
    },
    {
      id: 'room-cl05',
      event_id: mainEventId,
      room_name: 'CL05',
      room_type: 'Personal',
      interviewers: [
        { name: 'Romi Cohen', phone: '050-7778899' },
        { name: 'Yael Amir', phone: '052-9990011' },
      ],
    },
    {
      id: 'room-sl101',
      event_id: mainEventId,
      room_name: 'SL101',
      room_type: 'Personal',
      interviewers: [{ name: 'Guy Mizrahi', phone: '053-2223344' }],
    },
    {
      id: 'room-peb30',
      event_id: mainEventId,
      room_name: 'PEB30',
      room_type: 'General',
      interviewers: [{ name: 'Maya Ben-David', phone: null }],
    },
    {
      id: 'room-draft-1',
      event_id: draftEventId,
      room_name: 'B101',
      room_type: 'Debate',
      interviewers: [{ name: 'Daniel Levi', phone: '050-1112233' }],
    },
    {
      id: 'room-draft-2',
      event_id: draftEventId,
      room_name: 'B102',
      room_type: 'Personal',
      interviewers: [{ name: 'Romi Cohen', phone: '050-7778899' }],
    },
  ]

  const candidates: Candidate[] = [
    {
      id: 'cand-1',
      event_id: mainEventId,
      serial_number: '101',
      name: 'יוסי כהן',
      phone_number: '050-1234567',
      planned_time: '09:30',
      arrival_time: minsAgo(45),
      has_arrived: true,
      debate_interview_completed: false,
      personal_interview_completed: false,
      interviewer_constraints: [],
      assigned_room: null,
      room_entry_time: null,
      current_task_assignment: null,
      created_at: minsAgo(180),
    },
    {
      id: 'cand-2',
      event_id: mainEventId,
      serial_number: '102',
      name: 'דנה לוי',
      phone_number: '052-2345678',
      planned_time: '09:45',
      arrival_time: minsAgo(35),
      has_arrived: true,
      debate_interview_completed: true,
      personal_interview_completed: false,
      interviewer_constraints: ['Guy Mizrahi'],
      assigned_room: 'room-cl05',
      room_entry_time: minsAgo(12),
      current_task_assignment: PERSONAL_INTERVIEW,
      created_at: minsAgo(175),
    },
    {
      id: 'cand-3',
      event_id: mainEventId,
      serial_number: '103',
      name: 'עמית פרידמן',
      phone_number: '054-3456789',
      planned_time: '10:00',
      arrival_time: minsAgo(28),
      has_arrived: true,
      debate_interview_completed: false,
      personal_interview_completed: false,
      interviewer_constraints: [],
      assigned_room: 'room-a206',
      room_entry_time: minsAgo(22),
      current_task_assignment: DEBATE_INTERVIEW,
      created_at: minsAgo(170),
    },
    {
      id: 'cand-4',
      event_id: mainEventId,
      serial_number: '104',
      name: 'שירה אברהם',
      phone_number: '053-4567890',
      planned_time: '10:15',
      arrival_time: minsAgo(20),
      has_arrived: true,
      debate_interview_completed: true,
      personal_interview_completed: false,
      interviewer_constraints: [],
      assigned_room: null,
      room_entry_time: null,
      current_task_assignment: null,
      created_at: minsAgo(165),
    },
    {
      id: 'cand-5',
      event_id: mainEventId,
      serial_number: '105',
      name: 'איתי רוזנברג',
      phone_number: '050-5678901',
      planned_time: '09:00',
      arrival_time: null,
      has_arrived: false,
      debate_interview_completed: false,
      personal_interview_completed: false,
      interviewer_constraints: ['Daniel Levi'],
      assigned_room: null,
      room_entry_time: null,
      current_task_assignment: null,
      created_at: minsAgo(160),
    },
    {
      id: 'cand-6',
      event_id: mainEventId,
      serial_number: '106',
      name: 'מאיה גולן',
      phone_number: '052-6789012',
      planned_time: '16:30',
      arrival_time: null,
      has_arrived: false,
      debate_interview_completed: false,
      personal_interview_completed: false,
      interviewer_constraints: [],
      assigned_room: null,
      room_entry_time: null,
      current_task_assignment: null,
      created_at: minsAgo(155),
    },
    {
      id: 'cand-7',
      event_id: mainEventId,
      serial_number: '107',
      name: 'תומר שגב',
      phone_number: '054-7890123',
      planned_time: '09:15',
      arrival_time: minsAgo(60),
      has_arrived: true,
      debate_interview_completed: true,
      personal_interview_completed: true,
      interviewer_constraints: [],
      assigned_room: null,
      room_entry_time: null,
      current_task_assignment: null,
      created_at: minsAgo(190),
    },
  ]

  const evaluations: Evaluation[] = [
    {
      id: 'eval-1',
      event_id: mainEventId,
      candidate_id: 'cand-7',
      room_id: 'room-cl05',
      task: PERSONAL_INTERVIEW,
      interviewer_name: 'Romi Cohen, Yael Amir',
      scores: {
        interviewer_name: 'Romi Cohen, Yael Amir',
        candidate_name: 'תומר שגב',
        candidate_number: '107',
        study_track: 'משפטים וממשל',
        years_remaining: 2,
        prior_experience: 'מועדון דיבייט בתיכון',
        monday_conflicts: 'אין התנגשויות',
        why_debate_club: 'רוצה להתחרות בטורנירים בינלאומיים',
        tell_about_yourself: 'סטודנט שנה א, אוהב אקטואליה והיסטוריה',
        free_time_work: 'עובד במשרה חלקית גמישה',
        rating_availability: 5,
        rating_vibe: 5,
        rating_competitiveness: 4,
        interviewer_notes: 'מועמד מצוין ורציני מאוד.',
      },
      submitted_by: 'idc.debate@gmail.com',
      created_at: minsAgo(25),
      candidate: { id: 'cand-7', name: 'תומר שגב', serial_number: '107' },
    },
  ]

  const candidate_events: CandidateEvent[] = [
    {
      id: 1,
      event_id: mainEventId,
      candidate_id: 'cand-7',
      candidate_name: 'תומר שגב',
      at: minsAgo(60),
      event: 'arrived',
      room_id: null,
      room_name: null,
      task: null,
      interviewer: null,
      by_email: 'idc.debate@gmail.com',
      detail: {},
    },
    {
      id: 2,
      event_id: mainEventId,
      candidate_id: 'cand-7',
      candidate_name: 'תומר שגב',
      at: minsAgo(55),
      event: 'assigned',
      room_id: 'room-a206',
      room_name: 'A206',
      task: DEBATE_INTERVIEW,
      interviewer: 'Daniel Levi, Noa Shapira',
      by_email: 'idc.debate@gmail.com',
      detail: {},
    },
    {
      id: 3,
      event_id: mainEventId,
      candidate_id: 'cand-7',
      candidate_name: 'תומר שגב',
      at: minsAgo(40),
      event: 'completed',
      room_id: 'room-a206',
      room_name: 'A206',
      task: DEBATE_INTERVIEW,
      interviewer: 'Daniel Levi, Noa Shapira',
      by_email: 'idc.debate@gmail.com',
      detail: {},
    },
    {
      id: 4,
      event_id: mainEventId,
      candidate_id: 'cand-7',
      candidate_name: 'תומר שגב',
      at: minsAgo(38),
      event: 'assigned',
      room_id: 'room-cl05',
      room_name: 'CL05',
      task: PERSONAL_INTERVIEW,
      interviewer: 'Romi Cohen, Yael Amir',
      by_email: 'idc.debate@gmail.com',
      detail: {},
    },
    {
      id: 5,
      event_id: mainEventId,
      candidate_id: 'cand-7',
      candidate_name: 'תומר שגב',
      at: minsAgo(25),
      event: 'completed',
      room_id: 'room-cl05',
      room_name: 'CL05',
      task: PERSONAL_INTERVIEW,
      interviewer: 'Romi Cohen, Yael Amir',
      by_email: 'idc.debate@gmail.com',
      detail: {},
    },
  ]

  return {
    events,
    rooms,
    candidates,
    evaluations,
    candidate_events,
    allowed_admins: ['idc.debate@gmail.com', 'admin@example.com'],
    sessionEmail: 'idc.debate@gmail.com',
    nextLedgerId: 6,
  }
}

function loadStore(): LocalStore {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return createSeedStore()
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const seed = createSeedStore()
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
      return seed
    }
    return JSON.parse(raw) as LocalStore
  } catch {
    return createSeedStore()
  }
}

function saveStore(store: LocalStore): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Ignore storage errors
  }
}

export function resetLocalSandboxData(): void {
  const seed = createSeedStore()
  saveStore(seed)
}

export const resetLocalDatabase = resetLocalSandboxData

function roomPanelString(room: Room | undefined): string | null {
  if (!room) return null
  const joined = room.interviewers
    .map((p) => p.name.trim())
    .filter(Boolean)
    .join(', ')
  return joined || null
}

function applyCandidateTriggers(
  store: LocalStore,
  previous: Candidate | null,
  draft: Candidate,
): Candidate {
  const next: Candidate = {
    ...draft,
    interviewer_constraints: parseConstraintList((draft.interviewer_constraints ?? []).join(',')),
  }

  // Rule 1: Arrival is a precondition
  if (!next.has_arrived) {
    next.arrival_time = null
    next.assigned_room = null
    next.current_task_assignment = null
    next.room_entry_time = null
    next.debate_interview_completed = false
    next.personal_interview_completed = false
    return next
  }

  // Rule 2: Stamp arrival time once
  if (!previous?.has_arrived) {
    next.arrival_time = next.arrival_time ?? new Date().toISOString()
  }

  // Rule 3: Auto-release on interview completion
  if (
    (next.debate_interview_completed && !previous?.debate_interview_completed) ||
    (next.personal_interview_completed && !previous?.personal_interview_completed)
  ) {
    next.assigned_room = null
    next.current_task_assignment = null
  }

  // Rule 4: No orphan task without room
  if (!next.assigned_room) {
    next.current_task_assignment = null
  }

  // Rule 5: Server-owned room_entry_time
  if (!next.assigned_room) {
    next.room_entry_time = null
  } else if (next.assigned_room !== previous?.assigned_room || !previous?.room_entry_time) {
    next.room_entry_time = new Date().toISOString()
  } else {
    next.room_entry_time = previous.room_entry_time
  }

  // Rule 6 & Rule 7: Room validation, conflict check, and derived task
  if (next.assigned_room) {
    const room = store.rooms.find((r) => r.id === next.assigned_room)
    if (!room || room.event_id !== next.event_id) {
      throw new Error(`Room ${next.assigned_room} does not belong to this event.`)
    }

    if (next.assigned_room !== previous?.assigned_room) {
      const conflicts = conflictingInterviewers(room, next)
      if (conflicts.length > 0) {
        throw new Error(
          `Conflict of interest: interviewer "${conflicts.join(', ')}" is on this candidate's restricted list.`,
        )
      }
    }

    const derivedTask = TASK_FOR_ROOM_TYPE[room.room_type]
    if (derivedTask) {
      next.current_task_assignment = derivedTask
    }
  }

  return next
}

function logCandidateMovements(
  store: LocalStore,
  previous: Candidate | null,
  current: Candidate,
): void {
  const nowIso = new Date().toISOString()
  const actor = store.sessionEmail

  const append = (
    event: CandidateEvent['event'],
    roomId: string | null,
    task: TaskAssignment | null,
  ) => {
    const room = roomId ? store.rooms.find((r) => r.id === roomId) : undefined
    store.candidate_events.push({
      id: store.nextLedgerId++,
      event_id: current.event_id,
      candidate_id: current.id,
      candidate_name: current.name,
      at: nowIso,
      event,
      room_id: roomId,
      room_name: room?.room_name ?? null,
      task,
      interviewer: roomPanelString(room),
      by_email: actor,
      detail: {},
    })
  }

  if (!previous) {
    if (current.has_arrived) {
      append('arrived', null, null)
      if (current.assigned_room) {
        append('assigned', current.assigned_room, current.current_task_assignment)
      }
    }
    return
  }

  if (current.has_arrived && !previous.has_arrived) {
    append('arrived', null, null)
  }
  if (!current.has_arrived && previous.has_arrived) {
    append('unarrived', null, null)
  }

  let completedTask: TaskAssignment | null = null
  if (current.personal_interview_completed && !previous.personal_interview_completed) {
    completedTask = PERSONAL_INTERVIEW
  } else if (current.debate_interview_completed && !previous.debate_interview_completed) {
    completedTask = DEBATE_INTERVIEW
  }

  if (completedTask) {
    append('completed', previous.assigned_room, completedTask)
  } else if (previous.assigned_room !== current.assigned_room) {
    if (previous.assigned_room) {
      append('released', previous.assigned_room, previous.current_task_assignment)
    }
    if (current.assigned_room) {
      append('assigned', current.assigned_room, current.current_task_assignment)
    }
  }
}

export function createLocalDatabase(): DatabaseService {
  const events: EventRepository = {
    async listSummaries(): Promise<EventSummary[]> {
      const store = loadStore()
      return [...store.events]
        .sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at))
        .map((ev) => ({
          ...ev,
          candidate_count: store.candidates.filter((c) => c.event_id === ev.id).length,
          room_count: store.rooms.filter((r) => r.event_id === ev.id).length,
        }))
    },

    async findById(id: string): Promise<QueueEvent | null> {
      const store = loadStore()
      return store.events.find((ev) => ev.id === id) ?? null
    },

    async create(input: NewEvent): Promise<QueueEvent> {
      const store = loadStore()
      const created: QueueEvent = {
        id: `event-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: input.name.trim(),
        date: input.date,
        status: input.status ?? 'Draft',
        notes: (input.notes ?? '').trim(),
        created_at: new Date().toISOString(),
        ...(input.forms ? { forms: input.forms } : {}),
      }
      store.events.push(created)
      saveStore(store)
      return created
    },

    async update(id: string, patch: EventPatch): Promise<QueueEvent> {
      const store = loadStore()
      const idx = store.events.findIndex((ev) => ev.id === id)
      if (idx < 0) throw new Error('Event not found.')
      const updated: QueueEvent = {
        ...store.events[idx],
        ...patch,
      }
      store.events[idx] = updated
      saveStore(store)
      return updated
    },

    async remove(id: string): Promise<void> {
      const store = loadStore()
      const hasHistory = store.candidate_events.some((ev) => ev.event_id === id)
      if (hasHistory) {
        throw new Error('Cannot delete an event that already has movement ledger history.')
      }
      store.events = store.events.filter((ev) => ev.id !== id)
      store.rooms = store.rooms.filter((r) => r.event_id !== id)
      store.candidates = store.candidates.filter((c) => c.event_id !== id)
      store.evaluations = store.evaluations.filter((e) => e.event_id !== id)
      saveStore(store)
    },
  }

  const candidates: CandidateRepository = {
    async list(eventId: string): Promise<Candidate[]> {
      const store = loadStore()
      return store.candidates
        .filter((c) => c.event_id === eventId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    },

    async listAssignments(eventId: string): Promise<CandidateAssignment[]> {
      const store = loadStore()
      return store.candidates
        .filter((c) => c.event_id === eventId && c.assigned_room !== null)
        .map((c) => ({ id: c.id, assigned_room: c.assigned_room }))
    },

    async listDedupeRows(eventId: string): Promise<CandidateDedupeRow[]> {
      const store = loadStore()
      return store.candidates
        .filter((c) => c.event_id === eventId)
        .map((c) => ({
          serial_number: c.serial_number,
          name: c.name,
          planned_time: c.planned_time,
          phone_number: c.phone_number,
        }))
    },

    async findById(id: string): Promise<Candidate | null> {
      const store = loadStore()
      return store.candidates.find((c) => c.id === id) ?? null
    },

    async findPublicById(id: string): Promise<PublicCandidate | null> {
      const store = loadStore()
      const found = store.candidates.find((c) => c.id === id)
      if (!found) return null
      return {
        name: found.name,
        planned_time: found.planned_time,
        arrival_time: found.arrival_time,
        assigned_room: found.assigned_room,
        current_task_assignment: found.current_task_assignment,
        debate_interview_completed: found.debate_interview_completed,
        personal_interview_completed: found.personal_interview_completed,
      }
    },

    async create(eventId: string, input: NewCandidate): Promise<Candidate> {
      const store = loadStore()
      const raw: Candidate = {
        id: `cand-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        event_id: eventId,
        name: input.name,
        serial_number: input.serial_number ?? null,
        phone_number: input.phone_number ?? null,
        planned_time: input.planned_time ?? null,
        arrival_time: null,
        has_arrived: Boolean(input.has_arrived),
        debate_interview_completed: Boolean(input.debate_interview_completed),
        personal_interview_completed: Boolean(input.personal_interview_completed),
        interviewer_constraints: [],
        assigned_room: input.assigned_room ?? null,
        room_entry_time: null,
        current_task_assignment: input.current_task_assignment ?? null,
        created_at: new Date().toISOString(),
      }
      const created = applyCandidateTriggers(store, null, raw)
      store.candidates.push(created)
      logCandidateMovements(store, null, created)
      saveStore(store)
      emitRealtime({ kind: 'candidate', eventId, event: 'INSERT', row: created })
      return created
    },

    async update(id: string, patch: CandidatePatch): Promise<Candidate> {
      const store = loadStore()
      const idx = store.candidates.findIndex((c) => c.id === id)
      if (idx < 0) throw new Error('Candidate not found.')
      const previous = store.candidates[idx]
      const updated = applyCandidateTriggers(store, previous, { ...previous, ...patch })
      store.candidates[idx] = updated
      logCandidateMovements(store, previous, updated)
      saveStore(store)
      emitRealtime({
        kind: 'candidate',
        eventId: updated.event_id,
        event: 'UPDATE',
        row: updated,
        previous,
      })
      return updated
    },

    async remove(id: string): Promise<void> {
      const store = loadStore()
      const existing = store.candidates.find((c) => c.id === id)
      store.candidates = store.candidates.filter((c) => c.id !== id)
      store.evaluations = store.evaluations.filter((e) => e.candidate_id !== id)
      saveStore(store)
      if (existing) {
        emitRealtime({
          kind: 'candidate',
          eventId: existing.event_id,
          event: 'DELETE',
          row: { id },
          previous: existing,
        })
      }
    },

    async importMany(eventId: string, rows: NewCandidate[]): Promise<Candidate[]> {
      const createdRows: Candidate[] = []
      for (const row of rows) {
        const created = await candidates.create(eventId, row)
        createdRows.push(created)
      }
      return createdRows
    },
  }

  const rooms: RoomRepository = {
    async list(eventId: string): Promise<Room[]> {
      const store = loadStore()
      return store.rooms
        .filter((r) => r.event_id === eventId)
        .sort((a, b) => a.room_name.localeCompare(b.room_name))
    },

    async findById(id: string): Promise<PublicRoom | null> {
      const store = loadStore()
      const found = store.rooms.find((r) => r.id === id)
      if (!found) return null
      return { id: found.id, room_name: found.room_name, room_type: found.room_type }
    },

    async findByIdWithEvent(id: string): Promise<RoomWithEvent | null> {
      const store = loadStore()
      const found = store.rooms.find((r) => r.id === id)
      if (!found) return null
      return {
        id: found.id,
        room_name: found.room_name,
        room_type: found.room_type,
        event_id: found.event_id,
      }
    },

    async create(eventId: string, input: NewRoom): Promise<Room> {
      const store = loadStore()
      const created: Room = {
        id: `room-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        event_id: eventId,
        room_name: input.room_name.trim(),
        room_type: input.room_type,
        interviewers: cleanInterviewerRows(input.interviewers),
      }
      store.rooms.push(created)
      saveStore(store)
      emitRealtime({ kind: 'room', eventId, event: 'INSERT', row: created })
      return created
    },

    async createMany(eventId: string, inputs: NewRoom[]): Promise<Room[]> {
      const created: Room[] = []
      for (const input of inputs) {
        created.push(await rooms.create(eventId, input))
      }
      return created
    },

    async update(id: string, patch: RoomPatch): Promise<Room> {
      const store = loadStore()
      const idx = store.rooms.findIndex((r) => r.id === id)
      if (idx < 0) throw new Error('Room not found.')
      const previous = store.rooms[idx]
      const updated: Room = {
        ...previous,
        ...patch,
        interviewers:
          patch.interviewers !== undefined
            ? cleanInterviewerRows(patch.interviewers)
            : previous.interviewers,
      }
      store.rooms[idx] = updated

      // Rule 6: Changing a room's type re-derives the task for everyone in it
      if (updated.room_type !== previous.room_type) {
        const derived = TASK_FOR_ROOM_TYPE[updated.room_type]
        if (derived) {
          store.candidates = store.candidates.map((c) =>
            c.assigned_room === updated.id ? { ...c, current_task_assignment: derived } : c,
          )
        }
      }

      saveStore(store)
      emitRealtime({ kind: 'room', eventId: updated.event_id, event: 'UPDATE', row: updated, previous })
      return updated
    },

    async remove(id: string): Promise<void> {
      const store = loadStore()
      const existing = store.rooms.find((r) => r.id === id)
      store.rooms = store.rooms.filter((r) => r.id !== id)
      // Rule 4: Clear room & task for seated candidates
      store.candidates = store.candidates.map((c) =>
        c.assigned_room === id
          ? { ...c, assigned_room: null, current_task_assignment: null, room_entry_time: null }
          : c,
      )
      saveStore(store)
      if (existing) {
        emitRealtime({
          kind: 'room',
          eventId: existing.event_id,
          event: 'DELETE',
          row: { id },
          previous: existing,
        })
      }
    },
  }

  const evaluations: EvaluationRepository = {
    async listByRoom(eventId: string, roomId: string): Promise<Evaluation[]> {
      const store = loadStore()
      return store.evaluations
        .filter((e) => e.event_id === eventId && e.room_id === roomId)
        .map((e) => {
          const candidate = store.candidates.find((c) => c.id === e.candidate_id)
          return {
            ...e,
            candidate: candidate
              ? { id: candidate.id, name: candidate.name, serial_number: candidate.serial_number }
              : e.candidate,
          }
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 25)
    },

    async upsert(input: NewEvaluation): Promise<void> {
      const store = loadStore()
      const candidate = store.candidates.find((c) => c.id === input.candidate_id)
      if (!candidate) throw new Error(`Evaluation candidate ${input.candidate_id} does not exist.`)

      const idx = store.evaluations.findIndex(
        (e) => e.candidate_id === input.candidate_id && e.task === input.task,
      )
      const record: Evaluation = {
        id: idx >= 0 ? store.evaluations[idx].id : `eval-${Date.now()}`,
        event_id: candidate.event_id,
        candidate_id: input.candidate_id,
        room_id: input.room_id,
        task: input.task,
        interviewer_name: input.interviewer_name,
        scores: input.scores,
        submitted_by: input.submitted_by,
        created_at: new Date().toISOString(),
        candidate: { id: candidate.id, name: candidate.name, serial_number: candidate.serial_number },
      }

      if (idx >= 0) store.evaluations[idx] = record
      else store.evaluations.push(record)

      saveStore(store)
    },
  }

  const ledger: LedgerRepository = {
    async load(eventId: string) {
      const store = loadStore()
      return {
        events: store.candidate_events.filter((ev) => ev.event_id === eventId),
        evaluations: store.evaluations.filter((ev) => ev.event_id === eventId),
      }
    },
  }

  const auth: AuthGateway = {
    async getSession(): Promise<AuthSession | null> {
      const store = loadStore()
      if (!store.sessionEmail) return null
      return { user: { id: 'local-admin', email: store.sessionEmail } }
    },

    onAuthStateChange(listener) {
      authListeners.add(listener)
      return () => {
        authListeners.delete(listener)
      }
    },

    async signInWithPassword(email: string): Promise<void> {
      const store = loadStore()
      const normalized = email.trim() || 'idc.debate@gmail.com'
      if (!store.allowed_admins.some((a) => a.toLowerCase() === normalized.toLowerCase())) {
        store.allowed_admins.push(normalized)
      }
      store.sessionEmail = normalized
      saveStore(store)
      const session: AuthSession = { user: { id: 'local-admin', email: normalized } }
      authListeners.forEach((fn) => fn(session))
    },

    async signInWithOtp(email: string): Promise<void> {
      await auth.signInWithPassword(email, '')
    },

    async signInWithGoogle(): Promise<void> {
      await auth.signInWithPassword('idc.debate@gmail.com', '')
    },

    async signOut(): Promise<void> {
      const store = loadStore()
      store.sessionEmail = null
      saveStore(store)
      authListeners.forEach((fn) => fn(null))
    },

    async listAllowedAdmins(): Promise<string[]> {
      const store = loadStore()
      return store.allowed_admins
    },
  }

  const realtime: RealtimeGateway = {
    subscribeBoard(eventId: string, handlers: BoardRealtimeHandlers) {
      const listener = (msg: RealtimeMessage) => {
        if (msg.eventId !== eventId) return
        if (msg.kind === 'candidate') {
          handlers.onCandidate(msg.event, msg.row, msg.previous)
        } else if (msg.kind === 'room') {
          handlers.onRoom(msg.event, msg.row, msg.previous)
        }
      }
      inTabListeners.add(listener)
      // Trigger SUBSCRIBED asynchronously so useCandidates performs its initial load
      setTimeout(() => handlers.onStatus('SUBSCRIBED'), 0)
      return () => {
        inTabListeners.delete(listener)
      }
    },

    subscribeCandidate(id: string, onChange: () => void) {
      const listener = (msg: RealtimeMessage) => {
        if (msg.kind === 'room' || (msg.kind === 'candidate' && msg.row.id === id)) {
          onChange()
        }
      }
      inTabListeners.add(listener)
      return () => {
        inTabListeners.delete(listener)
      }
    },
  }

  return { events, candidates, rooms, evaluations, ledger, auth, realtime }
}
