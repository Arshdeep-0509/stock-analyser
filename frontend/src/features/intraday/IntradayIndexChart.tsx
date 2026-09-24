import { Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  CAP_WEIGHT_CAVEAT,
  intradayIndex,
  intradayIndexTooltip,
  type IntradayIndexEntry,
  type IntradayIndexPriceBasis,
  type IntradayIndexWeighting,
} from '../../analytics/aggregate'
import { EmptyState, Tooltip } from '../../components/ui'
import type { IntradayStore } from '../../store/intradayStore'
import { cn } from '../../lib/cn'
import { formatNumber } from '../../lib/formatters'
import { useRenderCount } from '../../lib/renderCounter'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { CHART_FONT_PX, fillGroupWidth, svgScale, useSvgBox } from '../../lib/useSvgPx'

export interface IntradayIndexChartProps {
  store: IntradayStore
}

interface HoverState {
  entry: IntradayIndexEntry
}

/** Diverging axis gridlines land on every 0.5% — the spec's own choice, not a generic "nice number" step. */
const GRID_STEP = 0.5

/** Height (screen px) of the band around the zero line that holds the rotated sector labels. */
const LABEL_BAND_PX = 40
/** A "+1.2%" value label needs roughly this much group width (screen px) to sit over its bar without touching the next group's; narrower, the tooltip and sr-only table carry the value. */
const VALUE_LABEL_MIN_GROUP_PX = 34
/** Rough average glyph width as a fraction of font size. */
const GLYPH_WIDTH_EM = 0.6
/** Horizontal layout: hide the value label once the bar's percentage-of-track width drops below this — an in-line "±12.3%" label needs real room to sit next to a short bar without overlapping the track. */
const LABEL_HIDE_TRACK_PCT = 10

const WEIGHTING_OPTIONS: { value: IntradayIndexWeighting; label: string }[] = [
  { value: 'equal', label: 'Equal-weight' },
  { value: 'cap', label: 'Cap-weight (approx.)' },
]
const PRICE_BASIS_OPTIONS: { value: IntradayIndexPriceBasis; label: string }[] = [
  { value: 'prevClose', label: 'vs previous close' },
  { value: 'dayOpen', label: 'vs day open' },
]

function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

function formatSigned(value: number): string {
  if (Number.isNaN(value)) return '—'
  return `${value > 0 ? '+' : ''}${formatNumber(value, 1)}%`
}

function changeClass(value: number): string {
  if (Number.isNaN(value) || value === 0) return 'text-text-secondary'
  return value > 0 ? 'text-bullish' : 'text-bearish'
}

function IndexTooltip({
  entry,
  weighting,
  priceBasis,
}: {
  entry: IntradayIndexEntry
  weighting: IntradayIndexWeighting
  priceBasis: IntradayIndexPriceBasis
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-56 -translate-x-1/2 rounded border border-border bg-panel p-2 text-left text-[10px] shadow-lg"
    >
      <p className="font-medium text-text-primary">{entry.sector}</p>
      <p className="mt-0.5 text-text-secondary">
        Mean change <span className={cn('font-mono', changeClass(entry.meanChangePct))}>{formatSigned(entry.meanChangePct)}</span> ·{' '}
        {entry.count} names
      </p>
      {(entry.best || entry.worst) && (
        <div className="mt-1 space-y-0.5 border-t border-border-hairline pt-1 text-text-secondary">
          {entry.best && (
            <p className="flex justify-between gap-2">
              <span className="truncate text-text-primary">Best: {entry.best.row.symbol}</span>
              <span className={cn('shrink-0 font-mono', changeClass(entry.best.changePct))}>{formatSigned(entry.best.changePct)}</span>
            </p>
          )}
          {entry.worst && (
            <p className="flex justify-between gap-2">
              <span className="truncate text-text-primary">Worst: {entry.worst.row.symbol}</span>
              <span className={cn('shrink-0 font-mono', changeClass(entry.worst.changePct))}>{formatSigned(entry.worst.changePct)}</span>
            </p>
          )}
        </div>
      )}
      <p className="mt-1 border-t border-border-hairline pt-1 text-text-secondary">
        Breakout <span className="font-mono text-bullish">▲{entry.breakoutUpCount}</span> · BreakDown{' '}
        <span className="font-mono text-bearish">▼{entry.breakoutDownCount}</span>
      </p>
      <p className="mt-1 border-t border-border-hairline pt-1 text-text-muted">{intradayIndexTooltip(weighting, priceBasis)}</p>
    </div>
  )
}

/**
 * The wide diverging bar chart under the meter row — mean change per sector
 * (green above zero, red below), computed from the 1s `meterRows` snapshot via
 * analytics/aggregate.ts's intradayIndex(). Two controls change WHICH
 * number that mean is: weighting (equal vs. cap-weighted by cachedClose)
 * and price basis (vs. previous close vs. vs. today's open) — both are
 * local UI state, not global dashboard filters, since they change how this
 * one chart computes rather than which rows the rest of the page shows.
 * Switching either visibly reorders the bars, which is deliberate: it's the
 * clearest possible proof that this number is computed, not decorative.
 */
export function IntradayIndexChart({ store }: IntradayIndexChartProps) {
  // The 1s meter snapshot (meterRows), not live rows: this chart recomputes once a second, never per tick.
  useRenderCount('IntradayIndexChart')
  const rows = store((s) => s.meterRows)
  const activeSector = store((s) => s.filters.sector)
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const horizontal = useMediaQuery('(max-width: 479px)')
  const [weighting, setWeighting] = useState<IntradayIndexWeighting>('equal')
  const [priceBasis, setPriceBasis] = useState<IntradayIndexPriceBasis>('prevClose')
  const [hover, setHover] = useState<HoverState | null>(null)

  const entries = useMemo(() => intradayIndex(rows, { weighting, priceBasis }), [rows, weighting, priceBasis])
  const finiteEntries = entries.filter((e) => !Number.isNaN(e.meanChangePct))
  const rawMax = Math.max(0, ...finiteEntries.map((e) => Math.abs(e.meanChangePct)))
  // Symmetric, always a multiple of the grid step, never auto-scaled per side — a +1% sector and a -1% sector get equal visual weight.
  const axisMax = Math.max(GRID_STEP, Math.ceil(rawMax / GRID_STEP) * GRID_STEP)
  const transition = prefersReducedMotion ? 'none' : 'height 200ms ease, width 200ms ease'

  function toggleSector(sector: string): void {
    store.getState().setFilters({ sector: store.getState().filters.sector === sector ? null : sector })
  }

  function onKeyToggle(event: React.KeyboardEvent, sector: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleSector(sector)
    }
  }

  const weightLabel = weighting === 'cap' ? 'cap-weighted (approx.)' : 'equal-weighted'
  const basisLabel = priceBasis === 'dayOpen' ? "vs today's open" : 'vs previous close'
  const strongest = finiteEntries[0]
  const weakest = finiteEntries.length > 0 ? finiteEntries[finiteEntries.length - 1] : undefined
  const ariaLabel =
    `Intraday index by sector, ${entries.length} sectors, ${weightLabel}, ${basisLabel}.` +
    (strongest ? ` Strongest: ${strongest.sector} at ${formatSigned(strongest.meanChangePct)}.` : '') +
    (weakest && weakest !== strongest ? ` Weakest: ${weakest.sector} at ${formatSigned(weakest.meanChangePct)}.` : '')

  const controls = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <div role="radiogroup" aria-label="Weight by" className="inline-flex overflow-hidden rounded border border-border-hairline">
        {WEIGHTING_OPTIONS.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={weighting === opt.value}
            onClick={() => setWeighting(opt.value)}
            className={cn(
              'px-1.5 py-0.5 text-[10px] font-medium transition-colors',
              i > 0 && 'border-l border-border-hairline',
              weighting === opt.value ? 'bg-neutral/20 text-neutral' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {opt.label}
          </button>
        ))}
        <Tooltip label={CAP_WEIGHT_CAVEAT} side="bottom">
          <span className="flex items-center border-l border-border-hairline px-1 text-text-muted">
            <Info className="h-3 w-3" aria-label="What cap-weight (approx.) means here" />
          </span>
        </Tooltip>
      </div>

      <div role="radiogroup" aria-label="Price basis" className="inline-flex overflow-hidden rounded border border-border-hairline">
        {PRICE_BASIS_OPTIONS.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={priceBasis === opt.value}
            onClick={() => setPriceBasis(opt.value)}
            className={cn(
              'px-1.5 py-0.5 text-[10px] font-medium transition-colors',
              i > 0 && 'border-l border-border-hairline',
              priceBasis === opt.value ? 'bg-neutral/20 text-neutral' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {controls}
        <EmptyState title="No F&O names loaded yet." description="The intraday index will appear once the universe finishes loading." />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {controls}

      {horizontal ? (
        <HorizontalRows
          entries={entries}
          axisMax={axisMax}
          activeSector={activeSector}
          transition={transition}
          hover={hover}
          onHover={setHover}
          onToggle={toggleSector}
          onKeyToggle={onKeyToggle}
          ariaLabel={ariaLabel}
          weighting={weighting}
          priceBasis={priceBasis}
        />
      ) : (
        <VerticalDiverging
          entries={entries}
          axisMax={axisMax}
          activeSector={activeSector}
          transition={transition}
          hover={hover}
          onHover={setHover}
          onToggle={toggleSector}
          onKeyToggle={onKeyToggle}
          ariaLabel={ariaLabel}
          weighting={weighting}
          priceBasis={priceBasis}
        />
      )}

      {/* sr-only goes on a wrapper, never on the <table> itself: a table can't shrink below its content, so an sr-only TABLE still widened the page at 360px. */}
      <div className="sr-only">
        <table>
          <caption>Intraday index</caption>
          <thead>
            <tr>
              <th scope="col">Sector</th>
              <th scope="col">Mean change</th>
              <th scope="col">Names</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.sector}>
                <th scope="row">{entry.sector}</th>
                <td>{Number.isNaN(entry.meanChangePct) ? '—' : formatSigned(entry.meanChangePct)}</td>
                <td>{entry.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface LayoutProps {
  entries: IntradayIndexEntry[]
  axisMax: number
  activeSector: string | null
  transition: string
  hover: HoverState | null
  onHover: (h: HoverState | null) => void
  onToggle: (sector: string) => void
  onKeyToggle: (event: React.KeyboardEvent, sector: string) => void
  ariaLabel: string
  weighting: IntradayIndexWeighting
  priceBasis: IntradayIndexPriceBasis
}

function VerticalDiverging({
  entries,
  axisMax,
  activeSector,
  transition,
  hover,
  onHover,
  onToggle,
  onKeyToggle,
  ariaLabel,
  weighting,
  priceBasis,
}: LayoutProps) {
  const PLOT_H = 56
  const VALUE_BAND = 6
  const BOTTOM_BAND = 6
  const VIEW_H = VALUE_BAND + PLOT_H + BOTTOM_BAND
  const ZERO_Y = VALUE_BAND + PLOT_H / 2
  const { ref, size } = useSvgBox()
  // Height-bound chart: groups widen to fill the panel (capped so a few sectors don't become slabs), bars stay half their group.
  const GROUP_W = fillGroupWidth(size, VIEW_H, entries.length, 10, 40)
  const BAR_W = GROUP_W * 0.5
  const VIEW_W = Math.max(entries.length * GROUP_W, GROUP_W)
  const scale = svgScale(size, VIEW_W, VIEW_H)
  const px = (pixels: number): number => pixels / scale
  // A band around the zero line reserved for the rotated sector labels —
  // bars start just outside it, not at literal y=0. The sectors closest to
  // zero (whose bars would otherwise reach into this band) are, by
  // definition, the ones with the SHORTEST bars, so this band is exactly
  // where there's naturally the least bar to collide with. Sized in screen
  // pixels (capped at half the plot) so a legible label always fits in it.
  const LABEL_GAP = Math.min(PLOT_H / 2, px(LABEL_BAND_PX))
  const HALF_H = (PLOT_H - LABEL_GAP) / 2
  // How many characters of a -35° label fit along the band's diagonal at CHART_FONT_PX.
  const labelChars = Math.max(4, Math.floor((LABEL_GAP * scale) / Math.sin((35 * Math.PI) / 180) / (CHART_FONT_PX * GLYPH_WIDTH_EM)))
  // Value labels need both the vertical room (bar length) and the horizontal room (group width) to sit legibly.
  const valueLabelsFit = GROUP_W * scale >= VALUE_LABEL_MIN_GROUP_PX

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={ariaLabel}
        className="w-full overflow-visible"
        style={{ height: 200 }}
        preserveAspectRatio="xMinYMid meet"
      >
        {Array.from({ length: Math.floor(axisMax / GRID_STEP) + 1 }, (_, i) => i * GRID_STEP).map((v) => {
          const offset = (v / axisMax) * HALF_H
          return (
            <g key={v}>
              <line x1={0} y1={ZERO_Y - LABEL_GAP / 2 - offset} x2={VIEW_W} y2={ZERO_Y - LABEL_GAP / 2 - offset} className="stroke-border-hairline" strokeWidth={0.2} />
              {v > 0 && (
                <line x1={0} y1={ZERO_Y + LABEL_GAP / 2 + offset} x2={VIEW_W} y2={ZERO_Y + LABEL_GAP / 2 + offset} className="stroke-border-hairline" strokeWidth={0.2} />
              )}
            </g>
          )
        })}

        {entries.map((entry, i) => {
          const finite = !Number.isNaN(entry.meanChangePct)
          const magnitude = finite ? Math.min(Math.abs(entry.meanChangePct) / axisMax, 1) * HALF_H : 0
          const positive = entry.meanChangePct > 0
          const groupX = i * GROUP_W
          const active = activeSector === entry.sector
          const dimmed = activeSector !== null && !active
          const showLabel = finite && valueLabelsFit && magnitude * scale >= CHART_FONT_PX + 4

          const barY = positive ? ZERO_Y - LABEL_GAP / 2 - magnitude : ZERO_Y + LABEL_GAP / 2
          const labelY = positive ? barY - px(3) : barY + magnitude + px(CHART_FONT_PX + 1)

          return (
            <g
              key={entry.sector}
              transform={`translate(${groupX}, 0)`}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              aria-label={`Filter to ${entry.sector}, mean change ${finite ? formatSigned(entry.meanChangePct) : 'not available'}, ${entry.count} names`}
              onClick={() => onToggle(entry.sector)}
              onKeyDown={(e) => onKeyToggle(e, entry.sector)}
              onMouseEnter={() => onHover({ entry })}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover({ entry })}
              onBlur={() => onHover(null)}
              className="cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-neutral"
            >
              <title>{entry.sector}</title>
              <rect x={0.4} y={VALUE_BAND} width={GROUP_W - 0.8} height={PLOT_H} className={cn(active && 'fill-neutral/10')} />

              {finite ? (
                magnitude > 0 && (
                  <rect
                    x={(GROUP_W - BAR_W) / 2}
                    y={barY}
                    width={BAR_W}
                    height={magnitude}
                    rx={0.8}
                    className={cn(positive ? 'fill-bullish' : 'fill-bearish', dimmed && 'opacity-40')}
                    style={{ transition }}
                  />
                )
              ) : (
                <rect x={(GROUP_W - BAR_W) / 2} y={ZERO_Y - 0.3} width={BAR_W} height={0.6} className="fill-text-muted" />
              )}

              {showLabel && (
                <text x={GROUP_W / 2} y={labelY} textAnchor="middle" fontSize={px(CHART_FONT_PX)} className={cn('font-mono', positive ? 'fill-bullish' : 'fill-bearish')}>
                  {formatSigned(entry.meanChangePct)}
                </text>
              )}

              {/* Anchored at the band's BOTTOM edge and rising at -35°, so labelChars characters span exactly the band's height and never reach a bar. */}
              <text
                x={GROUP_W / 2}
                y={ZERO_Y + LABEL_GAP / 2 - px(3)}
                fontSize={px(CHART_FONT_PX)}
                textAnchor="end"
                transform={`rotate(-35, ${GROUP_W / 2}, ${ZERO_Y + LABEL_GAP / 2 - px(3)})`}
                className="fill-text-secondary"
              >
                {truncate(entry.sector, labelChars)}
              </text>
            </g>
          )
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
          <IndexTooltip entry={hover.entry} weighting={weighting} priceBasis={priceBasis} />
        </div>
      )}
    </div>
  )
}

function HorizontalRows({ entries, axisMax, activeSector, transition, hover, onHover, onToggle, onKeyToggle, ariaLabel, weighting, priceBasis }: LayoutProps) {
  return (
    <div className="flex flex-col gap-1.5" role="img" aria-label={ariaLabel}>
      {entries.map((entry) => {
        const finite = !Number.isNaN(entry.meanChangePct)
        const pct = finite ? Math.min(Math.abs(entry.meanChangePct) / axisMax, 1) * 50 : 0
        const positive = entry.meanChangePct > 0
        const active = activeSector === entry.sector
        const showLabel = finite && pct >= LABEL_HIDE_TRACK_PCT

        return (
          <div key={entry.sector} className="relative">
            <div
              role="button"
              tabIndex={0}
              aria-pressed={active}
              aria-label={`Filter to ${entry.sector}, mean change ${finite ? formatSigned(entry.meanChangePct) : 'not available'}, ${entry.count} names`}
              onClick={() => onToggle(entry.sector)}
              onKeyDown={(e) => onKeyToggle(e, entry.sector)}
              onMouseEnter={() => onHover({ entry })}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover({ entry })}
              onBlur={() => onHover(null)}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded px-0.5 py-0.5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-neutral',
                active && 'bg-neutral/10',
              )}
            >
              <span className="w-16 shrink-0 truncate text-[10px] text-text-secondary" title={entry.sector}>
                {entry.sector}
              </span>
              <span className="relative h-3 flex-1 overflow-visible rounded bg-border-hairline">
                <span className="absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden="true" />
                {finite && pct > 0 && (
                  <span
                    className={cn('absolute inset-y-0 rounded', positive ? 'left-1/2 bg-bullish' : 'right-1/2 bg-bearish')}
                    style={{ width: `${pct}%`, transition }}
                  />
                )}
                {!finite && <span className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded bg-text-muted" />}
              </span>
              <span className={cn('w-12 shrink-0 text-right font-mono text-[9px]', changeClass(entry.meanChangePct))}>
                {showLabel ? formatSigned(entry.meanChangePct) : finite ? '' : '—'}
              </span>
            </div>
            {hover?.entry.sector === entry.sector && (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center">
                <IndexTooltip entry={hover.entry} weighting={weighting} priceBasis={priceBasis} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
