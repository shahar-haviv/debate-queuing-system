/**
 * The application's data contracts.
 *
 * These types mirror the Postgres schema in `supabase/schema.sql`. They are
 * intentionally **granular** (Interface Segregation): a card that only renders a
 * name and a planned time takes `CandidateQueueItem`, not the full row, so a
 * component cannot start depending on a column it has no business reading.
 */

/* ------------------------------- primitives ------------------------------ */

/** The `public.room_type` enum. */
export type RoomType = 'Debate' | 'Personal' | 'General'

/** The `public.task_assignment` enum. */
export type TaskAssignment = 'Debate Interview' | 'Personal Interview'

/** A movement in the append-only ledger. */
export type EventKind = 'arrived' | 'unarrived' | 'assigned' | 'released' | 'completed'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

export type ToastTone = 'info' | 'success' | 'error'

/** A 1–5 rubric answer, a free-text answer, or a deliberate blank. */
export type ScoreValue = string | number | null
export type Scores = Record<string, ScoreValue>

/* --------------------------------- rooms --------------------------------- */

export interface Interviewer {
  name: string
  phone: string | null
}

export interface Room {
  id: string
  room_name: string
  room_type: RoomType
  interviewers: Interviewer[]
}

/** What the room editor sends on create. */
export interface NewRoom {
  room_name: string
  room_type: RoomType
  interviewers: Interviewer[]
}

export type RoomPatch = Partial<NewRoom>

/* ------------------------------- candidates ------------------------------ */

export interface Candidate {
  id: string
  serial_number: string | null
  name: string
  phone_number: string | null
  /** `HH:MM`, as typed or imported. */
  planned_time: string | null
  arrival_time: string | null
  has_arrived: boolean
  debate_interview_completed: boolean
  personal_interview_completed: boolean
  /** Interviewers this candidate must not meet. */
  interviewer_constraints: string[]
  assigned_room: string | null
  /** When the current room stay began. Owned by database Rule 5. */
  room_entry_time: string | null
  current_task_assignment: TaskAssignment | null
  created_at: string
}

/** The fields a dispatcher or modal may write. `id` and audit stamps are not. */
export type CandidatePatch = Partial<
  Pick<
    Candidate,
    | 'serial_number'
    | 'name'
    | 'phone_number'
    | 'planned_time'
    | 'arrival_time'
    | 'has_arrived'
    | 'debate_interview_completed'
    | 'personal_interview_completed'
    | 'interviewer_constraints'
    | 'assigned_room'
    | 'room_entry_time'
    | 'current_task_assignment'
  >
>

/** What an import or the "add candidate" modal supplies. */
export interface NewCandidate {
  name: string
  serial_number: string | null
  phone_number: string | null
  planned_time: string | null
  has_arrived: boolean
  debate_interview_completed: boolean
  personal_interview_completed: boolean
  assigned_room: string | null
  current_task_assignment: TaskAssignment | null
}

/** Only the identity. A heading or an avatar needs no more than this. */
export type CandidateIdentity = Pick<Candidate, 'id' | 'name'>

/** Exactly what the queue algorithms read. */
export type CandidateQueueItem = Pick<
  Candidate,
  | 'id'
  | 'name'
  | 'arrival_time'
  | 'has_arrived'
  | 'assigned_room'
  | 'debate_interview_completed'
  | 'personal_interview_completed'
  | 'current_task_assignment'
  | 'room_entry_time'
>

/** The load-balancing query's projection. */
export type CandidateAssignment = Pick<Candidate, 'id' | 'assigned_room'>

/** The duplicate-detection projection used by CSV import. */
export type CandidateDedupeRow = Pick<
  Candidate,
  'serial_number' | 'name' | 'planned_time' | 'phone_number'
>

/* ------------------------------- evaluations ----------------------------- */

export interface Evaluation {
  id: string
  candidate_id: string
  room_id: string | null
  task: TaskAssignment | null
  interviewer_name: string | null
  scores: Scores
  submitted_by: string | null
  created_at: string
  /** Joined for display, not stored on the row. */
  candidate?: CandidateIdentity & { serial_number?: string | null }
}

export interface NewEvaluation {
  candidate_id: string
  room_id: string | null
  task: TaskAssignment
  interviewer_name: string | null
  scores: Scores
  submitted_by: string | null
}

/* --------------------------------- ledger -------------------------------- */

export interface CandidateEvent {
  id: number | string
  candidate_id: string | null
  candidate_name: string | null
  at: string
  event: EventKind
  room_id: string | null
  room_name: string | null
  task: TaskAssignment | null
  interviewer: string | null
  by_email: string | null
  detail: Record<string, unknown>
}

/* -------------------------------- the form ------------------------------- */

export type QuestionType = 'text' | 'textarea' | 'number' | 'scale'
export type ScoreKey = 'rating_availability' | 'rating_vibe' | 'rating_competitiveness'

export interface ScaleLabels {
  1?: string
  5?: string
}

export interface FormQuestion {
  key: string
  label: string
  type: QuestionType
  required: boolean
  prefill?: 'interviewer' | 'name' | 'serial'
  hint?: string
  scaleLabels?: ScaleLabels
}

export interface FormSection {
  id: string
  part: string
  heading: string | null
  intro: string | null
  questions: FormQuestion[]
}

export type RubricForm = FormSection[]

/** Controlled inputs are strings; numbers are parsed at the boundary. */
export type Answers = Record<string, string>
export type ValidationProblems = Record<string, string | undefined>

export interface ValidationProblem {
  key: string
  label: string
  message: string
}

export interface RecapRow {
  key: string
  label: string
  answer: string
  blank: boolean
  type: QuestionType
}

export interface RecapSection {
  id: string
  part: string
  heading: string | null
  intro: string | null
  rows: RecapRow[]
}

/* ------------------------------- analytics ------------------------------- */

export interface InterviewerStat {
  interviewer: string
  digital: number
  manual: number
  total: number
  averageScore: number | null
}

export interface RoomStat {
  roomName: string
  sessions: number
  candidates: number
  averageMinutes: number | null
  minMinutes: number | null
  maxMinutes: number | null
}

export interface RoomSession {
  key: string
  candidateId: string | null
  candidateName: string | null
  roomId: string | null
  roomName: string
  task: TaskAssignment | null
  startedAt: string
  endedAt: string
  minutes: number
  completed: boolean
}

export interface RecentEvent {
  id: number | string
  at: string
  event: EventKind
  candidateName: string
  roomName: string
  task: string
  interviewer: string
}

export interface AnalyticsTotals {
  processed: number
  sessions: number
  averageRoomMinutes: number | null
  averageWaitMinutes: number | null
  waitedCandidates: number
  busiestRoom: { roomName: string; sessions: number; candidates: number } | null
  events: number
  evaluations: number
}

export interface AnalyticsSummary {
  sessions: RoomSession[]
  rooms: RoomStat[]
  waits: number[]
  recent: RecentEvent[]
  leaderboard: InterviewerStat[]
  totals: AnalyticsTotals
}

/* --------------------------------- misc ---------------------------------- */

export interface ToastMessage {
  message: string
  tone: ToastTone
  id: number
}
