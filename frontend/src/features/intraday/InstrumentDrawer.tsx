import { useRenderCount } from '../../lib/renderCounter'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, PanelErrorBoundary, Skeleton, StarMarker, StrengthCell } from '../../components/ui'
import { cn } from '../../lib/cn'
import { formatNumber } from '../../lib/formatters'
import { breakdownFromTerms } from '../../analytics/strength'
import { explainStrengthBreakdown, type StrengthExplanation } from '../../analytics/explainStrength'
import { matchesFilters, type IntradayStore } from '../../store/intradayStore'
import type { ScreenerStore } from '../../store/screenerStore'
import { analyzeCandles } from '../../strategy/analyzeCandles'
import { DEFAULT_PARAMS } from '../../strategy/constants'
import type { Candle, IntradayRow } from '../../types/domain'
import { ChangePercentCell, ExchangeChip, LtpCell, SignalBadge } from '../rsi-ha/cells'
import { CHART_HEIGHT_CLASS } from '../rsi-ha/chartHeight'
import { LazySignalChart } from '../rsi-ha/LazySignalChart'
import type { SignalChartRow } from '../rsi-ha/SignalChart'
import { BreakoutCell, IntradayDirCell } from './cells'

export interface InstrumentDrawerProps {
  store: IntradayStore
  /** Injected (not the app singleton imported directly) — same convention as `store` — so this can be unit-tested with a fake screener store, and so the "Screener status" join is provably reading the SAME data the /rsi-ha page itself would show, not a hidden second source. */
  screenerStore: ScreenerStore
}

const NO_ROWS: IntradayRow[] = []

/** Strength descending, NaN last — the SAME ordering TopStrengthTable defaults to, used here purely to define "the current filtered set" prev/next walks through (a row clicked from a different sort order still gets a well-defined neighbour, rather than none at all). */
function compareByStrengthDesc(a: IntradayRow, b: IntradayRow): number {
  const av = Number.isNaN(a.strength) ? -Infinity : a.strength
  const bv = Number.isNaN(b.strength) ? -Infinity : b.strength
  return bv - av
}

function DayRangeBar({ low, high, cmp }: { low: number; high: number; cmp: number }) {
  if (Number.isNaN(low) || Number.isNaN(high) || high <= low) {
    return <p className="text-xs text-text-muted">Day range not available yet.</p>
  }
  const pct = Math.max(0, Math.min(100, ((cmp - low) / (high - low)) * 100))
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs text-text-secondary">{formatNumber(low, 2)}</span>
      <span className="relative h-1.5 flex-1 rounded-full bg-border-hairline">
        <span
          className="absolute -top-1 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-panel bg-neutral"
          style={{ left: `${pct}%` }}
          aria-hidden="true"
        />
      </span>
      <span className="font-mono text-xs text-text-secondary">{formatNumber(high, 2)}</span>
    </div>
  )
}

interface StrengthFactor {
  key: string
  label: string
  value: string
  description: string
}

function factorsFor(explanation: StrengthExplanation): StrengthFactor[] {
  return [
    { key: 'strength', label: 'Strength', value: formatNumber(explanation.strength, 2), description: 'Overall conviction: zMove × √rvol × persistence-factor.' },
    { key: 'zMove', label: 'zMove', value: formatNumber(explanation.zMove, 2), description: "Today's move, sized against this stock's own usual daily volatility." },
    { key: 'sqrtRvol', label: '√rvol', value: formatNumber(explanation.sqrtRvol, 2), description: "Square root of today's volume vs. its typical volume at this time of day — dampens one huge print from dominating." },
    { key: 'persistenceFactor', label: 'Persistence-factor', value: formatNumber(explanation.persistenceFactor, 2), description: 'How one-directional today\'s bars have been, scaled to 0.5–1.0.' },
  ]
}

/**
 * Explains the row's OWN Strength from the terms computeIntradayRow() stored
 * on it (zMove / rvol / persistence) — never a re-derivation from a fresh
 * fetch, which used a different "now" and could print a different Strength
 * than the stat row right above it.
 */
function StrengthBreakdown({ row }: { row: IntradayRow }) {
  const explanation = explainStrengthBreakdown(breakdownFromTerms(row))

  if (Number.isNaN(explanation.strength)) {
    return <p className="text-sm text-text-secondary">{explanation.summary}</p>
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {factorsFor(explanation).map((factor) => (
        <li key={factor.key} className="flex items-start gap-2 text-sm">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral" aria-hidden="true" />
          <span>
            <span className="font-medium text-text-primary">{factor.label}</span>{' '}
            <span className="font-mono text-text-primary">{factor.value}</span>
            <span className="text-text-secondary"> — {factor.description}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

function ScreenerStatus({ baseSymbol, screenerStore }: { baseSymbol: string; screenerStore: ScreenerStore }) {
  const screenerRows = screenerStore((s) => s.rows)
  const match = screenerRows.find((r) => r.symbol.replace(/-EQ$/, '') === baseSymbol && (r.signal === 'BUY' || r.signal === 'SELL'))
  const screenerLink = `/rsi-ha?q=${encodeURIComponent(baseSymbol)}`

  return (
    <div className="flex flex-col gap-1.5">
      {match ? (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-text-secondary">
          Currently a <SignalBadge signal={match.signal} /> on the RSI-HA screener.
        </p>
      ) : (
        <p className="text-sm text-text-secondary">No active BUY/SELL from the RSI-HA strategy for this name right now.</p>
      )}
      <Link to={screenerLink} className="text-sm font-medium text-neutral hover:underline">
        {match ? 'Open on Screener →' : 'Check on Screener →'}
      </Link>
    </div>
  )
}

/**
 * The one drill-down drawer for every /intraday table — all of them just
 * call `store.getState().selectToken(token)` and this renders itself once,
 * at the page level, driven by `selectedToken`. Reuses rsi-ha's own
 * SignalChart (via SignalChartRow — see that file's own comment) for the
 * chart, so the 20-bar breakout level and now the VWAP line are drawn by
 * the SAME code /rsi-ha's own detail view uses, never a second
 * implementation of either.
 */
export function InstrumentDrawer({ store, screenerStore }: InstrumentDrawerProps) {
  useRenderCount('InstrumentDrawer')
  const selectedToken = store((s) => s.selectedToken)
  // Closed drawer = a constant empty list, so it never re-renders for tick flushes it isn't showing.
  const rows = store((s) => (s.selectedToken === null ? NO_ROWS : s.rows))
  const filters = store((s) => s.filters)
  const row = rows.find((r) => r.token === selectedToken) ?? null
  const [candles, setCandles] = useState<Candle[] | null>(null)
  const [showRawOverlay, setShowRawOverlay] = useState(false)
  const [showVwap, setShowVwap] = useState(true)

  useEffect(() => {
    // Resets to loading the instant the selection changes, so a stale chart
    // from the PREVIOUS row never flashes while this one's candles are still
    // in flight.
    setCandles(null)
    if (!row) return
    let cancelled = false
    void store
      .getState()
      .fetchCandlesForToken(row.token, row.exchange)
      .then((c) => {
        if (!cancelled) setCandles(c)
      })
    return () => {
      cancelled = true
    }
  }, [row?.token, row?.exchange, store])

  const orderedTokens = useMemo(
    () =>
      rows
        .filter((r) => matchesFilters(r, filters))
        .slice()
        .sort(compareByStrengthDesc)
        .map((r) => r.token),
    [rows, filters],
  )
  const currentIndex = row ? orderedTokens.indexOf(row.token) : -1
  const prevToken = currentIndex > 0 ? orderedTokens[currentIndex - 1] : null
  const nextToken = currentIndex >= 0 && currentIndex < orderedTokens.length - 1 ? orderedTokens[currentIndex + 1] : null

  if (!row) return null

  function close(): void {
    store.getState().selectToken(null)
  }

  const analyzed = candles ? analyzeCandles(candles, DEFAULT_PARAMS) : []
  // The chart's "signal bar" is the LAST CLOSED candle in this SAME series —
  // exactly the candle checkBreakout() itself evaluated against when
  // computeIntradayRow() set row.breakout, so the level line lands on the
  // right bar. row.lastTickAt is NOT used here: it can be `now` (a live
  // tick), which wouldn't match any candle's own time and would silently
  // fail to find the bar.
  const chartRow: SignalChartRow | null =
    candles && candles.length > 0
      ? { time: candles[candles.length - 1].time, signal: row.breakout ?? undefined, level: row.breakoutLevel ?? undefined }
      : null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-surface/70" onClick={close} />
      {/* min(720px, 100%): the fixed width never exceeds the viewport itself right at the sm breakpoint (480px < 720px). */}
      <div className="relative flex h-full w-full flex-col border-l border-border bg-panel sm:w-[min(720px,100%)]">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-panel px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StarMarker starred={row.starred} onToggle={() => store.getState().toggleStar(row.token)} />
              <h2 className="truncate text-base font-semibold text-text-primary">{row.symbol}</h2>
              <ExchangeChip exchange={row.exchange} />
              <span className="truncate text-xs text-text-muted">{row.sector}</span>
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="text-text-secondary">CMP</span>
              <LtpCell ltp={Number.isNaN(row.cmp) ? undefined : row.cmp} />
              <ChangePercentCell value={Number.isNaN(row.changePct) ? null : row.changePct} />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" disabled={!prevToken} onClick={() => prevToken && store.getState().selectToken(prevToken)} aria-label="Previous instrument">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" disabled={!nextToken} onClick={() => nextToken && store.getState().selectToken(nextToken)} aria-label="Next instrument">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={close} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Stat row */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border p-3 sm:grid-cols-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-muted">% Ch</p>
              <ChangePercentCell value={Number.isNaN(row.changePct) ? null : row.changePct} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-muted">3 Day Ch%</p>
              <ChangePercentCell value={Number.isNaN(row.change3dPct) ? null : row.change3dPct} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-muted">Strength</p>
              <StrengthCell value={row.strength} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-muted">rvol</p>
              <span className="font-mono text-sm tabular-nums text-text-primary">{Number.isNaN(row.rvol) ? '—' : formatNumber(row.rvol, 2)}</span>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-muted">VWAP</p>
              <LtpCell ltp={Number.isNaN(row.vwap) ? undefined : row.vwap} />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-muted">Intraday</p>
              <IntradayDirCell dir={row.intradayDir} />
            </div>
            {row.breakout !== null && (
              <div className="col-span-2 sm:col-span-3">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">Breakouts</p>
                <span className="flex items-center gap-1.5 text-sm text-text-secondary">
                  <BreakoutCell breakout={row.breakout} />
                  {row.breakout === 'BREAKOUT-UP' ? 'Breakout' : 'BreakDown'} at{' '}
                  <span className="font-mono text-text-primary">{row.breakoutLevel !== null ? formatNumber(row.breakoutLevel, 2) : '—'}</span>
                </span>
              </div>
            )}
            <div className="col-span-2 sm:col-span-3">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">Day range</p>
              <DayRangeBar low={row.dayLow} high={row.dayHigh} cmp={row.cmp} />
            </div>
          </div>

          {/* Chart */}
          <div className="border-b border-border p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-text-muted">5-minute · forming candle excluded</span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <input type="checkbox" checked={showVwap} onChange={(e) => setShowVwap(e.target.checked)} />
                  VWAP
                </label>
                <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <input type="checkbox" checked={showRawOverlay} onChange={(e) => setShowRawOverlay(e.target.checked)} />
                  Overlay raw OHLC
                </label>
              </div>
            </div>

            {candles === null ? (
              <ChartSkeleton />
            ) : chartRow === null ? (
              <div className={cn('flex items-center justify-center text-xs text-text-muted', CHART_HEIGHT_CLASS)}>No candle history available</div>
            ) : (
              <PanelErrorBoundary panelName="Chart" diagnostics={() => ({ symbol: row.symbol, breakout: row.breakout ?? 'none' })}>
                <LazySignalChart
                  candles={candles}
                  analyzed={analyzed}
                  params={DEFAULT_PARAMS}
                  row={chartRow}
                  showRawOverlay={showRawOverlay}
                  vwap={showVwap && !Number.isNaN(row.vwap) ? row.vwap : undefined}
                />
              </PanelErrorBoundary>
            )}
          </div>

          {/* How this Strength was computed */}
          <div className="border-b border-border p-3">
            <h3 className="mb-1.5 text-sm font-medium text-text-primary">How this Strength was computed</h3>
            <StrengthBreakdown row={row} />
          </div>

          {/* Screener status — the join between the two pages */}
          <div className="p-3">
            <h3 className="mb-1.5 text-sm font-medium text-text-primary">Screener status</h3>
            <ScreenerStatus baseSymbol={row.baseSymbol} screenerStore={screenerStore} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ChartSkeleton() {
  return (
    <div className={cn('flex flex-col justify-end gap-1 p-2', CHART_HEIGHT_CLASS)} aria-label="Loading chart" role="status">
      <div className="flex flex-1 items-end gap-1">
        {Array.from({ length: 24 }, (_, i) => (
          <Skeleton key={i} className="w-full" style={{ height: `${20 + ((i * 37) % 60)}%` }} />
        ))}
      </div>
      <Skeleton className="h-4 w-full" />
    </div>
  )
}
