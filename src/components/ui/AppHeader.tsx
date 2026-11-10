import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import BrandMark from './BrandMark'
import PaletteSwitcher from './PaletteSwitcher'

export interface AppHeaderProps {
  /** Optional contextual action rendered on the right (e.g., "+ New Event" on Screening Queue) */
  actions?: ReactNode
}

/**
 * Unified top navigation bar shared across Main Office (`/`), Club Training (`/training`),
 * and Screening Queue (`/admin`).
 *
 * Ensures switching between workspaces never shifts the navigation bar and keeps
 * Screening Queue always accessible at the top.
 */
export default function AppHeader({ actions }: AppHeaderProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()

  const activeSection: 'office' | 'training' | 'queue' = pathname.startsWith('/training')
    ? 'training'
    : pathname.startsWith('/admin')
      ? 'queue'
      : 'office'

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-9" />
          <Link
            to="/"
            className="text-base font-extrabold tracking-tight text-primary hover:opacity-90"
          >
            IDC Debate
          </Link>
        </div>

        <nav
          aria-label="Main Navigation"
          className="flex items-center gap-1 rounded-full border border-border bg-muted/60 p-1"
        >
          <Link
            to="/"
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
              activeSection === 'office'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-foreground hover:bg-white'
            }`}
          >
            Main Office
          </Link>
          <Link
            to="/training"
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
              activeSection === 'training'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-foreground hover:bg-white'
            }`}
          >
            Club Training
          </Link>
          <Link
            to="/admin"
            className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
              activeSection === 'queue'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-foreground hover:bg-white'
            }`}
          >
            Screening Queue
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          {actions}
          <PaletteSwitcher />
          <button
            type="button"
            onClick={handleSignOut}
            title={user?.email ?? 'Sign out'}
            className="h-9 rounded-full border border-border bg-white px-3.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
