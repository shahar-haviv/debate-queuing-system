import { useState } from 'react'

/**
 * The app logo.
 *
 * Drop the official artwork at `public/ru-debate.png` and it appears here (and
 * as the browser favicon). Until that file exists the component falls back to
 * a plain "CQ" badge, so nothing ever renders as a broken image — which also
 * makes it safe to deploy before the artwork is added.
 */
export default function BrandMark({ className = 'size-9' }) {
  const [missing, setMissing] = useState(false)

  if (missing) {
    return (
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground ${className}`}
      >
        CQ
      </span>
    )
  }

  return (
    <img
      src="/ru-debate.png"
      alt="Reichman University Debate Society"
      className={`shrink-0 rounded-md object-contain ${className}`}
      onError={() => setMissing(true)}
    />
  )
}
