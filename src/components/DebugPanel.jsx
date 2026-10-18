import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  LEVEL_ORDER,
  clearEntries,
  exportEntries,
  formatClock,
  getConsoleLevel,
  getEntries,
  safeStringify,
  setConsoleLevel,
  subscribe,
} from '../lib/logger.js'

const LEVEL_CHIP = {
  debug: 'bg-muted text-muted-foreground',
  info: 'bg-status-debate/15 text-status-debate',
  warn: 'bg-status-arrived/15 text-status-arrived',
  error: 'bg-destructive/15 text-destructive',
}

const LEVELS_AT_OR_ABOVE = {
  debug: ['debug', 'info', 'warn', 'error'],
  info: ['info', 'warn', 'error'],
  warn: ['warn', 'error'],
  error: ['error'],
  silent: [],
}

const MAX_ROWS = 250

function LogRow({ entry, expanded, onToggle }) {
  const hasDetails = entry.details !== undefined && entry.details !== null
  return (
    <li className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={hasDetails ? onToggle : undefined}
        className={`flex w-full items-start gap-2 px-3 py-1.5 text-left font-mono text-[11px] leading-5 ${
          hasDetails ? 'hover:bg-muted/60' : 'cursor-default'
        }`}
      >
        <span className="shrink-0 tabular-nums text-muted-foreground">{formatClock(entry.time)}</span>
        <span className={`shrink-0 rounded px-1 font-semibold ${LEVEL_CHIP[entry.level]}`}>
          {entry.level.toUpperCase()}
        </span>
        <span className="shrink-0 font-semibold text-foreground">{entry.scope}</span>
        <span className="min-w-0 flex-1 break-words text-foreground/80">{entry.message}</span>
        {hasDetails && (
          <span className="shrink-0 text-muted-foreground">{expanded ? '▾' : '▸'}</span>
        )}
      </button>
      {expanded && hasDetails && (
        <pre className="mx-3 mb-2 max-h-52 overflow-auto rounded border border-border bg-muted/60 p-2 font-mono text-[11px] leading-5 text-foreground">
          {JSON.stringify(entry.details, null, 2)}
        </pre>
      )}
    </li>
  )
}

/**
 * A live view of the logger's ring buffer. Useful on a phone, where opening
 * remote devtools is awkward.
 *
 *   • toggle with the button in the bottom-left or Ctrl/Cmd + Shift + D
 *   • the level selector changes what reaches the browser console
 *   • hidden on the public candidate page so it never confuses a candidate
 */
export default function DebugPanel() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState(() => getEntries())
  const [minLevel, setMinLevel] = useState('debug')
  const [query, setQuery] = useState('')
  const [paused, setPaused] = useState(false)
  const [consoleLevel, setConsoleLevelState] = useState(() => getConsoleLevel())
  const [copied, setCopied] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const listRef = useRef(null)
  const stickToBottom = useRef(true)

  const hidden = location.pathname.startsWith('/candidate/')

  useEffect(() => {
    return subscribe(() => {
      if (pausedRef.current) return
      setEntries(getEntries())
    })
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Keep the newest line in view unless the user scrolled up.
  useEffect(() => {
    if (!open || !stickToBottom.current) return
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [entries, open])

  const filtered = useMemo(() => {
    const allowed = LEVELS_AT_OR_ABOVE[minLevel] ?? LEVEL_ORDER
    const needle = query.trim().toLowerCase()
    const rows = entries.filter((entry) => {
      if (!allowed.includes(entry.level)) return false
      if (!needle) return true
      const haystack = `${entry.scope} ${entry.message} ${
        entry.details === undefined ? '' : safeStringify(entry.details)
      }`
      return haystack.toLowerCase().includes(needle)
    })
    return rows.slice(-MAX_ROWS)
  }, [entries, minLevel, query])

  const counts = useMemo(() => {
    let errors = 0
    let warns = 0
    for (const entry of entries) {
      if (entry.level === 'error') errors++
      else if (entry.level === 'warn') warns++
    }
    return { errors, warns }
  }, [entries])

  const handleClear = () => {
    clearEntries()
    setEntries([])
    setExpandedId(null)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportEntries(filtered))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const handleLevelChange = (level) => {
    setConsoleLevel(level)
    setConsoleLevelState(getConsoleLevel())
  }

  if (hidden) return null

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open debug log (Ctrl+Shift+D)"
        className="fixed bottom-3 left-3 z-[70] inline-flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur transition hover:text-foreground"
      >
        Logs
        {counts.errors > 0 && (
          <span className="rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
            {counts.errors}
          </span>
        )}
        {counts.errors === 0 && counts.warns > 0 && (
          <span className="rounded-full bg-status-arrived px-1.5 text-[10px] font-bold text-primary-foreground">
            {counts.warns}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] border-t border-border bg-card/95 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] backdrop-blur">
      <div className="mx-auto max-w-[1600px]">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-xs font-bold uppercase tracking-wide text-foreground">Debug log</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {filtered.length}/{entries.length}
          </span>

          <select
            aria-label="Console level"
            value={consoleLevel}
            onChange={(event) => handleLevelChange(event.target.value)}
            title="What reaches the browser console"
            className="rounded border border-input bg-card px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          >
            {LEVEL_ORDER.map((level) => (
              <option key={level} value={level}>
                console: {level}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by level"
            value={minLevel}
            onChange={(event) => setMinLevel(event.target.value)}
            className="rounded border border-input bg-card px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          >
            {LEVEL_ORDER.map((level) => (
              <option key={level} value={level}>
                show: {level}+
              </option>
            ))}
          </select>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter…"
            className="w-40 rounded border border-input bg-card px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring"
          />

          <div className="ms-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPaused((prev) => !prev)}
              className={`rounded border px-2 py-1 text-xs font-medium transition ${
                paused
                  ? 'border-status-arrived/40 bg-status-arrived/10 text-status-arrived'
                  : 'border-input bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {paused ? 'Paused' : 'Pause'}
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded border border-input bg-card px-2 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="rounded border border-input bg-card px-2 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-input bg-card px-2 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              Close
            </button>
          </div>
        </header>

        <ul
          ref={listRef}
          onScroll={(event) => {
            const node = event.currentTarget
            stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 40
          }}
          className="queue-scroll max-h-[38vh] overflow-y-auto"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-8 text-center text-xs text-muted-foreground">
              Nothing logged yet at this level.
            </li>
          ) : (
            filtered.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                expanded={expandedId === entry.id}
                onToggle={() => setExpandedId((prev) => (prev === entry.id ? null : entry.id))}
              />
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
