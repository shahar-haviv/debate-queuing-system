/**
 * The persistence contract.
 *
 * Everything above this file (hooks, components, pages) depends on these
 * interfaces, never on Supabase. That is Dependency Inversion in practice: the
 * Supabase implementation lives in `supabaseDatabase.ts`, and a test or a future
 * Firebase adapter only has to satisfy the same shape.
 *
 * Interfaces are split by aggregate (Interface Segregation): a component that
 * only reads the queue takes `CandidateRepository`, not the whole database.
 */
import type {
  AnalyticsSummary,
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
} from '../core/types'

/* ------------------------------- realtime -------------------------------- */

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE'

export interface BoardRealtimeHandlers {
  onCandidate: (
    event: RealtimeEvent,
    row: Partial<Candidate> & { id?: string },
    previous?: Partial<Candidate>,
  ) => void
  onRoom: (event: RealtimeEvent, row: Partial<Room> & { id?: string }, previous?: Partial<Room>) => void
  onStatus: (status: string) => void
}

/** The candidate-facing page's projection. Deliberately omits phone + serial. */
export interface PublicCandidate {
  name: string
  planned_time: string | null
  arrival_time: string | null
  assigned_room: string | null
  current_task_assignment: Candidate['current_task_assignment']
  debate_interview_completed: boolean
  personal_interview_completed: boolean
}

export interface PublicRoom {
  id: string
  room_name: string
  room_type: Room['room_type']
}

/** The room id -> event lookup the staff room page needs before it can load a board. */
export interface RoomWithEvent extends PublicRoom {
  event_id: string
}

export interface RealtimeGateway {
  /** Subscribe to one event's candidates + rooms; returns an unsubscribe. */
  subscribeBoard: (eventId: string, handlers: BoardRealtimeHandlers) => () => void
  /** The public status page: its own candidate, plus any room change. */
  subscribeCandidate: (id: string, onChange: () => void) => () => void
}

/* ------------------------------ repositories ------------------------------ */

export interface EventRepository {
  listSummaries: () => Promise<EventSummary[]>
  findById: (id: string) => Promise<QueueEvent | null>
  create: (input: NewEvent) => Promise<QueueEvent>
  update: (id: string, patch: EventPatch) => Promise<QueueEvent>
  /** Used only to roll back a half-created planner draft. */
  remove: (id: string) => Promise<void>
}

export interface CandidateRepository {
  list: (eventId: string) => Promise<Candidate[]>
  /** Only `id` + `assigned_room`, for the load-balancing query. */
  listAssignments: (eventId: string) => Promise<CandidateAssignment[]>
  /** Only the duplicate-detection columns used by CSV import. */
  listDedupeRows: (eventId: string) => Promise<CandidateDedupeRow[]>
  findById: (id: string) => Promise<Candidate | null>
  /** The public screen's projection: no phone number, no serial number. */
  findPublicById: (id: string) => Promise<PublicCandidate | null>
  create: (eventId: string, input: NewCandidate) => Promise<Candidate>
  update: (id: string, patch: CandidatePatch) => Promise<Candidate>
  remove: (id: string) => Promise<void>
  importMany: (eventId: string, rows: NewCandidate[]) => Promise<Candidate[]>
}

export interface RoomRepository {
  list: (eventId: string) => Promise<Room[]>
  findById: (id: string) => Promise<PublicRoom | null>
  /** Resolves which event a staff room link belongs to. */
  findByIdWithEvent: (id: string) => Promise<RoomWithEvent | null>
  create: (eventId: string, input: NewRoom) => Promise<Room>
  createMany: (eventId: string, inputs: NewRoom[]) => Promise<Room[]>
  update: (id: string, patch: RoomPatch) => Promise<Room>
  remove: (id: string) => Promise<void>
}

export interface EvaluationRepository {
  listByRoom: (eventId: string, roomId: string) => Promise<Evaluation[]>
  /** One rubric per candidate + task; a second submission edits the first. */
  upsert: (input: NewEvaluation) => Promise<void>
}

/** The append-only movement ledger plus the rubrics used for attribution. */
export interface LedgerRepository {
  load: (eventId: string) => Promise<{ events: CandidateEvent[]; evaluations: Evaluation[] }>
}

/* --------------------------------- auth ---------------------------------- */

export interface AdminUser {
  id: string
  email: string | null
}

export interface AuthSession {
  user: AdminUser
}

export interface AuthGateway {
  getSession: () => Promise<AuthSession | null>
  onAuthStateChange: (listener: (session: AuthSession | null) => void) => () => void
  signInWithPassword: (email: string, password: string) => Promise<void>
  signInWithOtp: (email: string, redirectTo: string) => Promise<void>
  signOut: () => Promise<void>
  /** Emails on the allowed_admins list visible to the signed-in user. */
  listAllowedAdmins: () => Promise<string[]>
}

/* ------------------------------- container -------------------------------- */

export interface DatabaseService {
  events: EventRepository
  candidates: CandidateRepository
  rooms: RoomRepository
  evaluations: EvaluationRepository
  ledger: LedgerRepository
  auth: AuthGateway
  realtime: RealtimeGateway
}

/** Re-exported for convenience where a loader returns a computed summary. */
export type { AnalyticsSummary }
