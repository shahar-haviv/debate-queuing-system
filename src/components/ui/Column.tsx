/**
 * A column of the dispatch board.
 *
 * `tone` and `count` are data; the body and an optional header action are
 * supplied as props, so a new column needs no change here.
 */
import type { ReactNode } from 'react'

const BARS = {
  amber: 'border-status-arrived',
  blue: 'border-status-initial',
  green: 'border-status-debate',
} as const

export type ColumnTone = keyof typeof BARS

export interface ColumnProps {
  title: string
  subtitle?: string
  count: number
  tone?: ColumnTone
  emptyText: string
  action?: ReactNode
  children?: ReactNode
}

export default function Column({
  title,
  subtitle,
  count,
  tone = 'blue',
  emptyText,
  action,
  children,
}: ColumnProps) {
  return (
    <section className="flex min-h-0 flex-col">
      <div className={`mb-3 flex items-center justify-between gap-2 border-l-4 pl-3 ${BARS[tone]}`}>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold tracking-tight text-foreground">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <span className="text-sm font-semibold tabular-nums text-muted-foreground">{count}</span>
        </div>
      </div>

      <div className="queue-scroll min-h-0 max-h-[60vh] flex-1 space-y-2 overflow-y-auto rounded-lg border border-border bg-card p-2">
        {count === 0 ? (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          children
        )}
      </div>
    </section>
  )
}
