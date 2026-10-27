/**
 * A modal shell: overlay, Escape handling, title and footer slots.
 *
 * Feature modals supply their own form as `children`; they do not re-implement
 * the backdrop or the keyboard contract. That keeps behaviour consistent and
 * means a new modal is additive (Open/Closed).
 */
import { useEffect, type ReactNode } from 'react'

const WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
} as const

export interface ModalProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  width?: keyof typeof WIDTHS
  /** Extra element rendered above the title, e.g. an icon block. */
  eyebrow?: ReactNode
}

export default function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  width = 'md',
  eyebrow,
}: ModalProps) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${WIDTHS[width]} max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl`}
      >
        {eyebrow}
        <h2 className="text-lg font-bold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2 pt-1">{footer}</div>}
      </div>
    </div>
  )
}
