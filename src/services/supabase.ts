/**
 * The Supabase client - created once, from validated environment configuration.
 *
 * Nothing in this module knows about React. UI code never imports it: it asks
 * for a `DatabaseService` (see `database.ts`), which is what makes the database
 * swappable in a test.
 *
 * The write goes through a transparent logging proxy. Every query reports
 * itself, including the Postgres error code, so a failed dispatch can be
 * diagnosed from the debug panel without a network trace.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getEnv } from '../core/env'
import { createLogger } from '../core/logger'

const dbLog = createLogger('db')

const TRACKED_METHODS = new Set([
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'contains', 'containedBy', 'overlaps', 'textSearch', 'match', 'filter', 'not', 'or',
  'order', 'limit', 'range', 'single', 'maybeSingle', 'count', 'csv',
])

function short(value: unknown, max = 42): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}...` : value
  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value)
      return json.length > max ? `${json.slice(0, max)}...` : json
    } catch {
      return '[object]'
    }
  }
  return String(value)
}

function describeStep(name: string, args: unknown[]): string {
  switch (name) {
    case 'select':
      return args[0] ? `select(${short(args[0])})` : 'select(*)'
    case 'order':
      return `order(${short(args[0])}${(args[1] as { ascending?: boolean } | undefined)?.ascending === false ? ' desc' : ''})`
    case 'limit':
    case 'count':
    case 'textSearch':
    case 'csv':
      return `${name}(${short(args[0])})`
    case 'range':
      return `range(${short(args[0])},${short(args[1])})`
    case 'single':
    case 'maybeSingle':
      return name
    case 'not':
      return `not(${short(args[0])})`
    case 'or':
      return `or(${short(args[0])})`
    case 'match':
    case 'filter':
      return `${name}(${short(args[0])},${short(args[1])})`
    case 'insert':
    case 'update':
    case 'upsert':
      return args[0] ? `${name}(${short(args[0])})` : name
    case 'delete':
      return 'delete'
    default:
      return `${name}(${args.map((arg) => short(arg)).join(', ')})`
  }
}

function countRows(data: unknown): number {
  if (Array.isArray(data)) return data.length
  if (data === null || data === undefined) return 0
  return 1
}

type AnyRecord = Record<string, unknown>

function instrumentBuilder(builder: AnyRecord, table: string, initialSteps: string[] = []): AnyRecord {
  const steps = initialSteps
  let proxy: AnyRecord

  const label = (): string => (steps.length ? `${table} - ${steps.join(' -> ')}` : table)

  proxy = new Proxy(builder, {
    get(target, prop) {
      // Awaiting the builder is what actually executes the query.
      if (prop === 'then') {
        const then = target.then as
          | ((onFulfilled?: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) => unknown)
          | undefined
        return (onFulfilled?: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) => {
          const started = performance.now()
          const queryLabel = label()
          dbLog.debug(`-> ${queryLabel}`)

          return then?.call(
            target,
            (result: unknown) => {
              const ms = Math.round(performance.now() - started)
              const envelope = result as { error?: { code?: string; message?: string; details?: string; hint?: string }; data?: unknown }
              if (envelope?.error) {
                dbLog.error(`x ${queryLabel} - ${envelope.error.code ?? 'error'}: ${envelope.error.message} (${ms}ms)`, {
                  code: envelope.error.code,
                  details: envelope.error.details,
                  hint: envelope.error.hint,
                })
              } else {
                const rows = countRows(envelope?.data)
                dbLog.debug(`ok ${queryLabel} (${ms}ms, ${rows} row${rows === 1 ? '' : 's'})`)
              }
              return onFulfilled ? onFulfilled(result) : result
            },
            (thrown: unknown) => {
              const ms = Math.round(performance.now() - started)
              dbLog.error(`x ${queryLabel} threw after ${ms}ms`, { error: thrown })
              if (onRejected) return onRejected(thrown)
              throw thrown
            },
          )
        }
      }

      if (typeof prop !== 'string') return Reflect.get(target, prop)

      const value = Reflect.get(target, prop)
      if (typeof value !== 'function') return value

      return (...args: unknown[]) => {
        if (TRACKED_METHODS.has(prop)) steps.push(describeStep(prop, args))
        const out = (value as (...params: unknown[]) => unknown).apply(target, args) as AnyRecord

        // Query methods return a *new* builder; re-wrap it so the rest of the
        // chain stays inside the proxy. Filter methods return `this`.
        if (out === target) return proxy
        if (out && typeof out === 'object' && typeof (out as AnyRecord).then === 'function') {
          return instrumentBuilder(out, table, steps.slice())
        }
        return out
      }
    },
  })

  return proxy
}

/** Wrap a client so every `.from()` query is logged. Returns the same contract. */
export function withQueryLogging(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'from') {
        return (table: string) => instrumentBuilder(target.from(table) as unknown as AnyRecord, table)
      }

      if (prop === 'rpc') {
        return (fn: string, params?: Record<string, unknown>) => {
          const started = performance.now()
          dbLog.debug(`-> rpc ${fn}`, params)
          return target.rpc(fn, params).then((result) => {
            const ms = Math.round(performance.now() - started)
            if (result?.error) dbLog.error(`x rpc ${fn} - ${result.error.message} (${ms}ms)`)
            else dbLog.debug(`ok rpc ${fn} (${ms}ms)`)
            return result
          })
        }
      }

      const value = Reflect.get(target, prop)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as SupabaseClient
}

/** Build a new client from the validated environment. */
export function createSupabaseClient(): SupabaseClient {
  const env = getEnv()
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Required for the magic-link flow: parses the session out of the URL
      // when Supabase redirects the user back to /admin.
      detectSessionInUrl: true,
    },
    realtime: { params: { eventsPerSecond: 10 } },
  })

  dbLog.info('client created', { url: env.VITE_SUPABASE_URL })
  return withQueryLogging(client)
}

let singleton: SupabaseClient | null = null

/** The shared client. Created lazily so a missing .env fails with a clear error. */
export function getSupabaseClient(): SupabaseClient {
  if (!singleton) singleton = createSupabaseClient()
  return singleton
}

/** Test seam: forget the shared client. */
export function resetSupabaseClient(): void {
  singleton = null
}
