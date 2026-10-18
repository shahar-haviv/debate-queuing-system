/**
 * A tiny, dependency-free logger with a shared in-memory ring buffer.
 *
 * Two things are produced for every call:
 *   1. a styled console line (only when the entry is at/above the console level)
 *   2. a structured record in a 500-entry ring buffer that the on-screen
 *      Debug Panel subscribes to
 *
 * Levels: debug < info < warn < error < silent
 *
 * Control at runtime, no rebuild required:
 *   • add `?log=debug` (or info/warn/error/silent) to the URL
 *   • `localStorage.setItem('cq:logLevel', 'debug')`
 *   • `cq.log.setLevel('debug')` from the browser console
 *
 * The logger never throws — a broken log call must not take the app down.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }
export const LEVEL_ORDER = ['debug', 'info', 'warn', 'error', 'silent']

const CONSOLE_STYLE = {
  debug: 'color:#8a9a94',
  info: 'color:#1f6b4f;font-weight:600',
  warn: 'color:#b26a00;font-weight:600',
  error: 'color:#c0392b;font-weight:700',
}

const LEVEL_TAG = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' }

/**
 * Which console method each level uses. Debug is routed to `console.log`
 * rather than `console.debug` on purpose: Chrome and Firefox hide `debug`
 * behind the "Verbose" filter, which would make the query trace invisible
 * exactly when someone is trying to debug something.
 */
const CONSOLE_METHOD = { debug: 'log', info: 'info', warn: 'warn', error: 'error' }

const MAX_ENTRIES = 500
const STORAGE_KEY = 'cq:logLevel'

/** Everything ever logged, newest last. Drives the Debug Panel. */
const buffer = []
const sinks = new Set()
let sequence = 0

/* ------------------------------------------------------------------ levels */

function isLevel(value) {
  return typeof value === 'string' && LEVEL_ORDER.includes(value)
}

function readInitialLevel() {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('log')
    if (isLevel(fromQuery)) {
      window.localStorage.setItem(STORAGE_KEY, fromQuery)
      return fromQuery
    }
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isLevel(stored)) return stored
  } catch {
    /* private mode / storage disabled / not a browser */
  }
  try {
    // `import.meta.env` only exists under Vite; optional chaining keeps this
    // module importable from plain Node too.
    return import.meta.env?.DEV ? 'debug' : 'info'
  } catch {
    return 'info'
  }
}

let consoleLevel = readInitialLevel()

/* ------------------------------------------------------------- formatting */

function pad(value, width) {
  const text = String(value)
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

export function formatClock(date) {
  const d = date instanceof Date ? date : new Date(date)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

/** Turns anything into something safe to render / JSON.stringify. */
export function toPlain(value, depth = 0) {
  try {
    if (value === null || value === undefined) return value
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
    if (value instanceof Error) {
      return { name: value.name, message: value.message, code: value.code, stack: value.stack?.split('\n').slice(0, 4).join('\n') }
    }
    if (Array.isArray(value)) {
      if (depth > 2) return `[Array(${value.length})]`
      return value.slice(0, 25).map((item) => toPlain(item, depth + 1))
    }
    if (typeof value === 'object') {
      if (depth > 2) return '[Object]'
      const out = {}
      for (const [key, item] of Object.entries(value)) out[key] = toPlain(item, depth + 1)
      return out
    }
    return String(value)
  } catch {
    return '[unserialisable]'
  }
}

/* ----------------------------------------------------------------- writing */

function record(level, scope, message, details) {
  const entry = {
    id: ++sequence,
    time: new Date(),
    level,
    scope,
    message,
    details: details === undefined ? undefined : toPlain(details),
  }
  buffer.push(entry)
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
  for (const sink of sinks) {
    try {
      sink(entry)
    } catch {
      /* a bad subscriber must not break logging */
    }
  }
  return entry
}

function write(level, scope, message, details) {
  const entry = record(level, scope, message, details)
  if (LEVELS[level] < LEVELS[consoleLevel]) return entry
  try {
    const prefix = `%c${formatClock(entry.time)} %c${LEVEL_TAG[level]}%c ${pad(scope, 12)}`
    const args = [prefix, 'color:#9aa8a3', CONSOLE_STYLE[level], 'color:inherit', message]
    if (entry.details !== undefined) args.push(entry.details)
    const method = CONSOLE_METHOD[level] ?? 'log'
    ;(console[method] ?? console.log)(...args)
  } catch {
    /* console may be unavailable */
  }
  return entry
}

/* ------------------------------------------------------------ public API */

/**
 * Create a scoped logger.
 *
 *   const log = createLogger('auth')
 *   log.info('signed in', { email })
 *   const done = log.time('verify admin')
 *   // ... later
 *   done()            // -> "verify admin (42ms)"
 */
export function createLogger(scope) {
  return {
    scope,
    debug: (message, details) => write('debug', scope, message, details),
    info: (message, details) => write('info', scope, message, details),
    warn: (message, details) => write('warn', scope, message, details),
    error: (message, details) => write('error', scope, message, details),
    child: (sub) => createLogger(`${scope}:${sub}`),
    time: (label, details) => {
      const started = performance.now()
      return (extra) => {
        const ms = Math.round(performance.now() - started)
        write('debug', scope, `${label} (${ms}ms)`, extra ?? details)
        return ms
      }
    },
  }
}

/** The logger used for app-level (unscoped) messages. */
export const logger = createLogger('app')

export function getEntries() {
  return buffer.slice()
}

export function clearEntries() {
  buffer.length = 0
  for (const sink of sinks) {
    try {
      sink(null)
    } catch {
      /* ignore */
    }
  }
}

/** Subscribe to new entries. Returns an unsubscribe function. */
export function subscribe(sink) {
  sinks.add(sink)
  return () => sinks.delete(sink)
}

export function getConsoleLevel() {
  return consoleLevel
}

export function setConsoleLevel(level) {
  if (!isLevel(level)) return consoleLevel
  consoleLevel = level
  try {
    window.localStorage.setItem(STORAGE_KEY, level)
  } catch {
    /* ignore */
  }
  return consoleLevel
}

/** Human-readable dump, used by the Debug Panel's "Copy" button. */
export function exportEntries(entries = buffer) {
  return entries
    .map((entry) => {
      const detail = entry.details === undefined ? '' : ` ${safeStringify(entry.details)}`
      return `${formatClock(entry.time)} ${LEVEL_TAG[entry.level].trim().padEnd(5)} ${entry.scope} — ${entry.message}${detail}`
    })
    .join('\n')
}

export function safeStringify(value) {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// Handy escape hatch: poke at logging from the browser console.
if (typeof window !== 'undefined') {
  window.cq = window.cq ?? {}
  window.cq.log = { createLogger, getEntries, clearEntries, exportEntries, setLevel: setConsoleLevel, getLevel: getConsoleLevel }
}
