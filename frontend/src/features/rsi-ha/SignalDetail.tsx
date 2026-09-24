import { Check, ChevronLeft, ChevronRight, Copy, Info, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { PanelErrorBoundary } from '../../components/ui/PanelErrorBoundary'
import { Skeleton } from '../../components/ui/Skeleton'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { formatINR, formatISTDate, formatISTTime, formatNumber } from '../../lib/formatters'
import type { ScreenerStore } from '../../store/screenerStore'
import type { ScreenerRow } from '../../store/types'
import { analyzeCandles } from '../../strategy/analyzeCandles'
import { parseIntervalMinutes } from '../../strategy/constants'
import { explainBreakout, explainSignal, type PredicateCheck } from '../../strategy/explainSignal'
import { haStreakLength } from '../../strategy/indicators'
import { BASE_INTERVAL_MINUTES, resampleCandles } from '../../strategy/resampleCandles'
import type { AnalyzedCandle, Candle } from '../../types/domain'
import { ExchangeChip, LtpCell, SignalBadge } from './cells'
import { CHART_HEIGHT_CLASS } from './chartHeight'
import { getInstrumentType, isDerivedRow } from './rowHelpers'
import { ChartSkeleton, LazySignalChart } from './LazySignalChart'

export interface SignalDetailProps {
  row: ScreenerRow | null
  rowList: readonly ScreenerRow[]
  store: ScreenerStore
  onClose: () => void
  onNavigate: (row: ScreenerRow) => void
}

const LAST_BARS_COUNT = 20

function checkLabel(check: PredicateCheck): string {
  switch (check.key) {
    case 'notEnoughCandles':
      return `Not enough candles to evaluate (have ${check.have}, need ${check.need})`
    case 'rsiUndefined':
      return `RSI(14) has not warmed up yet`
    case 'minPrice':
      return `Last close ${formatINR(check.close)} ${check.pass ? '>=' : '<'} minimum ${formatINR(check.minPrice)}`
    case 'rsiBand':
      if (check.pass) {
        return `RSI(14) = ${formatNumber(check.rsi, 2)} is within the ${check.band} band ${check.low}–${check.high}`
      }
      if (check.rsi < check.low) {
        return `RSI ${formatNumber(check.rsi, 2)} is ${formatNumber(check.low - check.rsi, 2)} below the ${check.band} band's lower bound ${check.low}`
      }
      return `RSI ${formatNumber(check.rsi, 2)} is ${formatNumber(check.rsi - check.high, 2)} above the ${check.band} band's upper bound ${check.high}`
    case 'haColor':
      return `Heikin-Ashi colour is ${check.actual.toUpperCase()}`
    case 'haStreak':
      return check.pass ? `HA streak length is exactly 2 (2nd confirming candle)` : `HA streak length is ${check.streak}, not exactly 2`
    case 'breakoutNotEnoughCandles':
      return `Not enough candles for a ${check.need - 1}-bar breakout lookback (have ${check.have}, need ${check.need})`
    case 'breakoutMinPrice':
      return `Last close ${formatINR(check.close)} ${check.pass ? '>=' : '<'} minimum ${formatINR(check.minPrice)}`
    case 'breakoutRange': {
      const label = check.direction === 'up' ? 'high' : 'low'
      const comparator = check.direction === 'up' ? (check.pass ? 'above' : 'not above') : check.pass ? 'below' : 'not below'
      return `Breakout: close ${formatINR(check.close)} is ${comparator} the ${check.lookback}-bar ${label} ${formatINR(check.level)}`
    }
  }
}

function CheckRow({ check }: { check: PredicateCheck }) {
  return (
    <li className={cn('flex items-start gap-2 py-1 text-sm', check.pass ? 'text-text-primary' : 'text-text-secondary')}>
      {check.pass ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bullish" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bearish" />}
      <span>{checkLabel(check)}</span>
    </li>
  )
}

function buildAnalysisMarkdown(row: ScreenerRow, checks: PredicateCheck[]): string {
  const lines = [
    `# ${row.symbol} — ${row.signal}`,
    '',
    `- Exchange: ${row.exchange}`,
    `- Time: ${formatISTDate(new Date(row.time * 1000))} ${formatISTTime(new Date(row.time * 1000))} IST`,
    `- Price at signal: ${formatINR(row.price)}`,
    `- RSI: ${Number.isNaN(row.rsi) ? 'n/a' : formatNumber(row.rsi, 2)}`,
    row.level !== undefined ? `- Level: ${formatINR(row.level)}` : null,
    '',
    '## Why this fired',
    ...checks.map((c) => `- [${c.pass ? 'x' : ' '}] ${checkLabel(c)}`),
  ].filter((line): line is string => line !== null)
  return lines.join('\n')
}

export function SignalDetail({ row, rowList, store, onClose, onNavigate }: SignalDetailProps) {
  const [candles, setCandles] = useState<Candle[] | null>(null)
  const [showRawOverlay, setShowRawOverlay] = useState(false)
  const params = store((s) => s.params)
  const liveLtp = store((s) => (row?.token ? s.liveLtp.get(row.token) : undefined))

  useEffect(() => {
    // Resets the chart to a loading state the instant the selected row
    // changes, so a stale chart from the PREVIOUS row never flashes while
    // this row's candles are still in flight.
    setCandles(null)
    if (!row) return
    // A CE/PE row's RSI and time are INHERITED from its underlying (see the
    // notice below), so the chart, its RSI panel and the last-bars table must
    // show the UNDERLYING's candles — charting the option's own series would
    // put an option RSI next to the underlying's inherited one. If the
    // underlying can't be resolved, show no chart rather than the wrong one.
    const source = isDerivedRow(row)
      ? (store.getState().universe.find((entry) => entry.symbol === row.derivedFrom) ?? null)
      : row.token
        ? { token: row.token, exchange: row.exchange }
        : null
    if (!source) {
      setCandles([])
      return
    }
    let cancelled = false
    const targetMinutes = parseIntervalMinutes(store.getState().params.candleInterval)
    void store
      .getState()
      .fetchCandlesForToken(source.token, source.exchange)
      .then((base) => {
        if (cancelled) return
        // Chart candles must go through the same resampling step the
        // scanner used to evaluate this row, or the chart could show a
        // different bar count/shape than what the signal was actually
        // computed from.
        setCandles(targetMinutes === BASE_INTERVAL_MINUTES ? base : resampleCandles(base, targetMinutes))
      })
    return () => {
      cancelled = true
    }
  }, [row?.id, row?.token, row?.exchange, store])

  if (!row) return null

  const analyzed: AnalyzedCandle[] = candles ? analyzeCandles(candles, params) : []
  const derived = isDerivedRow(row)
  const currentIndex = rowList.findIndex((r) => r.id === row.id)
  const prevRow = currentIndex > 0 ? rowList[currentIndex - 1] : null
  const nextRow = currentIndex >= 0 && currentIndex < rowList.length - 1 ? rowList[currentIndex + 1] : null

  const signalExplanation = analyzed.length > 0 ? explainSignal(analyzed, params) : null
  const breakoutExplanation = candles && candles.length > 0 ? explainBreakout(candles, params) : null

  const checks: PredicateCheck[] = [...(signalExplanation?.checks ?? []), ...(breakoutExplanation?.checks ?? [])]

  const change = liveLtp === undefined || row.price === 0 ? null : ((liveLtp - row.price) / row.price) * 100
  const lastBars = analyzed.slice(-LAST_BARS_COUNT)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-surface/70" onClick={onClose} />
      {/* min(640px, 100%): the fixed width never exceeds the viewport itself right at the sm breakpoint (480px < 640px). */}
      <div className="relative flex h-full w-full flex-col border-l border-border bg-panel sm:w-[min(640px,100%)]">
        {/* Header — sticky, with the prev/next/close nav buttons kept within thumb reach at the top rather than scrolling away. */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-panel px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-text-primary">{row.symbol}</h2>
              <ExchangeChip exchange={row.exchange} />
              <span className="text-xs text-text-muted">{getInstrumentType(row)}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <SignalBadge signal={row.signal} />
              <span className="font-mono text-xs tabular-nums text-text-secondary">
                {formatISTDate(new Date(row.time * 1000))} {formatISTTime(new Date(row.time * 1000))} IST
              </span>
            </div>
            <div className="mt-2 flex items-center gap-4 text-sm">
              <span className="text-text-secondary">
                Price at signal <span className="font-mono tabular-nums text-text-primary">{formatINR(row.price)}</span>
              </span>
              <span className="text-text-secondary">
                LTP <LtpCell ltp={liveLtp} />
                {change !== null && (
                  <span className={cn('ml-1 font-mono tabular-nums', change >= 0 ? 'text-bullish' : 'text-bearish')}>
                    ({change >= 0 ? '+' : ''}
                    {formatNumber(change, 2)}%)
                  </span>
                )}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" disabled={!prevRow} onClick={() => prevRow && onNavigate(prevRow)} aria-label="Previous signal">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" disabled={!nextRow} onClick={() => nextRow && onNavigate(nextRow)} aria-label="Next signal">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Chart */}
          <div className="border-b border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <Tooltip label="The in-progress bar is dropped before any calculation, exactly as the screener does — RSI/HA/signals are only ever computed on a closed candle." side="bottom">
                <span className="inline-flex cursor-help items-center gap-1 text-xs text-text-muted">
                  5-minute · last 5 sessions · forming candle excluded
                  <Info className="h-3 w-3" />
                </span>
              </Tooltip>
              <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                <input type="checkbox" checked={showRawOverlay} onChange={(e) => setShowRawOverlay(e.target.checked)} />
                Overlay raw OHLC
              </label>
            </div>

            {candles === null ? (
              <ChartSkeleton />
            ) : analyzed.length === 0 ? (
              <div className={cn('flex items-center justify-center text-xs text-text-muted', CHART_HEIGHT_CLASS)}>No candle history available</div>
            ) : (
              // Its own boundary, nested inside the outer Screener one — a
              // chart-library crash (bad candle data, a lightweight-charts
              // bug) should take out just this chart, not the whole drawer
              // or the table behind it.
              <PanelErrorBoundary panelName="Chart" diagnostics={() => ({ symbol: row.symbol, signal: row.signal })}>
                <LazySignalChart candles={candles} analyzed={analyzed} params={params} row={row} showRawOverlay={showRawOverlay} />
              </PanelErrorBoundary>
            )}
          </div>

          {/* Why this fired */}
          <div className="border-b border-border p-3">
            <h3 className="mb-1 text-sm font-medium text-text-primary">Why this fired</h3>
            {derived ? (
              <p className="text-sm text-text-secondary">
                {row.signal} is a recommendation derived from {row.derivedFrom}'s own BUY/SELL signal — RSI and time shown above are
                inherited from the underlying, not computed from this option's own candles (see STRATEGY-CONTRACT.md, PARITY note on
                add_option_recommendations()). See the underlying row's detail for its own checklist.
              </p>
            ) : checks.length > 0 ? (
              <ul>
                {checks.map((check, i) => (
                  <CheckRow key={i} check={check} />
                ))}
              </ul>
            ) : (
              <ul aria-label="Loading" role="status">
                {Array.from({ length: 4 }, (_, i) => (
                  <li key={i} className="flex items-center gap-2 py-1">
                    <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-full" />
                    <Skeleton className="h-3.5 flex-1" style={{ maxWidth: `${70 - i * 10}%` }} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Last 20 bars */}
          {lastBars.length > 0 && (
            <div className="p-3">
              <h3 className="mb-1 text-sm font-medium text-text-primary">Last {lastBars.length} bars</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-text-muted">
                      <th className="py-1 pr-2 font-normal">Time</th>
                      <th className="py-1 pr-2 text-right font-normal">Close</th>
                      <th className="py-1 pr-2 font-normal">HA</th>
                      <th className="py-1 pr-2 text-right font-normal">Streak</th>
                      <th className="py-1 text-right font-normal">RSI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastBars.map((bar) => {
                      const globalIndex = analyzed.indexOf(bar)
                      const { streak } = haStreakLength(analyzed, globalIndex)
                      const isSignalBar = bar.time === row.time
                      return (
                        <tr key={bar.time} className={cn('border-t border-border-hairline', isSignalBar && 'bg-neutral/10')}>
                          <td className="py-1 pr-2 font-mono tabular-nums text-text-secondary">{formatISTTime(new Date(bar.time * 1000))}</td>
                          <td className="py-1 pr-2 text-right font-mono tabular-nums text-text-primary">{formatNumber(bar.close, 2)}</td>
                          <td className="py-1 pr-2">
                            <span className={cn('inline-block h-2.5 w-2.5 rounded-full', bar.haColor === 'green' ? 'bg-bullish' : 'bg-bearish')} />
                          </td>
                          <td className="py-1 pr-2 text-right font-mono tabular-nums text-text-secondary">{streak}</td>
                          <td className="py-1 text-right font-mono tabular-nums text-text-primary">
                            {Number.isNaN(bar.rsi) ? '—' : formatNumber(bar.rsi, 2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void navigator.clipboard.writeText(buildAnalysisMarkdown(row, checks))}
          >
            <Copy className="h-3.5 w-3.5" /> Copy analysis
          </Button>
          <Tooltip label="Prototype — trading is not wired up" side="top">
            <span>
              <Button size="sm" variant="primary" disabled>
                Place order
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
