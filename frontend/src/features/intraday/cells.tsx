import { cn } from '../../lib/cn'
import type { IntradayRow } from '../../types/domain'

/**
 * Shared cell renderers used by every /intraday table (TopStrengthTable,
 * BreakoutPanels, ...) so "Intraday" and "Breakouts" read identically
 * wherever they appear — arrow + colour + a screen-reader text label,
 * never colour alone.
 *
 * Every sr-only label sits inside a relative-positioned wrapper: an absolutely-
 * positioned sr-only span with no positioned ancestor inside its table's
 * horizontal scroller escapes that scroller's clipping and widens the whole
 * document (the cause of /intraday's horizontal page scroll at phone widths).
 */

export function IntradayDirCell({ dir }: { dir: 'up' | 'down' }) {
  const up = dir === 'up'
  return (
    <span className={cn('relative inline-flex items-center gap-1 font-medium', up ? 'text-bullish' : 'text-bearish')}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      <span className="sr-only">{up ? 'Up' : 'Down'}</span>
    </span>
  )
}

export function BreakoutCell({ breakout }: { breakout: IntradayRow['breakout'] }) {
  if (breakout === null) {
    return (
      <span className="relative">
        <span className="sr-only">No breakout</span>
      </span>
    )
  }
  const up = breakout === 'BREAKOUT-UP'
  return (
    <span className={cn('relative inline-flex items-center gap-1 font-medium', up ? 'text-bullish' : 'text-bearish')}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      <span className="sr-only">{up ? 'Breakout up' : 'Breakout down'}</span>
    </span>
  )
}
