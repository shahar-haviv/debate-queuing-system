import { useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'

/**
 * The IDC Debate Society logo & Main Office Home button.
 *
 * Clicking the IDC icon anywhere in the application navigates back to the
 * Main Office (`/`) homepage.
 */
export interface BrandMarkProps {
  className?: string
  to?: string
}

export default function BrandMark({ className = 'size-9', to = '/' }: BrandMarkProps) {
  const [missing, setMissing] = useState(false)
  const inRouter = useInRouterContext()

  const badge = missing ? (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-xl bg-primary text-xs font-extrabold tracking-tight text-primary-foreground shadow-xs transition group-hover:scale-105 ${className}`}
    >
      IDC
    </span>
  ) : (
    <img
      src="/ru-debate.png"
      alt="IDC Debate — Main Office"
      className={`shrink-0 rounded-xl object-contain transition group-hover:scale-105 ${className}`}
      onError={() => setMissing(true)}
    />
  )

  if (!inRouter) {
    return badge
  }

  return (
    <Link
      to={to}
      title="Return to Main Office"
      aria-label="Return to Main Office"
      className="group inline-flex shrink-0 items-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {badge}
    </Link>
  )
}
