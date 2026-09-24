import { useEffect, useMemo, useState } from 'react'
import { smartMoney, smartMoneyTooltip, SMART_MONEY_SUBTITLE, type SmartMoneyEntry } from '../../analytics/aggregate'
import { EmptyState } from '../../components/ui'
import type { IntradayStore } from '../../store/intradayStore'
import { cn } from '../../lib/cn'
import { formatNumber } from '../../lib/formatters'
import { useRenderCount } from '../../lib/renderCounter'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { CHART_FONT_PX, fillGroupWidth, svgScale, useSvgBox } from '../../lib/useSvgPx'

export interface SmartMoneyProps {
  store: IntradayStore
}

interface HoverState {
  entry: SmartMoneyEntry
}

/** ceil() with a floor of 1 — but the WHOLE axis stays integer-stepped (see integerTicks), never fractional gridlines on a count chart. */
function axisMaxFor(maxCount: number): number {
  return Math.max(1, Math.ceil(maxCount))
}

/** Integer-only tick values, however many the axis needs — a count can never be 2.5, so neither can a gridline. */
function integerTicks(axisMax: number, maxTicks = 4): number[] {
  const step = Math.max(1, Math.ceil(axisMax / maxTicks))
  const ticks: number[] = []
  for (let v = 0; v <= axisMax; v += step) ticks.push(v)
  return ticks
}

/** Group width bounds (viewBox units): stretched to fill the panel, but capped so a handful of bars never turn into slabs. */
const MIN_GROUP_W = 16
const MAX_GROUP_W = 34
const PLOT_H = 46
const LABEL_BAND = 16
const VALUE_BAND = 8
const AXIS_BAND = 10
const VIEW_H = VALUE_BAND + PLOT_H + LABEL_BAND
/** Rough average glyph width as a fraction of font size, for fitting a label into a bar group's pixel width. */
const GLYPH_WIDTH_EM = 0.6

function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

function SmartMoneyTooltip({ entry, minRvol, minZMove }: { entry: SmartMoneyEntry; minRvol: number; minZMove: number }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-56 -translate-x-1/2 rounded border border-border bg-panel p-2 text-left text-[10px] shadow-lg"
    >
      <p className="font-medium text-text-primary">{entry.sector}</p>
      <p className="mt-0.5 text-text-secondary">{smartMoneyTooltip(minRvol, minZMove)}</p>
      <ul className="mt-1 space-y-0.5 border-t border-border-hairline pt-1 text-text-secondary">
        {entry.matches.map((m) => (
          <li key={m.token} className="flex justify-between gap-2">
            <span className="truncate text-text-primary">{m.symbol}</span>
            <span className="font-mono">
              rvol {formatNumber(m.rvol, 1)} · z {m.zMove > 0 ? '+' : ''}
              {formatNumber(m.zMove, 1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * One vertical bar per sector, COUNT of names currently meeting BOTH the
 * rvol and |zMove| thresholds — top 5, descending, in the app's warning
 * (amber) token. "Smart money" is an easy label to over-read as seeing
 * real order flow, so the subtitle and tooltip both say plainly what this
 * actually is: a crowding count from price and volume only.
 */
export function SmartMoney({ store }: SmartMoneyProps) {
  // The 1s meter snapshot (meterRows), not live rows: this chart recomputes once a second, never per tick.
  useRenderCount('SmartMoney')
  const rows = store((s) => s.meterRows)
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [minRvol, setMinRvol] = useState(2)
  const [minZMove, setMinZMove] = useState(1)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [activeSector, setActiveSector] = useState<string | null>(null)

  const entries = useMemo(() => smartMoney(rows, { minRvol, minZMove }), [rows, minRvol, minZMove])

  // Clicking a bar filters to those SPECIFIC names, not the whole sector —
  // and stays live: if the qualifying set for the active sector changes
  // (a tick, a threshold edit), the filter tracks it rather than freezing
  // a stale token list.
  useEffect(() => {
    if (activeSector === null) return
    const entry = entries.find((e) => e.sector === activeSector)
    if (!entry || entry.matches.length === 0) {
      setActiveSector(null)
      store.getState().setFilters({ tokens: null })
      return
    }
    store.getState().setFilters({ tokens: entry.matches.map((m) => m.token) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSector, entries])

  function toggleSector(sector: string): void {
    if (activeSector === sector) {
      setActiveSector(null)
      store.getState().setFilters({ tokens: null })
    } else {
      setActiveSector(sector)
    }
  }

  function onKeyToggle(event: React.KeyboardEvent, sector: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleSector(sector)
    }
  }

  const transition = prefersReducedMotion ? 'none' : 'height 200ms ease'
  const maxCount = Math.max(0, ...entries.map((e) => e.count))
  const axisMax = axisMaxFor(maxCount)
  const ticks = integerTicks(axisMax)
  const { ref: svgRef, size } = useSvgBox()
  const GROUP_W = fillGroupWidth(size ? { width: size.width - AXIS_BAND * (size.height / VIEW_H), height: size.height } : null, VIEW_H, entries.length, MIN_GROUP_W, MAX_GROUP_W)
  const BAR_W = GROUP_W * 0.5
  const VIEW_W = AXIS_BAND + Math.max(entries.length * GROUP_W, GROUP_W)
  const svgScaleNow = svgScale(size, VIEW_W, VIEW_H)
  const px = (pixels: number): number => pixels / svgScaleNow
  // Sector labels are horizontal here, so they're cut to whatever fits the group's real pixel width at a legible size.
  const labelChars = Math.max(3, Math.floor((GROUP_W * svgScaleNow) / (CHART_FONT_PX * GLYPH_WIDTH_EM)))

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-1 text-[10px] text-text-secondary">
        rvol ≥
        <input
          type="number"
          min={0}
          step={0.5}
          value={minRvol}
          onChange={(e) => setMinRvol(Math.max(0, Number(e.target.value) || 0))}
          className="w-12 rounded border border-border-hairline bg-surface px-1 py-0.5 text-right font-mono text-text-primary"
          aria-label="Minimum rvol"
        />
      </label>
      <label className="flex items-center gap-1 text-[10px] text-text-secondary">
        |z-move| ≥
        <input
          type="number"
          min={0}
          step={0.5}
          value={minZMove}
          onChange={(e) => setMinZMove(Math.max(0, Number(e.target.value) || 0))}
          className="w-12 rounded border border-border-hairline bg-surface px-1 py-0.5 text-right font-mono text-text-primary"
          aria-label="Minimum absolute z-move"
        />
      </label>
    </div>
  )

  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[10px] text-text-secondary">{SMART_MONEY_SUBTITLE}</p>
        {controls}
        <EmptyState title="No F&O names loaded yet." description="Smart money counts will appear once the universe finishes loading." />
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[10px] text-text-secondary">{SMART_MONEY_SUBTITLE}</p>
        {controls}
        <EmptyState
          title={`No sector currently has a name above rvol ${minRvol} with a z-move above ${minZMove}.`}
          description="Loosen the thresholds to widen the net."
        />
      </div>
    )
  }


  const ariaLabel = `Smart money, ${entries.length} sectors qualifying rvol at least ${minRvol} and absolute z-move at least ${minZMove}. Highest count: ${entries[0]?.sector ?? 'none'} with ${entries[0]?.count ?? 0} names.`

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] text-text-secondary">{SMART_MONEY_SUBTITLE}</p>
      {controls}

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label={ariaLabel}
          className="w-full overflow-visible"
          style={{ height: 140 }}
          preserveAspectRatio="xMinYMid meet"
        >
          {ticks.map((tick) => {
            const y = VALUE_BAND + PLOT_H - (tick / axisMax) * PLOT_H
            return (
              <g key={tick}>
                <line x1={AXIS_BAND} y1={y} x2={VIEW_W} y2={y} className="stroke-border-hairline" strokeWidth={0.25} />
                <text x={AXIS_BAND - 1} y={y} dominantBaseline="middle" textAnchor="end" fontSize={px(CHART_FONT_PX)} className="fill-text-muted font-mono">
                  {tick}
                </text>
              </g>
            )
          })}

          {entries.map((entry, i) => {
            const barH = (entry.count / axisMax) * PLOT_H
            const groupX = AXIS_BAND + i * GROUP_W
            const active = activeSector === entry.sector
            const dimmed = activeSector !== null && !active

            return (
              <g
                key={entry.sector}
                transform={`translate(${groupX}, 0)`}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                aria-label={`Filter to the ${entry.count} qualifying names in ${entry.sector}`}
                onClick={() => toggleSector(entry.sector)}
                onKeyDown={(e) => onKeyToggle(e, entry.sector)}
                onMouseEnter={() => setHover({ entry })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ entry })}
                onBlur={() => setHover(null)}
                className="cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-neutral"
              >
                <title>{entry.sector}</title>
                <rect x={0.4} y={VALUE_BAND} width={GROUP_W - 0.8} height={PLOT_H} className={cn(active && 'fill-warning/10')} />

                <rect
                  x={(GROUP_W - BAR_W) / 2}
                  y={VALUE_BAND + PLOT_H - barH}
                  width={BAR_W}
                  height={barH}
                  rx={0.8}
                  className={cn('fill-warning', dimmed && 'opacity-40')}
                  style={{ transition }}
                />
                <text x={GROUP_W / 2} y={VALUE_BAND + PLOT_H - barH - 1.5} textAnchor="middle" fontSize={px(CHART_FONT_PX)} className="fill-text-secondary font-mono">
                  {entry.count}
                </text>

                <text x={GROUP_W / 2} y={VALUE_BAND + PLOT_H + px(CHART_FONT_PX + 4)} fontSize={px(CHART_FONT_PX)} textAnchor="middle" className="fill-text-secondary">
                  {truncate(entry.sector, labelChars)}
                </text>
              </g>
            )
          })}
        </svg>
        {hover && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
            <SmartMoneyTooltip entry={hover.entry} minRvol={minRvol} minZMove={minZMove} />
          </div>
        )}
      </div>

      {/* sr-only goes on a wrapper, never on the <table> itself: a table can't shrink below its content, so an sr-only TABLE still widened the page at 360px. */}
      <div className="sr-only">
        <table>
          <caption>Smart money</caption>
          <thead>
            <tr>
              <th scope="col">Sector</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.sector}>
                <th scope="row">{entry.sector}</th>
                <td>{entry.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
