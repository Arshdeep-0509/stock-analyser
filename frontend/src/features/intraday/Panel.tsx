import { createContext, useContext, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface PanelProps {
  title: string
  /** A one-line explanation shown under the title, e.g. "Look for trending names, or names holding support and resistance" — optional; most panels don't need one. */
  subtitle?: ReactNode
  /** A pulsing "● LIVE · SIMULATED" badge (the qualifier is the honesty rule: nothing claims a live feed unqualified) — purely decorative (aria-live="off"), never announced as a live region. */
  live?: boolean
  /** A coloured left border — 'bullish' for Breakout panels, 'bearish' for BreakDown panels, 'none' otherwise. */
  accent?: 'bullish' | 'bearish' | 'none'
  /** Right-aligned header slot for future per-panel controls (e.g. a threshold slider). */
  toolbar?: ReactNode
  children: ReactNode
  className?: string
  /** Lets a panel opt into a scrolling body (e.g. a fixed max-height) — the body is not scrollable by default. */
  bodyClassName?: string
}

/**
 * Whether the market is open right now (or forced open in devtools). While it
 * is closed nothing ticks, so a panel that would say LIVE says AS OF CLOSE
 * instead: the numbers are the last session's, frozen at 15:30.
 */
export const MarketOpenContext = createContext(true)

const badgeTone = {
  bullish: { text: 'text-bullish', dot: 'bg-bullish' },
  bearish: { text: 'text-bearish', dot: 'bg-bearish' },
} as const

/**
 * The session badge every /intraday panel and sector card shows: a pulsing
 * "LIVE · SIMULATED" while the market is open (the qualifier is the honesty
 * rule: nothing claims a live feed unqualified), "AS OF CLOSE" while it is
 * closed and the numbers are the last session's. Decorative (aria-live="off").
 */
export function SessionBadge({ tone = 'bullish' }: { tone?: keyof typeof badgeTone }) {
  const marketOpen = useContext(MarketOpenContext)
  if (!marketOpen) return <span className="shrink-0 text-[10px] font-medium text-text-muted">AS OF CLOSE</span>
  const t = badgeTone[tone]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 text-[10px] font-medium', t.text)} aria-live="off">
      <span className="relative flex h-1.5 w-1.5">
        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', t.dot)} />
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', t.dot)} />
      </span>
      LIVE · SIMULATED
    </span>
  )
}

const accentBorderClass: Record<NonNullable<PanelProps['accent']>, string> = {
  bullish: 'border-l-2 border-l-bullish',
  bearish: 'border-l-2 border-l-bearish',
  none: '',
}

/**
 * The one panel chrome for every /intraday section — title, optional LIVE
 * badge, optional accent border, optional toolbar, and a body. Every
 * section on this page (meters, tables, sector cards) renders through this
 * so the page reads as one system rather than a pile of bespoke boxes, and
 * so error/loading/empty states only ever need to be handled once, here at
 * the call site, in a consistent shape.
 */
export function Panel({ title, subtitle, live, accent = 'none', toolbar, children, className, bodyClassName }: PanelProps) {
  return (
    <section className={cn('flex min-w-0 flex-col rounded border border-border bg-panel', accentBorderClass[accent], className)}>
      <header className="flex shrink-0 flex-col gap-0.5 border-b border-border-hairline px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="truncate text-xs font-medium uppercase tracking-wide text-text-secondary">{title}</h3>
            {live && <SessionBadge />}
          </div>
          {toolbar && <div className="flex shrink-0 items-center gap-1">{toolbar}</div>}
        </div>
        {subtitle && <p className="truncate text-[10px] normal-case tracking-normal text-text-secondary">{subtitle}</p>}
      </header>
      <div className={cn('min-w-0 flex-1 p-3', bodyClassName)}>{children}</div>
    </section>
  )
}
