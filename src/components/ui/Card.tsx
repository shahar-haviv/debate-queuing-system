/**
 * A container with optional header/footer slots.
 *
 * It only draws a surface. Content, actions and tone are supplied by the caller,
 * so a new card variant never requires editing this file.
 */
import type { HTMLAttributes, ReactNode } from 'react'

const TONES = {
  default: 'border-border bg-card',
  accent: 'border-status-debate/30 bg-accent/40',
  danger: 'border-destructive/30 bg-late-surface',
} as const

export type CardTone = keyof typeof TONES

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone
  header?: ReactNode
  footer?: ReactNode
  children?: ReactNode
}

export default function Card({
  tone = 'default',
  header,
  footer,
  children,
  className = '',
  ...rest
}: CardProps) {
  return (
    <div className={`rounded-lg border p-4 shadow-sm ${TONES[tone]} ${className}`} {...rest}>
      {header && <div className="border-b border-border pb-3">{header}</div>}
      <div className={header ? 'pt-3' : ''}>{children}</div>
      {footer && <div className="mt-3 border-t border-border pt-3">{footer}</div>}
    </div>
  )
}
