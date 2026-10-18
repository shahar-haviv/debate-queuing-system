import { createClient } from '@supabase/supabase-js'
import { createLogger } from './logger.js'

/* ------------------------------------------------------------------------- *
 *  Supabase configuration.
 *
 *  Values are read from `.env` first, and fall back to the defaults below so
 *  the deployed build keeps working even when no .env file is present.
 *
 *  These values are PUBLIC by design — they ship to the browser either way.
 *  Access control comes from Row Level Security in Postgres, never from
 *  hiding this key.
 * ------------------------------------------------------------------------- */
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://zhfrferzepxshdryuazq.supabase.co'

export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'sb_publishable_ADr-tD5eJy2c79wYZgxkGw_L5E4uwz_'

/** Guards against a blank/typo'd constant producing a blank white screen. */
export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)

/* ------------------------------------------------------------------------- *
 *  Logging middleware
 *
 *  Wraps the client so every database call reports itself:
 *
 *    12:03:50.989 DEBUG db:candidates  → select(*) → eq(id, 4f2) → single
 *    12:03:51.041 DEBUG db:candidates  ✓ select(*) → eq(id, 4f2) → single (52ms, 1 row)
 *
 *  Failures are logged at error level with the Postgres error code, details
 *  and hint, which is usually enough to identify the problem without a
 *  browser devtools network trace.
 *
 *  The wrapper is transparent: queries are proxied, not re-implemented, so
 *  every method, every chain and every return value behaves exactly as it
 *  would without it.
 * ------------------------------------------------------------------------- */
const dbLog = createLogger('db')

const TRACKED_METHODS = new Set([
  'select', 'insert', 'update', 'upsert', 'delete',
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
  'contains', 'containedBy', 'overlaps', 'textSearch', 'match', 'filter', 'not', 'or',
  'order', 'limit', 'range', 'single', 'maybeSingle', 'count', 'csv',
])

function short(value, max = 42) {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}…` : value
  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value)
      return json.length > max ? `${json.slice(0, max)}…` : json
    } catch {
      return '[object]'
    }
  }
  return String(value)
}

function describeStep(name, args) {
  switch (name) {
    case 'select':
      return args[0] ? `select(${short(args[0])})` : 'select(*)'
    case 'order':
      return `order(${short(args[0])}${args[1]?.ascending === false ? ' desc' : ''})`
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

function countRows(data) {
  if (Array.isArray(data)) return data.length
  if (data === null || data === undefined) return 0
  return 1
}

function instrumentBuilder(builder, table, initialSteps = []) {
  const steps = initialSteps
  let proxy

  const label = () => (steps.length ? `${table} · ${steps.join(' → ')}` : table)

  proxy = new Proxy(builder, {
    get(target, prop, receiver) {
      // Awaiting the builder is what actually executes the query.
      if (prop === 'then') {
        return (onFulfilled, onRejected) => {
          const started = performance.now()
          const queryLabel = label()
          dbLog.debug(`→ ${queryLabel}`)

          return target.then(
            (result) => {
              const ms = Math.round(performance.now() - started)
              if (result?.error) {
                dbLog.error(`✗ ${queryLabel} — ${result.error.code ?? 'error'}: ${result.error.message} (${ms}ms)`, {
                  code: result.error.code,
                  details: result.error.details,
                  hint: result.error.hint,
                })
              } else {
                const rows = countRows(result?.data)
                dbLog.debug(`✓ ${queryLabel} (${ms}ms, ${rows} row${rows === 1 ? '' : 's'})`)
              }
              return onFulfilled ? onFulfilled(result) : result
            },
            (thrown) => {
              const ms = Math.round(performance.now() - started)
              dbLog.error(`✗ ${queryLabel} threw after ${ms}ms`, { error: thrown })
              if (onRejected) return onRejected(thrown)
              throw thrown
            },
          )
        }
      }

      if (typeof prop !== 'string') return Reflect.get(target, prop)

      const value = Reflect.get(target, prop)
      if (typeof value !== 'function') return value

      return (...args) => {
        if (TRACKED_METHODS.has(prop)) steps.push(describeStep(prop, args))
        const out = value.apply(target, args)

        // Filter/transform methods return `this`, but the query methods
        // (select / insert / update / delete / upsert) return a *brand new*
        // builder. Re-wrap that one, carrying the steps recorded so far, or the
        // rest of the chain escapes the proxy and nothing gets logged.
        if (out === target) return proxy
        if (out && typeof out === 'object' && typeof out.then === 'function') {
          return instrumentBuilder(out, table, steps.slice())
        }
        return out
      }
    },
  })

  return proxy
}

function withLoggingMiddleware(client) {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table) => instrumentBuilder(target.from(table), table)
      }

      if (prop === 'rpc') {
        return (fn, params) => {
          const started = performance.now()
          dbLog.debug(`→ rpc ${fn}`, params)
          return target.rpc(fn, params).then((result) => {
            const ms = Math.round(performance.now() - started)
            if (result?.error) dbLog.error(`✗ rpc ${fn} — ${result.error.message} (${ms}ms)`)
            else dbLog.debug(`✓ rpc ${fn} (${ms}ms)`)
            return result
          })
        }
      }

      const value = Reflect.get(target, prop)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

function createSupabaseClient() {
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Required for the magic-link flow: parses the session out of the URL
      // when Supabase redirects the user back to /admin.
      detectSessionInUrl: true,
    },
    realtime: { params: { eventsPerSecond: 10 } },
  })

  dbLog.info('client created', { url: SUPABASE_URL })
  return withLoggingMiddleware(client)
}

export const supabase = isConfigured ? createSupabaseClient() : null
