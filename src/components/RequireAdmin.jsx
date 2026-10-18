import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

function FullScreenSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        <p className="text-sm text-muted-foreground">Checking access…</p>
      </div>
    </div>
  )
}

export default function RequireAdmin({ children }) {
  const { user, isAdmin, loading, adminError } = useAuth()

  if (loading) return <FullScreenSpinner />
  if (user && isAdmin) return children

  if (adminError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-lg border border-destructive/30 bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-2xl">
            ⛔
          </div>
          <h1 className="mt-4 text-lg font-bold tracking-tight text-foreground">Access Denied</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{adminError}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            You have been signed out. Add your email to the{' '}
            <code className="rounded bg-muted px-1 text-foreground">allowed_admins</code> table to gain access.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-lg font-bold tracking-tight text-foreground">Admins only</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sign in to open the dispatch dashboard.</p>
        <Link
          to="/login"
          className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-110"
        >
          Sign in
        </Link>
      </div>
    </div>
  )
}
