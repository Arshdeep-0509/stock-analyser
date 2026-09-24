import { useMemo, useState } from 'react'
import { sectorStrength, type SectorStrengthEntry } from '../../analytics/aggregate'
import { EmptyState } from '../../components/ui'
import type { IntradayStore } from '../../store/intradayStore'
import { cn } from '../../lib/cn'
import { formatNumber } from '../../lib/formatters'
import { useRenderCount } from '../../lib/renderCounter'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { CHART_FONT_PX, fillGroupWidth, svgScale, useSvgBox } from '../../lib/useSvgPx'

const TOP_N = 10
/** Narrowest a bar group may get (viewBox units); wider panels stretch groups to fill — see fillGroupWidth(). */
const MIN_GROUP_W = 9
const PLOT_H = 46
const LABEL_BAND = 20
const VALUE_BAND = 8
const VIEW_H = VALUE_BAND + PLOT_H + LABEL_BAND

export interface SectorStrengthProps {
  store: IntradayStore
}

interface HoverState {
  entry: SectorStrengthEntry
}

/** The same one-line Strength definition StrengthInfo's popover leads with — repeated here so the tooltip is self-contained, not just a reference to go find elsewhere. */
const STRENGTH_REMINDER = 'Strength = zMove × √rvol × persistence-factor — our own conviction metric, not a claim about direction.'

function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

function SectorTooltip({ entry }: { entry: SectorStrengthEntry }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-52 -translate-x-1/2 rounded border border-border bg-panel p-2 text-left text-[10px] shadow-lg"
    >
      <p className="font-medium text-text-primary">{entry.sector}</p>
      <p className="mt-0.5 text-text-secondary">
        Mean strength{' '}
        <span className="font-mono text-text-primary">{Number.isNaN(entry.meanStrength) ? '—' : formatNumber(entry.meanStrength, 1)}</span> ·{' '}
        {entry.count} names
      </p>
      {entry.topConstituents.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-t border-border-hairline pt-1 text-text-secondary">
          {entry.topConstituents.map((c) => (
            <li key={c.token} className="flex justify-between gap-2">
              <span className="truncate text-text-primary">{c.symbol}</span>
              <span className="font-mono">{formatNumber(c.strength, 1)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 border-t border-border-hairline pt-1 text-text-muted">{STRENGTH_REMINDER}</p>
    </div>
  )
}

/**
 * One vertical bar per sector, mean Strength, descending — top 10 sectors
 * with the rest folded into a final 'Others' bar (sectorStrength()'s own
 * topN option, so the fold is computed honestly from the real rows, never
 * a mean-of-means). A single accent colour throughout: this chart ranks
 * sectors against EACH OTHER on one measure, not two opposing directions
 * the way MarketMeter/IndexMeter do, so there's nothing for a second hue
 * to encode.
 */
export function SectorStrength({ store }: SectorStrengthProps) {
  // The 1s meter snapshot (meterRows), not live rows: this chart recomputes once a second, never per tick.
  useRenderCount('SectorStrength')
  const rows = store((s) => s.meterRows)
  const activeSector = store((s) => s.filters.sector)
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [hover, setHover] = useState<HoverState | null>(null)

  const entries = useMemo(() => sectorStrength(rows, { topN: TOP_N }), [rows])
  const finiteMeans = entries.map((e) => e.meanStrength).filter((v) => !Number.isNaN(v))
  const axisMax = Math.max(1, Math.ceil(Math.max(0, ...finiteMeans)))
  const transition = prefersReducedMotion ? 'none' : 'height 200ms ease'
  const { ref: svgRef, size } = useSvgBox()
  // The chart is height-bound: groups widen to fill the panel, bars stay a fixed share of their group.
  const GROUP_W = fillGroupWidth(size, VIEW_H, entries.length, MIN_GROUP_W)
  const BAR_W = GROUP_W * 0.55
  const VIEW_W = Math.max(entries.length * GROUP_W, GROUP_W)
  const scale = svgScale(size, VIEW_W, VIEW_H)
  const px = (pixels: number): number => pixels / scale

  function toggleSector(sector: string): void {
    store.getState().setFilters({ sector: store.getState().filters.sector === sector ? null : sector })
  }

  function onKeyToggle(event: React.KeyboardEvent, sector: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleSector(sector)
    }
  }

  if (rows.length === 0) {
    return <EmptyState title="No F&O names loaded yet." description="Sector strength will appear once the universe finishes loading." />
  }
  if (finiteMeans.length === 0) {
    return (
      <EmptyState
        title="No sector has enough session history for a Strength value yet."
        description="Strength needs at least 5 sessions of history per name — see the Strength column's own tooltip."
      />
    )
  }

  // Value labels only when a bar group can hold one at a legible size; the tooltip and sr-only table always carry it.
  const showValues = GROUP_W * scale >= 24

  const ariaLabel = `Sector strength, ${entries.length} sectors, sorted descending. Strongest: ${entries[0]?.sector ?? 'none'} at ${Number.isNaN(entries[0]?.meanStrength) ? 'no value' : formatNumber(entries[0].meanStrength, 1)}.`

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={ariaLabel}
          className="w-full overflow-visible"
          style={{ height: 150 }}
          preserveAspectRatio="xMinYMid meet"
        >
          <line x1={0} y1={VALUE_BAND + PLOT_H} x2={VIEW_W} y2={VALUE_BAND + PLOT_H} className="stroke-border-hairline" strokeWidth={0.3} />
          {entries.map((entry, i) => {
            const finite = !Number.isNaN(entry.meanStrength)
            const barH = finite ? (entry.meanStrength / axisMax) * PLOT_H : 0
            const groupX = i * GROUP_W
            const active = activeSector === entry.sector
            const dimmed = activeSector !== null && !active

            return (
              <g
                key={entry.sector}
                transform={`translate(${groupX}, 0)`}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                aria-label={`Filter to ${entry.sector}, mean strength ${finite ? formatNumber(entry.meanStrength, 1) : 'not available'}, ${entry.count} names`}
                onClick={() => toggleSector(entry.sector)}
                onKeyDown={(e) => onKeyToggle(e, entry.sector)}
                onMouseEnter={() => setHover({ entry })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ entry })}
                onBlur={() => setHover(null)}
                className="cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-neutral"
              >
                <title>{entry.sector}</title>
                <rect x={0.4} y={VALUE_BAND} width={GROUP_W - 0.8} height={PLOT_H} className={cn(active && 'fill-neutral/10')} />

                {finite ? (
                  <rect
                    x={(GROUP_W - BAR_W) / 2}
                    y={VALUE_BAND + PLOT_H - barH}
                    width={BAR_W}
                    height={Math.max(barH, 0.3)}
                    rx={0.8}
                    className={cn('fill-neutral', dimmed && 'opacity-40')}
                    style={{ transition }}
                  />
                ) : (
                  <rect
                    x={(GROUP_W - BAR_W) / 2}
                    y={VALUE_BAND + PLOT_H - 0.6}
                    width={BAR_W}
                    height={0.6}
                    className="fill-text-muted"
                  />
                )}
                <text x={GROUP_W / 2} y={VALUE_BAND + PLOT_H - barH - 1.5} textAnchor="middle" fontSize={px(CHART_FONT_PX)} className="fill-text-secondary font-mono">
                  {showValues ? (finite ? formatNumber(entry.meanStrength, 1) : '—') : ''}
                </text>

                <text
                  x={GROUP_W / 2}
                  y={VALUE_BAND + PLOT_H + 3}
                  fontSize={px(CHART_FONT_PX)}
                  textAnchor="end"
                  transform={`rotate(-45, ${GROUP_W / 2}, ${VALUE_BAND + PLOT_H + 3})`}
                  className="fill-text-secondary"
                >
                  {truncate(entry.sector, 12)}
                </text>
              </g>
            )
          })}
        </svg>
        {hover && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
            <SectorTooltip entry={hover.entry} />
          </div>
        )}
      </div>

      {/* sr-only goes on a wrapper, never on the <table> itself: a table can't shrink below its content, so an sr-only TABLE still widened the page at 360px. */}
      <div className="sr-only">
        <table>
          <caption>Sector strength</caption>
          <thead>
            <tr>
              <th scope="col">Sector</th>
              <th scope="col">Mean strength</th>
              <th scope="col">Names</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.sector}>
                <th scope="row">{entry.sector}</th>
                <td>{Number.isNaN(entry.meanStrength) ? '—' : formatNumber(entry.meanStrength, 1)}</td>
                <td>{entry.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
