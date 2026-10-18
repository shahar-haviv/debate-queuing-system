import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import BrandMark from '../components/BrandMark'

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
  const { user, isAdmin, loading, adminError, clearAdminError, signIn, signInWithMagicLink } = useAuth()
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
  const requested = location.state?.from
  const next = typeof requested === 'string' && requested.startsWith('/') && !requested.startsWith('//')
    ? requested
    : '/admin'

  const [mode, setMode] = useState('password')
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

  const handleSubmit = async (event) => {
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
        setNotice('Check your inbox — a magic sign-in link is on its way.')
      }
    } catch (err) {
      setError(err?.message || 'Sign in failed.')
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

        <div className="mt-6 grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          {[
            ['password', 'Password'],
            ['magic', 'Magic link'],
          ].map(([value, label]) => (
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
