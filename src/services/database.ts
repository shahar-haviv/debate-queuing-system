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
  NewCandidate,
  NewEvaluation,
  NewRoom,
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

export interface RealtimeGateway {
  /** Subscribe to candidates + rooms on one channel; returns an unsubscribe. */
  subscribeBoard: (handlers: BoardRealtimeHandlers) => () => void
  /** The public status page: its own candidate, plus any room change. */
  subscribeCandidate: (id: string, onChange: () => void) => () => void
}

/* ------------------------------ repositories ------------------------------ */

export interface CandidateRepository {
  list: () => Promise<Candidate[]>
  /** Only `id` + `assigned_room`, for the load-balancing query. */
  listAssignments: () => Promise<CandidateAssignment[]>
  /** Only the duplicate-detection columns used by CSV import. */
  listDedupeRows: () => Promise<CandidateDedupeRow[]>
  findById: (id: string) => Promise<Candidate | null>
  /** The public screen's projection: no phone number, no serial number. */
  findPublicById: (id: string) => Promise<PublicCandidate | null>
  create: (input: NewCandidate) => Promise<Candidate>
  update: (id: string, patch: CandidatePatch) => Promise<Candidate>
  remove: (id: string) => Promise<void>
  importMany: (rows: NewCandidate[]) => Promise<Candidate[]>
}

export interface RoomRepository {
  list: () => Promise<Room[]>
  findById: (id: string) => Promise<PublicRoom | null>
  create: (input: NewRoom) => Promise<Room>
  update: (id: string, patch: RoomPatch) => Promise<Room>
  remove: (id: string) => Promise<void>
}

export interface EvaluationRepository {
  listByRoom: (roomId: string) => Promise<Evaluation[]>
  /** One rubric per candidate + task; a second submission edits the first. */
  upsert: (input: NewEvaluation) => Promise<void>
}

/** The append-only movement ledger plus the rubrics used for attribution. */
export interface LedgerRepository {
  load: () => Promise<{ events: CandidateEvent[]; evaluations: Evaluation[] }>
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
  candidates: CandidateRepository
  rooms: RoomRepository
  evaluations: EvaluationRepository
  ledger: LedgerRepository
  auth: AuthGateway
  realtime: RealtimeGateway
}

/** Re-exported for convenience where a loader returns a computed summary. */
export type { AnalyticsSummary }
