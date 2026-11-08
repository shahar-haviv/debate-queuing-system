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
  EventPatch,
  EventSummary,
  NewEvaluation,
  NewEvent,
  QueueEvent,
  Room,
  RoomPatch,
} from '../core/types'
import type { RoomType } from '../core/types'
import { createLogger } from '../core/logger'
import { cleanInterviewerRows } from '../domain/conflicts'
import { normalizeEventForms } from '../domain/formBuilder'
import { readEventFormsFallback, writeEventFormsFallback } from './formStorage'
import type {
  AuthGateway,
  AuthSession,
  CandidateRepository,
  DatabaseService,
  EvaluationRepository,
  EventRepository,
  LedgerRepository,
  PublicCandidate,
  PublicRoom,
  RealtimeGateway,
  RoomRepository,
  RoomWithEvent,
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
    event_id: String(row.event_id ?? ''),
    room_name: String(row.room_name ?? ''),
    room_type: (row.room_type as RoomType) ?? 'General',
    interviewers: cleanInterviewerRows(row.interviewers),
  }
}

function toEvent(row: Record<string, unknown>): QueueEvent {
  const id = String(row.id)
  const forms = normalizeEventForms(row.forms) ?? readEventFormsFallback(id)
  return {
    id,
    name: String(row.name ?? ''),
    date: String(row.date ?? ''),
    status: row.status === 'Active' || row.status === 'Completed' ? row.status : 'Draft',
    notes: String(row.notes ?? ''),
    created_at: String(row.created_at ?? ''),
    ...(forms ? { forms } : {}),
  }
}

/** PostgREST returns `[{ count: n }]` for an embedded aggregate. */
function embeddedCount(value: unknown): number {
  if (Array.isArray(value)) {
    const first = value[0] as { count?: unknown } | undefined
    return Number(first?.count ?? 0)
  }
  if (value && typeof value === 'object') return Number((value as { count?: unknown }).count ?? 0)
  return 0
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
  eventId?: string,
): Promise<T[]> {
  const rows: T[] = []

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    let query = client.from(table).select('*')
    if (eventId) query = query.eq('event_id', eventId)
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

  const events: EventRepository = {
    async listSummaries() {
      const { data, error } = await db()
        .from('events')
        .select('*, candidates(count), rooms(count)')
        .order('date', { ascending: true })
        .order('created_at', { ascending: true })
      if (error) raise(error)

      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        ...toEvent(row),
        candidate_count: embeddedCount(row.candidates),
        room_count: embeddedCount(row.rooms),
      })) satisfies EventSummary[]
    },

    async findById(id) {
      const { data, error } = await db().from('events').select('*').eq('id', id).maybeSingle()
      if (error) raise(error)
      return data ? toEvent(data as Record<string, unknown>) : null
    },

    async create(input: NewEvent) {
      const { forms, ...rest } = input
      const payload = forms ? { ...rest, forms } : rest
      const { data, error } = await db().from('events').insert(payload).select().single()
      if (error && forms) {
        // Fallback when the remote database has not had `events.forms` pushed yet.
        const retry = await db().from('events').insert(rest).select().single()
        if (retry.error) raise(retry.error)
        const created = toEvent(retry.data as Record<string, unknown>)
        writeEventFormsFallback(created.id, forms)
        return { ...created, forms }
      }
      if (error) raise(error)
      const created = toEvent(data as Record<string, unknown>)
      if (forms) writeEventFormsFallback(created.id, forms)
      return forms ? { ...created, forms } : created
    },

    async update(id, patch: EventPatch) {
      const { forms, ...rest } = patch
      if (forms !== undefined) writeEventFormsFallback(id, forms)
      const payload = forms !== undefined ? { ...rest, forms } : rest
      const { data, error } = await db().from('events').update(payload).eq('id', id).select().single()
      if (error && forms !== undefined) {
        if (Object.keys(rest).length === 0) {
          const existing = await events.findById(id)
          if (!existing) raise(error)
          return { ...existing, forms }
        }
        const retry = await db().from('events').update(rest).eq('id', id).select().single()
        if (retry.error) raise(retry.error)
        return { ...toEvent(retry.data as Record<string, unknown>), forms }
      }
      if (error) raise(error)
      return toEvent(data as Record<string, unknown>)
    },

    async remove(id) {
      const { error } = await db().from('events').delete().eq('id', id)
      if (error) raise(error)
    },
  }

  const candidates: CandidateRepository = {
    async list(eventId) {
      const { data, error } = await db()
        .from('candidates')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true })
      if (error) raise(error)
      return ((data ?? []) as Record<string, unknown>[]).map(toCandidate)
    },

    async listAssignments(eventId) {
      const { data, error } = await db()
        .from('candidates')
        .select('id, assigned_room')
        .eq('event_id', eventId)
        .not('assigned_room', 'is', null)
      if (error) raise(error)
      return (data ?? []) as CandidateAssignment[]
    },

    async listDedupeRows(eventId) {
      const { data, error } = await db()
        .from('candidates')
        .select('serial_number, name, planned_time, phone_number')
        .eq('event_id', eventId)
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

    async create(eventId, input) {
      const { data, error } = await db()
        .from('candidates')
        .insert({ ...input, event_id: eventId })
        .select()
        .single()
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

    async importMany(eventId, rows) {
      if (!rows.length) return []
      const { data, error } = await db()
        .from('candidates')
        .insert(rows.map((row) => ({ ...row, event_id: eventId })))
        .select()
      if (error) raise(error)
      return ((data ?? []) as Record<string, unknown>[]).map(toCandidate)
    },
  }

  const rooms: RoomRepository = {
    async list(eventId) {
      const { data, error } = await db()
        .from('rooms')
        .select('*')
        .eq('event_id', eventId)
        .order('room_name', { ascending: true })
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

    async findByIdWithEvent(id) {
      const { data, error } = await db()
        .from('rooms')
        .select('id, room_name, room_type, event_id')
        .eq('id', id)
        .maybeSingle()
      if (error) raise(error)
      return (data as RoomWithEvent | null) ?? null
    },

    async create(eventId, input) {
      const { data, error } = await db()
        .from('rooms')
        .insert({ ...input, event_id: eventId })
        .select()
        .single()
      if (error) raise(error)
      return toRoom(data as Record<string, unknown>)
    },

    async createMany(eventId, inputs) {
      if (!inputs.length) return []
      const { data, error } = await db()
        .from('rooms')
        .insert(inputs.map((input) => ({ ...input, event_id: eventId })))
        .select()
      if (error) raise(error)
      return ((data ?? []) as Record<string, unknown>[]).map(toRoom)
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
    async listByRoom(eventId, roomId) {
      const { data, error } = await db()
        .from('evaluations')
        .select(
          'id, event_id, candidate_id, task, interviewer_name, scores, created_at, candidate:candidates(name, serial_number)',
        )
        .eq('event_id', eventId)
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
    async load(eventId) {
      const [events, rubrics] = await Promise.all([
        fetchAll<CandidateEvent>(db(), 'candidate_events', ['at', 'id'], eventId),
        fetchAll<Evaluation>(db(), 'evaluations', ['created_at'], eventId),
      ])
      log.debug('ledger loaded', { eventId, events: events.length, evaluations: rubrics.length })
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

    async signInWithGoogle(redirectTo) {
      const target =
        redirectTo ??
        (typeof window !== 'undefined' ? `${window.location.origin}/admin` : undefined)
      const { error } = await db().auth.signInWithOAuth({
        provider: 'google',
        options: target ? { redirectTo: target } : undefined,
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
    subscribeBoard(eventId, handlers) {
      const channel = db()
        .channel(`queue-live-${eventId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'candidates',
            filter: `event_id=eq.${eventId}`,
          },
          (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
            const row = payload.new as unknown as Candidate
            const previous = payload.old as unknown as Partial<Candidate>
            handlers.onCandidate(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row, previous)
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'rooms',
            filter: `event_id=eq.${eventId}`,
          },
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

  return { events, candidates, rooms, evaluations, ledger, auth, realtime }
}

export { MISSING_TABLE }
