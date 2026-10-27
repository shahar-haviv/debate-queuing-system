/**
 * Authentication and admin verification.
 *
 * The hook depends on `AuthGateway`, not on Supabase. Two operational details
 * are preserved from the original implementation:
 *
 *   • the verified email is cached **only after** a positive answer, so a
 *     transient failure retries instead of locking an admin out;
 *   • Supabase calls are never awaited inside its auth callback (supabase-js
 *     holds a lock while the callback runs), so evaluation is deferred a tick.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createLogger } from '../core/logger'
import { useServices } from '../services/container'
import type { AdminUser, AuthSession } from '../services/database'

const log = createLogger('auth')

export interface AuthContextValue {
  session: AuthSession | null
  user: AdminUser | null
  isAdmin: boolean
  loading: boolean
  adminError: string
  clearAdminError: () => void
  signIn: (email: string, password: string) => Promise<void>
  signInWithMagicLink: (email: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth } = useServices()

  const [session, setSession] = useState<AuthSession | null>(null)
  const [user, setUser] = useState<AdminUser | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [adminError, setAdminError] = useState('')

  /** Only ever set after a positive result. */
  const verifiedEmailRef = useRef<string | undefined>(undefined)
  /** Monotonic id so a slow, superseded check cannot overwrite a newer one. */
  const runIdRef = useRef(0)

  const checkAdmin = useCallback(
    async (email: string) => {
      // The RLS policy already narrows this to the caller's own row; the
      // comparison below is case-insensitive in JS rather than via `ilike`, so
      // an email containing `%` or `_` can never act as a LIKE wildcard.
      const emails = await auth.listAllowedAdmins()
      const needle = email.trim().toLowerCase()
      return emails.some((candidate) => candidate.trim().toLowerCase() === needle)
    },
    [auth],
  )

  const evaluate = useCallback(
    async (nextSession: AuthSession | null, source: string) => {
      const runId = ++runIdRef.current
      const email = nextSession?.user?.email ?? null

      setSession(nextSession)
      setUser(nextSession?.user ?? null)

      if (!email) {
        verifiedEmailRef.current = undefined
        setIsAdmin(false)
        setAdminError('')
        setLoading(false)
        log.info('no session - signed out', { source })
        return
      }

      if (verifiedEmailRef.current === email) {
        setIsAdmin(true)
        setLoading(false)
        log.debug('admin cached - skipping re-check', { email, source })
        return
      }

      setLoading(true)
      const done = log.time(`verify admin (${source})`)
      try {
        const allowed = await checkAdmin(email)
        if (runId !== runIdRef.current) {
          log.debug('verification superseded - ignoring result', { email })
          return
        }
        if (allowed) {
          verifiedEmailRef.current = email
          setIsAdmin(true)
          setAdminError('')
          log.info('admin verified', { email })
        } else {
          verifiedEmailRef.current = undefined
          setIsAdmin(false)
          setAdminError('Access denied - this email is not on the allowed admins list.')
          log.warn('email not in allowed_admins - signing out', { email })
          await auth.signOut()
        }
      } catch (cause) {
        if (runId !== runIdRef.current) return
        // Deliberately NOT cached, so the next evaluation retries.
        verifiedEmailRef.current = undefined
        setIsAdmin(false)
        setAdminError(cause instanceof Error ? cause.message : 'Could not verify admin access.')
        log.error('admin verification failed', { email, cause })
      } finally {
        done()
        if (runId === runIdRef.current) setLoading(false)
      }
    },
    [auth, checkAdmin],
  )

  useEffect(() => {
    let active = true
    log.info('auth provider mounted')

    auth
      .getSession()
      .then((next) => {
        if (active) void evaluate(next, 'initial')
      })
      .catch((cause: unknown) => {
        log.error('getSession failed', { cause })
        if (active) void evaluate(null, 'initial-error')
      })

    const unsubscribe = auth.onAuthStateChange((next) => {
      log.debug('auth event', { email: next?.user?.email ?? null })
      // Never await Supabase calls inside this callback; defer to the next tick.
      setTimeout(() => {
        if (active) void evaluate(next, 'event')
      }, 0)
    })

    return () => {
      active = false
      unsubscribe()
      log.info('auth provider unmounted')
    }
  }, [auth, evaluate])

  const signIn = useCallback(
    async (email: string, password: string) => {
      log.info('password sign-in attempt', { email })
      const started = performance.now()
      try {
        await auth.signInWithPassword(email, password)
      } catch (cause) {
        log.error('password sign-in failed', {
          email,
          message: cause instanceof Error ? cause.message : String(cause),
          ms: Math.round(performance.now() - started),
        })
        throw cause
      }
      log.info('password sign-in accepted', { email, ms: Math.round(performance.now() - started) })
    },
    [auth],
  )

  const signInWithMagicLink = useCallback(
    async (email: string) => {
      log.info('magic-link requested', { email })
      try {
        await auth.signInWithOtp(email, `${window.location.origin}/admin`)
      } catch (cause) {
        log.error('magic-link request failed', {
          email,
          message: cause instanceof Error ? cause.message : String(cause),
        })
        throw cause
      }
      log.info('magic link sent', { email })
    },
    [auth],
  )

  const signOut = useCallback(async () => {
    log.info('signing out')
    setAdminError('')
    verifiedEmailRef.current = undefined
    try {
      await auth.signOut()
    } catch (cause) {
      log.warn('sign-out reported an error', {
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }, [auth])

  const clearAdminError = useCallback(() => setAdminError(''), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      isAdmin,
      loading,
      adminError,
      clearAdminError,
      signIn,
      signInWithMagicLink,
      signOut,
    }),
    [session, user, isAdmin, loading, adminError, clearAdminError, signIn, signInWithMagicLink, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
