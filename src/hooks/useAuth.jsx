import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { isConfigured, supabase } from '../lib/supabase'
import { createLogger } from '../lib/logger.js'

const AuthContext = createContext(null)
const log = createLogger('auth')

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [adminError, setAdminError] = useState('')

  /**
   * The email we have *successfully* verified, so a token refresh doesn't
   * repeat the lookup. It is only ever set after a positive result — caching
   * before the answer arrives would lock a legitimate admin out for the rest
   * of the session if the check ever failed transiently.
   */
  const verifiedEmailRef = useRef(undefined)
  /** Monotonic id so a slow, superseded check can't overwrite a newer one. */
  const runIdRef = useRef(0)

  const checkAdmin = useCallback(async (email) => {
    // The RLS policy already narrows this to the caller's own row; the
    // comparison below is case-insensitive in JS rather than via `ilike`, so
    // an email containing `%` or `_` can never act as a LIKE wildcard.
    const { data, error } = await supabase.from('allowed_admins').select('email')
    if (error) throw error
    const needle = email.trim().toLowerCase()
    return (data ?? []).some((row) => (row.email ?? '').trim().toLowerCase() === needle)
  }, [])

  const evaluate = useCallback(
    async (nextSession, source) => {
      const runId = ++runIdRef.current
      const email = nextSession?.user?.email ?? null

      setSession(nextSession)
      setUser(nextSession?.user ?? null)

      if (!email) {
        verifiedEmailRef.current = undefined
        setIsAdmin(false)
        setAdminError('')
        setLoading(false)
        log.info('no session — signed out', { source })
        return
      }

      if (verifiedEmailRef.current === email) {
        setIsAdmin(true)
        setLoading(false)
        log.debug('admin cached — skipping re-check', { email, source })
        return
      }

      setLoading(true)
      const done = log.time(`verify admin (${source})`)
      try {
        const allowed = await checkAdmin(email)
        if (runId !== runIdRef.current) {
          log.debug('verification superseded — ignoring result', { email })
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
          setAdminError('Access denied — this email is not on the allowed admins list.')
          log.warn('email not in allowed_admins — signing out', { email })
          await supabase.auth.signOut()
        }
      } catch (error) {
        if (runId !== runIdRef.current) return
        // Deliberately NOT cached, so the next evaluation retries instead of
        // latching "denied" for the life of the session.
        verifiedEmailRef.current = undefined
        setIsAdmin(false)
        setAdminError(error?.message || 'Could not verify admin access.')
        log.error('admin verification failed', { email, error })
      } finally {
        done()
        if (runId === runIdRef.current) setLoading(false)
      }
    },
    [checkAdmin],
  )

  useEffect(() => {
    if (!isConfigured) {
      log.warn('supabase is not configured — auth disabled')
      setLoading(false)
      return undefined
    }

    let active = true
    log.info('auth provider mounted')

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) log.error('getSession failed', { error })
        if (active) evaluate(data?.session ?? null, 'initial')
      })
      .catch((error) => {
        log.error('getSession threw', { error })
        if (active) evaluate(null, 'initial-error')
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      log.debug(`auth event: ${event}`, { email: nextSession?.user?.email ?? null })
      // Never await Supabase calls inside this callback (supabase-js holds a
      // lock while it runs) — defer to the next tick instead.
      setTimeout(() => {
        if (active) evaluate(nextSession, `event:${event}`)
      }, 0)
    })

    return () => {
      active = false
      subscription.unsubscribe()
      log.info('auth provider unmounted')
    }
  }, [evaluate])

  const signIn = useCallback(async (email, password) => {
    log.info('password sign-in attempt', { email })
    const started = performance.now()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      log.error('password sign-in failed', {
        email,
        message: error.message,
        status: error.status,
        ms: Math.round(performance.now() - started),
      })
      throw error
    }
    log.info('password sign-in accepted', {
      email,
      userId: data?.user?.id,
      ms: Math.round(performance.now() - started),
    })
  }, [])

  const signInWithMagicLink = useCallback(async (email) => {
    log.info('magic-link requested', { email })
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/admin` },
    })
    if (error) {
      log.error('magic-link request failed', { email, message: error.message })
      throw error
    }
    log.info('magic link sent', { email })
  }, [])

  const signOut = useCallback(async () => {
    log.info('signing out')
    setAdminError('')
    verifiedEmailRef.current = undefined
    const { error } = await supabase.auth.signOut()
    if (error) log.warn('sign-out reported an error', { message: error.message })
  }, [])

  const clearAdminError = useCallback(() => setAdminError(''), [])

  const value = useMemo(
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

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
