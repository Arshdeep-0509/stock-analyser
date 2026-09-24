import { useRenderCount } from '../../lib/renderCounter'
import { Info } from 'lucide-react'
import type { HeaderCounts } from '../../analytics/aggregate'
import { MetricInfo } from '../../components/ui/MetricInfo'
import { Tooltip } from '../../components/ui/Tooltip'
import type { IndexQuote } from '../../data/MarketDataSource'
import { cn } from '../../lib/cn'
import { formatNumber } from '../../lib/formatters'
import { LtpCell } from '../rsi-ha/cells'

const VIX_TOOLTIP =
  "VIX is coloured inverted: a RISING VIX means rising risk (risk-off), so a positive change reads red here, not green — the opposite of every other quote on this page. That's intentional, not a bug."

function formatPlain(value: number): string {
  return formatNumber(value, 2)
}

/** positive/negative sign -> bullish/bearish, except when `invert` (VIX) flips which sign is "good". */
function changeTone(value: number, invert: boolean): 'bullish' | 'bearish' | 'neutral' {
  if (Number.isNaN(value) || value === 0) return 'neutral'
  const rising = value > 0
  const good = invert ? !rising : rising
  return good ? 'bullish' : 'bearish'
}

function ChangeBadge({ value, invert }: { value: number; invert: boolean }) {
  if (Number.isNaN(value)) return <span className="font-mono text-xs text-text-muted">—</span>
  const tone = changeTone(value, invert)
  return (
    <span
      className={cn(
        'font-mono text-xs tabular-nums',
        tone === 'bullish' && 'text-bullish',
        tone === 'bearish' && 'text-bearish',
        tone === 'neutral' && 'text-text-secondary',
      )}
    >
      {value > 0 ? '+' : ''}
      {formatNumber(value, 2)}%
    </span>
  )
}

export interface QuoteStripProps {
  indexQuotes: IndexQuote[]
  headerCounts: HeaderCounts
}

/**
 * One row: NIFTY / BANK NIFTY / India VIX quotes (from fetchIndexQuotes(),
 * flashing on change via the screener's own LtpCell — same component, just
 * a different display formatter), plus the live breakout/breakdown counts
 * and mean breakout strength from headerCounts(). Every value here is
 * already real (this is the one part of the /intraday skeleton that isn't
 * a placeholder).
 */
export function QuoteStrip({ indexQuotes, headerCounts }: QuoteStripProps) {
  useRenderCount('QuoteStrip')
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-border bg-panel px-3 py-2"
      style={{ gridArea: 'quotes' }}
    >
      {indexQuotes.length === 0 ? (
        <span className="text-xs text-text-muted">Loading quotes…</span>
      ) : (
        indexQuotes.map((quote) => {
          const invert = quote.key === 'INDIAVIX'
          return (
            <div key={quote.key} className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-text-secondary">{quote.label}</span>
              <LtpCell ltp={quote.last} format={formatPlain} />
              <ChangeBadge value={quote.changePct} invert={invert} />
              {invert && (
                <Tooltip label={VIX_TOOLTIP} side="bottom">
                  <Info className="h-3 w-3 text-text-muted" aria-label="Why India VIX's colour is inverted" />
                </Tooltip>
              )}
            </div>
          )
        })
      )}

      <span className="h-4 w-px bg-border" aria-hidden="true" />

      <div className="flex items-center gap-1.5">
        <span className="text-xs text-text-secondary">Breakout</span>
        <span className="font-mono text-xs text-bullish">▲ {headerCounts.breakoutUpCount}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-text-secondary">BreakDown</span>
        <span className="font-mono text-xs text-bearish">▼ {headerCounts.breakoutDownCount}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-text-secondary">Breakout Strength</span>
        <MetricInfo metric="breakoutStrength" />
        <span className="font-mono text-xs text-text-primary">
          {Number.isNaN(headerCounts.breakoutStrength) ? '—' : formatNumber(headerCounts.breakoutStrength, 1)}
        </span>
      </div>
    </div>
  )
}
