import { useEffect } from 'react'

const TONES = {
  info: 'bg-foreground text-background',
  success: 'bg-status-debate text-primary-foreground',
  error: 'bg-destructive text-destructive-foreground',
}

export default function Toast({ toast, onDismiss }) {
  // Depend on the toast *id*, not the object: re-rendering the parent (which
  // happens on every realtime event) must not restart the dismiss timer.
  const id = toast?.id

  useEffect(() => {
    if (id === undefined || id === null) return undefined
    const timer = setTimeout(onDismiss, 4000)
    return () => clearTimeout(timer)
  }, [id, onDismiss])

  if (!toast) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
      <button
        type="button"
        onClick={onDismiss}
        className={`pointer-events-auto max-w-lg rounded-md px-4 py-3 text-sm font-medium shadow-lg ${
          TONES[toast.tone] ?? TONES.info
        }`}
      >
        {toast.message}
      </button>
    </div>
  )
}
