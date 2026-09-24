import { useMemo, useState } from 'react'
import { marketMeter } from '../../analytics/aggregate'
import { INDEX_PANELS } from '../../data/reference/indices'
import { matchesFilters, type IntradayStore } from '../../store/intradayStore'
import { cn } from '../../lib/cn'
import { formatNumber } from '../../lib/formatters'
import { useRenderCount } from '../../lib/renderCounter'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useSvgBox } from '../../lib/useSvgPx'

const THRESHOLD_OPTIONS = [0.25, 0.5, 1, 2] as const
type ThresholdOption = (typeof THRESHOLD_OPTIONS)[number]

/** ceil() with a floor of 1, so a totally flat day never produces a degenerate 0-0 axis. */
function axisMaxFor(upPct: number, downPct: number): number {
  return Math.max(1, Math.ceil(Math.max(upPct, downPct)))
}

export interface MarketMeterProps {
  store: IntradayStore
}

/**
 * Two horizontal bars (Up above Down) sharing one axis, scaled to the
 * larger of the two values rounded up — never a fixed 0-100 — so a quiet
 * day still shows readable bar lengths instead of two slivers. The
 * threshold control recomputes marketMeter() from `meterRows` (the store's
 * 1s snapshot), not from the precomputed `meters.marketMeter`, so a
 * threshold change is immediate while live ticks still land at most once a
 * second.
 *
 * This is a "meter" (context), not a table: it always computes over the
 * WHOLE market, never narrows to another chart's active filter — instead,
 * when a filter IS active, a second, brighter marker on each bar shows
 * where that filtered slice sits within the whole-market picture. Isolating
 * the bars to the filtered subset would mean this meter could never again
 * answer "how does the thing I clicked compare to everything else", which
 * is the whole point of keeping it un-narrowed.
 */
export function MarketMeter({ store }: MarketMeterProps) {
  // The 1s meter snapshot (meterRows), not live rows: this chart recomputes once a second, never per tick.
  useRenderCount('MarketMeter')
  const rows = store((s) => s.meterRows)
  const filters = store((s) => s.filters)
  const direction = filters.direction
  const [threshold, setThreshold] = useState<ThresholdOption>(0.5)
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const { ref: svgRef, size: svgSize } = useSvgBox()

  // `direction` is excluded from the highlighted slice itself (this chart is
  // what DEFINES direction; scoping the slice by its own output would zero
  // out whichever bar isn't currently selected).
  const isScoped = filters.sector !== null || filters.index !== null || filters.tokens !== null || filters.smartMoneyOnly
  const scopedRows = useMemo(
    () => (isScoped ? rows.filter((r) => matchesFilters(r, { ...filters, direction: 'all' })) : rows),
    [rows, filters, isScoped],
  )
  const universeLabel =
    filters.sector ??
    (filters.index ? INDEX_PANELS.find((p) => p.key === filters.index)?.label : undefined) ??
    (filters.tokens ? `${filters.tokens.length} selected` : undefined) ??
    (filters.smartMoneyOnly ? 'smart money' : undefined)

  const result = useMemo(() => marketMeter(rows, threshold), [rows, threshold])
  const scopedResult = useMemo(() => (isScoped ? marketMeter(scopedRows, threshold) : null), [isScoped, scopedRows, threshold])
  const axisMax = axisMaxFor(result.upPct, result.downPct)

  const BAR_H = 13
  const GAP = 9
  const LABEL_MARGIN = 34
  const VIEW_H = BAR_H * 2 + GAP
  // The viewBox matches the box's real aspect ratio (height-bound, uniform scale), so the track stretches with the panel but text never does —
  // the old preserveAspectRatio="none" stretched "UP" and the percentages sideways.
  const VIEW_W = svgSize ? Math.max(LABEL_MARGIN + 40, svgSize.width / (svgSize.height / VIEW_H)) : 134
  const TRACK = VIEW_W - LABEL_MARGIN

  const upWidth = (result.upPct / axisMax) * TRACK
  const downWidth = (result.downPct / axisMax) * TRACK
  // The highlighted slice's OWN share, positioned on the SAME whole-market
  // axis — never re-scaled to its own smaller total, or it would be
  // impossible to see whether the slice over- or under-represents the move.
  const scopedUpWidth = scopedResult ? (scopedResult.upPct / axisMax) * TRACK : 0
  const scopedDownWidth = scopedResult ? (scopedResult.downPct / axisMax) * TRACK : 0
  const transition = prefersReducedMotion ? 'none' : 'width 200ms ease'

  function toggleDirection(target: 'up' | 'down'): void {
    store.getState().setFilters({ direction: store.getState().filters.direction === target ? 'all' : target })
  }

  function onKeyToggle(event: React.KeyboardEvent, target: 'up' | 'down'): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleDirection(target)
    }
  }

  const ariaLabel =
    `Market meter, whole F&O universe. ${formatNumber(result.upPct, 1)} percent of ${result.total} names up more than ${threshold} percent, ${formatNumber(result.downPct, 1)} percent down.` +
    (scopedResult
      ? ` Highlighted slice (${universeLabel}): ${formatNumber(scopedResult.upPct, 1)} percent of ${scopedResult.total} up, ${formatNumber(scopedResult.downPct, 1)} percent down.`
      : '')

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Move threshold</span>
        <div role="radiogroup" aria-label="Move threshold" className="inline-flex overflow-hidden rounded border border-border-hairline">
          {THRESHOLD_OPTIONS.map((opt, i) => (
            <button
              key={opt}
              type="button"
              role="radio"
              aria-checked={threshold === opt}
              onClick={() => setThreshold(opt)}
              className={cn(
                'px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors',
                i > 0 && 'border-l border-border-hairline',
                threshold === opt ? 'bg-neutral/20 text-neutral' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {opt}%
            </button>
          ))}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={ariaLabel}
        className="w-full overflow-visible"
        style={{ height: 56 }}
        preserveAspectRatio="xMinYMid meet"
      >
        {/* Up row */}
        <g
          role="button"
          tabIndex={0}
          aria-pressed={direction === 'up'}
          aria-label={`Filter to advancing names, ${result.upCount} of ${result.total}`}
          onClick={() => toggleDirection('up')}
          onKeyDown={(e) => onKeyToggle(e, 'up')}
          className="cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-neutral"
        >
          <rect x={0} y={0} width={TRACK} height={BAR_H} rx={3} className="fill-border-hairline" />
          <rect
            x={0}
            y={0}
            width={upWidth}
            height={BAR_H}
            rx={3}
            className={cn('fill-bullish', direction === 'down' && 'opacity-40')}
            style={{ transition }}
          />
          {scopedResult && (
            <rect x={Math.max(0, scopedUpWidth - 0.6)} y={-1.5} width={1.2} height={BAR_H + 3} className="fill-text-primary" style={{ transition }} />
          )}
          <text x={TRACK + 2} y={BAR_H / 2} dominantBaseline="middle" fontSize={7.5} className="fill-text-primary font-mono">
            {formatNumber(result.upPct, 1)}%
          </text>
          <text x={2} y={BAR_H / 2} dominantBaseline="middle" fontSize={6} className="fill-surface font-medium uppercase">
            Up
          </text>
        </g>

        {/* Down row */}
        <g
          role="button"
          tabIndex={0}
          aria-pressed={direction === 'down'}
          aria-label={`Filter to declining names, ${result.downCount} of ${result.total}`}
          onClick={() => toggleDirection('down')}
          onKeyDown={(e) => onKeyToggle(e, 'down')}
          transform={`translate(0, ${BAR_H + GAP})`}
          className="cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-neutral"
        >
          <rect x={0} y={0} width={TRACK} height={BAR_H} rx={3} className="fill-border-hairline" />
          <rect
            x={0}
            y={0}
            width={downWidth}
            height={BAR_H}
            rx={3}
            className={cn('fill-bearish', direction === 'up' && 'opacity-40')}
            style={{ transition }}
          />
          {scopedResult && (
            <rect x={Math.max(0, scopedDownWidth - 0.6)} y={-1.5} width={1.2} height={BAR_H + 3} className="fill-text-primary" style={{ transition }} />
          )}
          <text x={TRACK + 2} y={BAR_H / 2} dominantBaseline="middle" fontSize={7.5} className="fill-text-primary font-mono">
            {formatNumber(result.downPct, 1)}%
          </text>
          <text x={2} y={BAR_H / 2} dominantBaseline="middle" fontSize={6} className="fill-surface font-medium uppercase">
            Down
          </text>
        </g>
      </svg>

      <p className="text-xs leading-relaxed text-text-secondary">
        <span className="font-mono text-text-primary">{result.upCount}</span> of{' '}
        <span className="font-mono text-text-primary">{result.total}</span> F&O names up more than {threshold}%,{' '}
        <span className="font-mono text-text-primary">{result.downCount}</span> down more than {threshold}%,{' '}
        <span className="font-mono text-text-primary">{result.flatCount}</span> flat.
        {scopedResult && (
          <>
            {' '}
            Of these, <span className="font-mono text-text-primary">{scopedResult.upCount}</span> of{' '}
            <span className="font-mono text-text-primary">{scopedResult.total}</span> {universeLabel} names are up,{' '}
            <span className="font-mono text-text-primary">{scopedResult.downCount}</span> down (marked on the bars above).
          </>
        )}
      </p>

      {/* sr-only goes on a wrapper, never on the <table> itself: a table can't shrink below its content, so an sr-only TABLE still widened the page at 360px. */}
      <div className="sr-only">
        <table>
          <caption>Market meter</caption>
          <thead>
            <tr>
              <th scope="col">Direction</th>
              <th scope="col">Percent</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Up</th>
              <td>{formatNumber(result.upPct, 1)}%</td>
              <td>{result.upCount}</td>
            </tr>
            <tr>
              <th scope="row">Down</th>
              <td>{formatNumber(result.downPct, 1)}%</td>
              <td>{result.downCount}</td>
            </tr>
            <tr>
              <th scope="row">Flat</th>
              <td>—</td>
              <td>{result.flatCount}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
