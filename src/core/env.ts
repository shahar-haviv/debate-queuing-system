/**
 * Runtime configuration, validated before the app talks to anything.
 *
 * `import.meta.env` is untyped and silently returns `undefined` for a typo, so
 * every read goes through this one zod schema. Two entry points on purpose:
 *
 *   • `getEnv()` fails **loudly** and is what services call. A missing key can
 *     never turn into `fetch("undefined/rest/v1/...")`.
 *   • `envStatus` is the non-throwing form `main.tsx` uses to render a readable
 *     configuration screen instead of a white page.
 *
 * The Supabase URL and publishable key are public by design (RLS is the access
 * control), but they are still configuration: they are not credentials and do
 * not belong in component source.
 */
import { z } from 'zod'

export const envSchema = z.object({
  VITE_SUPABASE_URL: z
    .string()
    .trim()
    .url('must be the full https://<project>.supabase.co URL'),
  VITE_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .trim()
    .min(20, 'must be the project publishable (anon) key'),
  VITE_APP_ENV: z.enum(['development', 'preview', 'production']),
  VITE_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
})

export type AppEnvironment = z.infer<typeof envSchema>

export type EnvResult =
  | { ok: true; env: AppEnvironment }
  | { ok: false; problems: string[] }

/**
 * Validate a source object. Exported so a test can prove the parser rejects a
 * blank URL without having to mutate the real `import.meta.env`.
 */
export function parseEnv(source: Record<string, unknown>): EnvResult {
  const parsed = envSchema.safeParse({
    VITE_SUPABASE_URL: source.VITE_SUPABASE_URL,
    // The anon key had two historical names; accept either, prefer the new one.
    VITE_SUPABASE_PUBLISHABLE_KEY:
      source.VITE_SUPABASE_PUBLISHABLE_KEY ?? source.VITE_SUPABASE_ANON_KEY,
    VITE_APP_ENV:
      source.VITE_APP_ENV ??
      (source.PROD ? 'production' : source.DEV ? 'development' : 'preview'),
    VITE_LOG_LEVEL: source.VITE_LOG_LEVEL || undefined,
  })

  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => {
        const key = issue.path.join('.') || 'environment'
        return `${key}: ${issue.message}`
      }),
    }
  }

  return { ok: true, env: parsed.data }
}

let cached: AppEnvironment | null = null

/** The validated environment. Throws with an actionable message when invalid. */
export function getEnv(): AppEnvironment {
  if (cached) return cached

  const result = parseEnv(import.meta.env as unknown as Record<string, unknown>)
  if (!result.ok) {
    throw new Error(
      `Invalid environment configuration:\n  - ${result.problems.join('\n  - ')}\n` +
        'Copy .env.example to .env and fill in the values.',
    )
  }

  cached = result.env
  return cached
}

/** Non-throwing status, for the startup configuration screen. */
export const envStatus = parseEnv(import.meta.env as unknown as Record<string, unknown>)

const LOCAL_DB_STORAGE_KEY = 'cq:useLocalDb'

/**
 * True when the app should use the in-browser Local Sandbox DB instead of Supabase.
 * Automatically activates in local dev (`vite`) when `.env` is missing, or when
 * explicitly enabled via `VITE_USE_LOCAL_DB=true` or the UI toggle.
 */
export function isLocalSandboxEnabled(): boolean {
  const rawEnv = import.meta.env as unknown as Record<string, unknown>
  if (rawEnv.VITE_USE_LOCAL_DB === 'true') return true
  if (typeof window !== 'undefined') {
    try {
      const pref = window.localStorage.getItem(LOCAL_DB_STORAGE_KEY)
      if (pref === '1') return true
      if (pref === '0') return false
    } catch {
      // ignore storage errors
    }
  }
  if (!envStatus.ok && Boolean(rawEnv.DEV) && !rawEnv.VITEST) {
    return true
  }
  return false
}

export function setLocalSandboxPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LOCAL_DB_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore storage errors
  }
}

/** True when the environment passed validation or Local Sandbox is active. */
export const isConfigured = envStatus.ok || isLocalSandboxEnabled()

/** Test seam: forget the cached environment. */
export function resetEnvCache(): void {
  cached = null
}
