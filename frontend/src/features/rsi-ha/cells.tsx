import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Link2, TrendingDown, TrendingUp } from 'lucide-react'
import { Badge } from '../../components/ui/Badge'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { formatINR, formatISTTime, formatNumber } from '../../lib/formatters'
import { DEFAULT_PARAMS, type StrategyParams } from '../../strategy/constants'
import type { SignalKind } from '../../types/domain'
import type { InstrumentType } from './rowHelpers'

const FLASH_DURATION_MS = 400

// ---------------------------------------------------------------------------
// Signal badge
// ---------------------------------------------------------------------------

export function SignalBadge({ signal, onHoverDerived }: { signal: SignalKind; onHoverDerived?: (hovering: boolean) => void }) {
  switch (signal) {
    case 'BUY':
      // Every kind carries a glyph AND its text — never distinguishable by colour alone.
      return (
        <Badge variant="bullish" icon={<ArrowUp className="h-3 w-3" aria-hidden="true" />}>
          BUY
        </Badge>
      )
    case 'SELL':
      return (
        <Badge variant="bearish" icon={<ArrowDown className="h-3 w-3" aria-hidden="true" />}>
          SELL
        </Badge>
      )
    case 'BREAKOUT-UP':
      return (
        <Badge variant="bullish" outline icon={<TrendingUp className="h-3 w-3" aria-hidden="true" />}>
          BREAKOUT-UP
        </Badge>
      )
    case 'BREAKOUT-DOWN':
      return (
        <Badge variant="bearish" outline icon={<TrendingDown className="h-3 w-3" aria-hidden="true" />}>
          BREAKOUT-DOWN
        </Badge>
      )
    case 'CE Buy':
    case 'PE Buy':
      return (
        <span onMouseEnter={() => onHoverDerived?.(true)} onMouseLeave={() => onHoverDerived?.(false)}>
          <Badge variant="neutral" icon={<Link2 className="h-3 w-3" />}>
            {signal}
          </Badge>
        </span>
      )
  }
}

// ---------------------------------------------------------------------------
// Instrument type / exchange chips
// ---------------------------------------------------------------------------

const instrumentTypeClasses: Record<InstrumentType, string> = {
  EQ: 'text-text-secondary',
  FUT: 'text-neutral',
  CE: 'text-bullish',
  PE: 'text-bearish',
}

export function InstrumentTypeChip({ type }: { type: InstrumentType }) {
  return <span className={cn('font-mono text-[11px] font-medium', instrumentTypeClasses[type])}>{type}</span>
}

export function ExchangeChip({ exchange }: { exchange: 'NSE' | 'NFO' }) {
  return (
    <span className="rounded border border-border-hairline bg-surface px-1 py-px font-mono text-[10px] text-text-muted">
      {exchange}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export function TimeCell({ epochSeconds }: { epochSeconds: number }) {
  return <span className="font-mono tabular-nums text-text-secondary">{formatISTTime(new Date(epochSeconds * 1000))}</span>
}

// ---------------------------------------------------------------------------
// RSI: value + inline 0-100 bar with the BUY/SELL bands shaded
// ---------------------------------------------------------------------------

export type RsiBands = Pick<StrategyParams, 'rsiBuyLow' | 'rsiBuyHigh' | 'rsiSellLow' | 'rsiSellHigh'>

/**
 * `bands` are the params the scan is actually running with — after a
 * Parameters edit, shading the reference 35–40 / 60–65 would show bands the
 * strategy isn't using. Defaults to the reference strategy.
 */
export function RsiCell({ rsi, inherited, bands = DEFAULT_PARAMS }: { rsi: number; inherited?: string; bands?: RsiBands }) {
  if (Number.isNaN(rsi)) {
    return <span className="font-mono tabular-nums text-text-muted">—</span>
  }

  const content = (
    <span className={cn('inline-flex items-center gap-1.5', inherited && 'opacity-50')}>
      <span className="w-9 font-mono tabular-nums text-text-primary">{formatNumber(rsi, 1)}</span>
      <span className="relative h-[14px] w-16 overflow-hidden rounded-sm border border-border-hairline bg-surface">
        <span
          className="absolute inset-y-0 bg-bearish/25"
          style={{ left: `${bands.rsiSellLow}%`, width: `${bands.rsiSellHigh - bands.rsiSellLow}%` }}
          aria-hidden="true"
        />
        <span
          className="absolute inset-y-0 bg-bullish/25"
          style={{ left: `${bands.rsiBuyLow}%`, width: `${bands.rsiBuyHigh - bands.rsiBuyLow}%` }}
          aria-hidden="true"
        />
        <span
          className="absolute inset-y-0 w-[2px] bg-text-primary"
          style={{ left: `${Math.max(0, Math.min(100, rsi))}%` }}
          aria-hidden="true"
        />
      </span>
    </span>
  )

  if (!inherited) return content
  return (
    <Tooltip label={`inherited from underlying ${inherited}`} side="top">
      {content}
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// HA streak sparkline: last N HA candle colours
// ---------------------------------------------------------------------------

/**
 * Bars sit on a shared centre baseline and grow UP for green / DOWN for red
 * (mirroring how an actual up/down candle reads), rather than same-height
 * bars distinguished by colour alone — a colourblind viewer can still read
 * the streak shape, not just the aria-label.
 */
export function HaStreakSparkline({ colors }: { colors?: ('green' | 'red')[] }) {
  if (!colors || colors.length === 0) {
    return <span className="text-text-muted">—</span>
  }
  return (
    <span className="inline-flex h-4 items-center gap-px" aria-label={`Heikin-Ashi streak: ${colors.join(', ')}`}>
      {colors.map((color, i) => (
        <span key={i} className="flex h-full w-1 flex-col justify-center">
          <span className={cn('w-full rounded-[1px]', color === 'green' ? 'h-2.5 self-end bg-bullish' : 'h-1.5 self-start bg-bearish')} />
        </span>
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Level (breakout only)
// ---------------------------------------------------------------------------

export function LevelCell({ level }: { level?: number }) {
  if (level === undefined) return <span className="text-text-muted">—</span>
  return <span className="font-mono tabular-nums text-text-secondary">{formatINR(level)}</span>
}

// ---------------------------------------------------------------------------
// Price (static — the price the signal fired at)
// ---------------------------------------------------------------------------

export function PriceCell({ price }: { price: number }) {
  return <span className="font-mono tabular-nums text-text-primary">{formatINR(price)}</span>
}

// ---------------------------------------------------------------------------
// FlashSpan — the shared "flash background on change" presentational shell.
// LtpCell (below) drives it from its OWN internal before/after comparison;
// a caller that already knows (from elsewhere) whether THIS render should
// flash — e.g. SectorGrid, which computes flash direction once per card so
// it can cap how many rows flash at once — passes `flash` in directly
// instead. Either way the visual treatment is identical everywhere.
// ---------------------------------------------------------------------------

export interface FlashSpanProps {
  flash: 'up' | 'down' | null
  className?: string
  children: ReactNode
}

export function FlashSpan({ flash, className, children }: FlashSpanProps) {
  return (
    <span
      className={cn(
        'inline-block rounded px-1 font-mono tabular-nums transition-colors duration-300',
        flash === 'up' && 'bg-bullish/25',
        flash === 'down' && 'bg-bearish/25',
        className,
      )}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Live LTP — flashes green/red on change, background only, never reflows
// ---------------------------------------------------------------------------

export interface LtpCellProps {
  ltp: number | undefined
  /** How to render a defined value — defaults to ₹ currency (the /rsi-ha usage). /intraday's quote strip passes a plain-number formatter instead; the flash-on-change mechanism itself never changes. */
  format?: (value: number) => string
}

export function LtpCell({ ltp, format = formatINR }: LtpCellProps) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const prevRef = useRef(ltp)

  useEffect(() => {
    const prev = prevRef.current
    if (ltp !== undefined && prev !== undefined && ltp !== prev) {
      setFlash(ltp > prev ? 'up' : 'down')
      const timer = window.setTimeout(() => setFlash(null), FLASH_DURATION_MS)
      prevRef.current = ltp
      return () => window.clearTimeout(timer)
    }
    prevRef.current = ltp
  }, [ltp])

  return <FlashSpan flash={flash} className="text-text-primary">{ltp === undefined ? <span className="text-text-muted">—</span> : format(ltp)}</FlashSpan>
}

// ---------------------------------------------------------------------------
// Change % vs signal price
// ---------------------------------------------------------------------------

export function ChangePercentCell({ value, flash = null }: { value: number | null; flash?: 'up' | 'down' | null }) {
  if (value === null) return <span className="font-mono tabular-nums text-text-muted">—</span>
  const positive = value > 0
  const negative = value < 0
  return (
    <FlashSpan flash={flash} className={cn(positive && 'text-bullish', negative && 'text-bearish', !positive && !negative && 'text-text-secondary')}>
      {positive ? '+' : ''}
      {formatNumber(value, 2)}%
    </FlashSpan>
  )
}
