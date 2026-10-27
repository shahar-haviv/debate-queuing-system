/**
 * The Supabase implementation of `DatabaseService`.
 *
 * This is the only file in the app that knows a table name and a column list.
 * It receives a *client factory* rather than importing the singleton, so a test
 * can hand it a fake client without touching the browser.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Candidate,
  CandidateAssignment,
  CandidateDedupeRow,
  CandidateEvent,
  Evaluation,
  NewCandidate,
  NewEvaluation,
  NewRoom,
  Room,
  RoomPatch,
} from '../core/types'
import type { RoomType } from '../core/types'
import { createLogger } from '../core/logger'
import { cleanInterviewerRows } from '../domain/conflicts'
import type {
  AuthGateway,
  AuthSession,
  CandidateRepository,
  DatabaseService,
  EvaluationRepository,
  LedgerRepository,
  PublicCandidate,
  PublicRoom,
  RealtimeGateway,
  RoomRepository,
} from './database'

const log = createLogger('db:service')

const PAGE_SIZE = 1000
const MAX_ROWS = 50_000

/** PostgREST's "relation does not exist" - the ledger has not been installed. */
const MISSING_TABLE = 'PGRST205'

/**
 * Turn a Supabase error into a real `Error` that keeps its `code`.
 *
 * The client hands back plain `{ message, code }` objects. Callers use
 * `instanceof Error` to decide whether a message is safe to show, and the
 * analytics screen needs the code to spot a ledger that has not been installed.
 */
function raise(error: { message: string; code?: string }): never {
  throw Object.assign(new Error(error.message), { code: error.code })
}

function toRoom(row: Record<string, unknown>): Room {
  return {
    id: String(row.id),
    room_name: String(row.room_name ?? ''),
    room_type: (row.room_type as RoomType) ?? 'General',
    interviewers: cleanInterviewerRows(row.interviewers),
  }
}

function toCandidate(row: Record<string, unknown>): Candidate {
  return row as unknown as Candidate
}

/**
 * Page through a table. PostgREST silently caps a response at the project's
 * `max-rows` (1,000 by default), so stopping after the first page would quietly
 * under-count. A dashboard that stops counting is worse than one that fails.
 */
async function fetchAll<T>(
  client: SupabaseClient,
  table: string,
  order: string[],
): Promise<T[]> {
  const rows: T[] = []

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    let query = client.from(table).select('*')
    for (const column of order) query = query.order(column, { ascending: true })

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1)
    if (error) raise(error)

    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE_SIZE) break
  }

  return rows
}

export function createSupabaseDatabase(getClient: () => SupabaseClient): DatabaseService {
  const db = (): SupabaseClient => getClient()

  const candidates: CandidateRepository = {
    async list() {
      const { data, error } = await db()
        .from('candidates')
        .select('*')
        .order('created_at', { ascending: true })
      if (error) raise(error)
      return ((data ?? []) as Record<string, unknown>[]).map(toCandidate)
    },

    async listAssignments() {
      const { data, error } = await db()
        .from('candidates')
        .select('id, assigned_room')
        .not('assigned_room', 'is', null)
      if (error) raise(error)
      return (data ?? []) as CandidateAssignment[]
    },

    async listDedupeRows() {
      const { data, error } = await db()
        .from('candidates')
        .select('serial_number, name, planned_time, phone_number')
      if (error) raise(error)
      return (data ?? []) as CandidateDedupeRow[]
    },

    async findById(id) {
      const { data, error } = await db().from('candidates').select('*').eq('id', id).maybeSingle()
      if (error) raise(error)
      return data ? toCandidate(data as Record<string, unknown>) : null
    },

    async findPublicById(id) {
      const { data, error } = await db()
        .from('candidates')
        .select(
          'name, planned_time, arrival_time, assigned_room, current_task_assignment, debate_interview_completed, personal_interview_completed',
        )
        .eq('id', id)
        .maybeSingle()
      if (error) raise(error)
      return (data as PublicCandidate | null) ?? null
    },

    async create(input: NewCandidate) {
      const { data, error } = await db().from('candidates').insert(input).select().single()
      if (error) raise(error)
      return toCandidate(data as Record<string, unknown>)
    },

    async update(id, patch) {
      const { data, error } = await db()
        .from('candidates')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
      if (error) raise(error)
      return toCandidate(data as Record<string, unknown>)
    },

    async remove(id) {
      const { error } = await db().from('candidates').delete().eq('id', id)
      if (error) raise(error)
    },

    async importMany(rows: NewCandidate[]) {
      const { data, error } = await db().from('candidates').insert(rows).select()
      if (error) raise(error)
      return ((data ?? []) as Record<string, unknown>[]).map(toCandidate)
    },
  }

  const rooms: RoomRepository = {
    async list() {
      const { data, error } = await db().from('rooms').select('*').order('room_name', { ascending: true })
      if (error) raise(error)
      return ((data ?? []) as Record<string, unknown>[]).map(toRoom)
    },

    async findById(id) {
      const { data, error } = await db()
        .from('rooms')
        .select('id, room_name, room_type')
        .eq('id', id)
        .maybeSingle()
      if (error) raise(error)
      return (data as PublicRoom | null) ?? null
    },

    async create(input: NewRoom) {
      const { data, error } = await db().from('rooms').insert(input).select().single()
      if (error) raise(error)
      return toRoom(data as Record<string, unknown>)
    },

    async update(id, patch: RoomPatch) {
      const { data, error } = await db().from('rooms').update(patch).eq('id', id).select().single()
      if (error) raise(error)
      return toRoom(data as Record<string, unknown>)
    },

    async remove(id) {
      const { error } = await db().from('rooms').delete().eq('id', id)
      if (error) raise(error)
    },
  }

  const evaluations: EvaluationRepository = {
    async listByRoom(roomId) {
      const { data, error } = await db()
        .from('evaluations')
        .select('id, candidate_id, task, interviewer_name, scores, created_at, candidate:candidates(name, serial_number)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(25)
      if (error) raise(error)
      return (data ?? []) as unknown as Evaluation[]
    },

    async upsert(input: NewEvaluation) {
      const { error } = await db()
        .from('evaluations')
        .upsert(input, { onConflict: 'candidate_id,task' })
      if (error) raise(error)
    },
  }

  const ledger: LedgerRepository = {
    async load() {
      const [events, rubrics] = await Promise.all([
        fetchAll<CandidateEvent>(db(), 'candidate_events', ['at', 'id']),
        fetchAll<Evaluation>(db(), 'evaluations', ['created_at']),
      ])
      log.debug('ledger loaded', { events: events.length, evaluations: rubrics.length })
      return { events, evaluations: rubrics }
    },
  }

  const auth: AuthGateway = {
    async getSession(): Promise<AuthSession | null> {
      const { data, error } = await db().auth.getSession()
      if (error) raise(error)
      const user = data.session?.user
      return user ? { user: { id: user.id, email: user.email ?? null } } : null
    },

    onAuthStateChange(listener) {
      const { data } = db().auth.onAuthStateChange((_event, session) => {
        const user = session?.user
        listener(user ? { user: { id: user.id, email: user.email ?? null } } : null)
      })
      return () => data.subscription.unsubscribe()
    },

    async signInWithPassword(email, password) {
      const { error } = await db().auth.signInWithPassword({ email, password })
      if (error) raise(error)
    },

    async signInWithOtp(email, redirectTo) {
      const { error } = await db().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      })
      if (error) raise(error)
    },

    async signOut() {
      const { error } = await db().auth.signOut()
      if (error) raise(error)
    },

    async listAllowedAdmins() {
      const { data, error } = await db().from('allowed_admins').select('email')
      if (error) raise(error)
      return ((data ?? []) as { email?: string | null }[])
        .map((row) => String(row.email ?? '').trim())
        .filter(Boolean)
    },
  }

  const realtime: RealtimeGateway = {
    subscribeBoard(handlers) {
      const channel = db()
        .channel('queue-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'candidates' },
          (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
            const row = payload.new as unknown as Candidate
            const previous = payload.old as unknown as Partial<Candidate>
            handlers.onCandidate(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row, previous)
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'rooms' },
          (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
            handlers.onRoom(
              payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
              toRoom(payload.new),
              payload.old as unknown as Partial<Room>,
            )
          },
        )
        .subscribe((status: string) => handlers.onStatus(status))

      return () => {
        void db().removeChannel(channel)
      }
    },

    subscribeCandidate(id, onChange) {
      const channel = db()
        .channel(`candidate-${id}`)
        .on(
          'postgres_changes',
          // '*' rather than 'UPDATE' so a candidate deleted by an admin makes
          // the public page fall back to "not found" immediately.
          { event: '*', schema: 'public', table: 'candidates', filter: `id=eq.${id}` },
          () => onChange(),
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => onChange())
        .subscribe()

      return () => {
        void db().removeChannel(channel)
      }
    },
  }

  return { candidates, rooms, evaluations, ledger, auth, realtime }
}

export { MISSING_TABLE }
