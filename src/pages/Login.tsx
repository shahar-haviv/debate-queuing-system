import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import BrandMark from '../components/ui/BrandMark'

const inputClass =
  'w-full rounded-md border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-ring'

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  )
}

export default function Login() {
  const {
    user,
    isAdmin,
    loading,
    adminError,
    clearAdminError,
    signIn,
    signInWithMagicLink,
    signInWithGoogle,
  } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  /**
   * Where to land after a successful sign-in. `RequireAdmin` puts the page they
   * were blocked on into route state, so an interviewer who opens a room link
   * ends up in that room; a bare visit still goes to the dispatcher board.
   * Only same-origin paths are honoured — route state is attacker-influenced in
   * principle (a crafted link can carry it), and a value like `//evil.example`
   * would otherwise be a redirect off-site.
   */
  const requested = (location.state as { from?: unknown } | null)?.from
  const next = typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//')
    ? requested
    : '/admin'

  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    clearAdminError()
  }, [clearAdminError])

  if (loading) return <Spinner />
  if (user && isAdmin) return <Navigate to={next} replace />

  const handleGoogleSignIn = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await signInWithGoogle(`${window.location.origin}${next}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google sign-in failed.')
      setBusy(false)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'password') {
        await signIn(email.trim(), password)
        navigate(next, { replace: true })
      } else {
        await signInWithMagicLink(email.trim())
        setNotice('Check your inbox - a magic sign-in link is on its way.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-7 shadow-sm">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-10" />
          <div>
            <h1 className="text-base font-bold leading-tight tracking-tight text-foreground">Candidate Queue</h1>
            <p className="text-xs text-muted-foreground">Dispatch management</p>
          </div>
        </div>

        <div className="mt-6">
          <button
            type="button"
            disabled={busy}
            onClick={handleGoogleSignIn}
            className="flex w-full items-center justify-center gap-2.5 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted/60 disabled:opacity-60"
          >
            <svg className="size-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </button>
        </div>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Or email login
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          {([['password', 'Password'], ['magic', 'Magic link']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value)
                setError('')
                setNotice('')
              }}
              className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                mode === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-muted-foreground">Email</span>
            <input
              type="email"
              dir="ltr"
              autoComplete="email"
              className={inputClass}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              required
            />
          </label>

          {mode === 'password' && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted-foreground">Password</span>
              <input
                type="password"
                dir="ltr"
                autoComplete="current-password"
                className={inputClass}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                required
              />
            </label>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-late-surface px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-md border border-status-debate/30 bg-accent px-3 py-2 text-sm text-accent-foreground">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
          >
            {busy ? 'Please wait…' : mode === 'password' ? 'Sign in' : 'Send magic link'}
          </button>
        </form>

        {adminError && (
          <p className="mt-4 rounded-md border border-status-arrived/30 bg-late-surface px-3 py-2 text-xs text-status-arrived">
            {adminError}
          </p>
        )}

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Access is limited to emails listed in the{' '}
          <code className="rounded bg-muted px-1 text-foreground">allowed_admins</code> table.
        </p>
      </div>
    </div>
  )
}
