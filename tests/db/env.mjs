/**
 * Shared plumbing for the database-level tests.
 *
 * These tests talk to the *real* Supabase project configured in `.env`, because
 * the behaviour they check (the Rules 1–7 triggers and the RLS/column grants)
 * only exists inside Postgres. Nothing here can be faked with a mock.
 *
 * Because of that they create rows, and every one of them is namespaced with
 * the ZZQA- prefix and removed in a `finally` block, so a crashed run leaves
 * nothing behind but the prefix is easy to find by hand.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (!match) continue
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (!(match[1] in process.env)) process.env[match[1]] = value
  }
}

loadEnvFile(join(root, '.env'))
loadEnvFile(join(root, '.env.local'))

export const PREFIX = 'ZZQA-'
export const BASE = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '')
export const ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
export const SECRET_KEY = process.env.SUPABASE_SECRET_KEY || ''

export const configured = Boolean(BASE && SECRET_KEY)

/** A REST call. Defaults to the privileged key, which bypasses RLS. */
export async function rest(path, { method = 'GET', body, prefer, key = SECRET_KEY, bearer } = {}) {
  const response = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${bearer ?? key}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: response.status, ok: response.ok, data }
}

export const select = (path) => rest(path)
export const insertOne = (row) =>
  rest('candidates', { method: 'POST', prefer: 'return=representation', body: row }).then((r) => ({
    ...r,
    row: Array.isArray(r.data) ? r.data[0] : r.data,
  }))

export const patchCandidate = (id, patch) => rest(`candidates?id=eq.${id}`, { method: 'PATCH', body: patch })
export const readCandidate = (id) =>
  rest(`candidates?id=eq.${id}&select=*`).then((r) => (Array.isArray(r.data) ? r.data[0] : null))

/**
 * A room's payload. The third argument is the interviewer panel: pass an array
 * of `{ name, phone }` objects, or a bare string for a one-person panel, which
 * keeps the short call sites readable.
 */
export function roomPayload(name, room_type, interviewers = []) {
  const panel =
    typeof interviewers === 'string'
      ? interviewers
        ? [{ name: interviewers, phone: null }]
        : []
      : Array.isArray(interviewers)
        ? interviewers
        : []
  return { room_name: name, room_type, interviewers: panel }
}

export function createRoom(name, room_type, interviewers = []) {
  return rest('rooms', {
    method: 'POST',
    prefer: 'return=representation',
    body: roomPayload(name, room_type, interviewers),
  }).then((r) => ({ ...r, row: Array.isArray(r.data) ? r.data[0] : r.data }))
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Remove anything a previous (possibly crashed) run left behind. */
export async function cleanupScratch() {
  await rest(`candidates?name=like.${PREFIX}*`, { method: 'DELETE' })
  await rest(`rooms?room_name=like.${PREFIX}*`, { method: 'DELETE' })
}

/** A tiny assertion harness — no test runner, so the script stays `node`-runnable. */
export function harness(title) {
  const failures = []
  let passed = 0

  const api = {
    ok(label, condition, detail = '') {
      if (condition) {
        passed += 1
        console.log(`  ✓ ${label}`)
      } else {
        failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
        console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
      }
      return condition
    },
    equal(label, actual, expected) {
      return api.ok(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    },
    report() {
      console.log('')
      if (failures.length === 0) {
        console.log(`✅ ${title}: ${passed} passed.`)
        return 0
      }
      console.log(`❌ ${title}: ${passed} passed, ${failures.length} failed.`)
      for (const failure of failures) console.log(`   • ${failure}`)
      return 1
    },
  }

  console.log(`\n${title}`)
  return api
}
