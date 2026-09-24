import { useMemo, useState } from 'react'
import { indexMeter, type IndexMeterEntry } from '../../analytics/aggregate'
import { INDEX_PANELS } from '../../data/reference/indices'
import type { IndexKey } from '../../types/domain'
import type { IntradayStore } from '../../store/intradayStore'
import { cn } from '../../lib/cn'
import { formatNumber } from '../../lib/formatters'
import { useRenderCount } from '../../lib/renderCounter'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { CHART_FONT_PX, fillGroupWidth, svgScale, useSvgBox } from '../../lib/useSvgPx'

const THRESHOLD = 0.5

export interface IndexMeterProps {
  store: IntradayStore
}

function truncate(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

interface HoverState {
  entry: IndexMeterEntry
}

function GroupTooltip({ entry }: { entry: IndexMeterEntry }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-48 -translate-x-1/2 rounded border border-border bg-panel p-2 text-left text-[10px] shadow-lg"
    >
      <p className="font-medium text-text-primary">{entry.label}</p>
      <p className="mt-0.5 text-text-secondary">
        <span className="text-bullish">▲ {formatNumber(entry.upPct, 1)}%</span> · <span className="text-bearish">▼ {formatNumber(entry.downPct, 1)}%</span> ·{' '}
        {entry.count} names
      </p>
      {entry.topConstituents.length > 0 && (
        <ul className="mt-1 space-y-0.5 border-t border-border-hairline pt-1 text-text-secondary">
          {entry.topConstituents.map((c) => (
            <li key={c.token} className="flex justify-between gap-2">
              <span className="truncate text-text-primary">{c.symbol}</span>
              <span className="font-mono">{Number.isNaN(c.strength) ? '—' : formatNumber(c.strength, 1)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * A grouped vertical bar chart (green up% / red down% per index), switching
 * to horizontal bars below md, where a dense x-axis with ~12 categories
 * simply doesn't fit at 300px wide. Recomputes indexMeter() from the 1s `meterRows`
 * snapshot, same rationale as MarketMeter.
 */
export function IndexMeter({ store }: IndexMeterProps) {
  // The 1s meter snapshot (meterRows), not live rows: this chart recomputes once a second, never per tick.
  useRenderCount('IndexMeter')
  const rows = store((s) => s.meterRows)
  const activeIndex = store((s) => s.filters.index)
  // Cross-panel reactivity with MarketMeter: a direction filter set there
  // (clicking its Up/Down bar) de-emphasises the opposite-direction bar
  // here across every index, without changing the computed values — the
  // numbers stay honest, only the visual emphasis follows the filter.
  const direction = store((s) => s.filters.direction)
  const dimUpBars = direction === 'down'
  const dimDownBars = direction === 'up'
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const horizontal = useMediaQuery('(max-width: 767px)')
  const [hover, setHover] = useState<HoverState | null>(null)

  const entries = useMemo(() => {
    const computed = indexMeter(rows, INDEX_PANELS, THRESHOLD)
    return [...computed].sort((a, b) => b.upPct - a.upPct)
  }, [rows])

  const axisMax = Math.max(1, Math.ceil(Math.max(0, ...entries.map((e) => Math.max(e.upPct, e.downPct)))))
  const transition = prefersReducedMotion ? 'none' : 'height 200ms ease, width 200ms ease'

  function toggleIndex(key: IndexKey): void {
    store.getState().setFilters({ index: store.getState().filters.index === key ? null : key })
  }

  function onKeyToggle(event: React.KeyboardEvent, key: IndexKey): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      toggleIndex(key)
    }
  }

  const ariaLabel = `Index meter, ${entries.length} indices, sorted by advance percentage descending. Strongest: ${entries[0]?.label ?? 'none'} at ${formatNumber(entries[0]?.upPct ?? 0, 1)} percent up.`

  return (
    <div className="flex flex-col gap-2">
      {horizontal ? (
        <div className="flex flex-col gap-1.5" role="img" aria-label={ariaLabel}>
          {entries.map((entry) => {
            const upWidth = (entry.upPct / axisMax) * 100
            const downWidth = (entry.downPct / axisMax) * 100
            const active = activeIndex === entry.key
            return (
              <div key={entry.key} className="relative">
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  aria-label={`Filter to ${entry.label}, ${formatNumber(entry.upPct, 1)}% up, ${formatNumber(entry.downPct, 1)}% down, ${entry.count} names`}
                  onClick={() => toggleIndex(entry.key)}
                  onKeyDown={(e) => onKeyToggle(e, entry.key)}
                  onMouseEnter={() => setHover({ entry })}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover({ entry })}
                  onBlur={() => setHover(null)}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded px-0.5 py-0.5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-neutral',
                    active && 'bg-neutral/10',
                  )}
                >
                  <span className="w-14 shrink-0 truncate text-[10px] text-text-secondary" title={entry.label}>
                    {entry.label}
                  </span>
                  <span className="relative h-3 flex-1 overflow-visible rounded bg-border-hairline">
                    <span
                      className={cn(
                        'absolute inset-y-0 left-0 rounded bg-bullish',
                        ((active === false && activeIndex !== null) || dimUpBars) && 'opacity-40',
                      )}
                      style={{ width: `${upWidth}%`, transition }}
                    />
                  </span>
                  <span className="w-9 shrink-0 text-right font-mono text-[10px] text-bullish">{formatNumber(entry.upPct, 1)}%</span>
                  <span className="relative h-3 flex-1 overflow-visible rounded bg-border-hairline">
                    <span
                      className={cn(
                        'absolute inset-y-0 left-0 rounded bg-bearish',
                        ((active === false && activeIndex !== null) || dimDownBars) && 'opacity-40',
                      )}
                      style={{ width: `${downWidth}%`, transition }}
                    />
                  </span>
                  <span className="w-9 shrink-0 text-right font-mono text-[10px] text-bearish">{formatNumber(entry.downPct, 1)}%</span>
                </div>
                {hover?.entry.key === entry.key && <GroupTooltip entry={entry} />}
              </div>
            )
          })}
        </div>
      ) : (
        <VerticalGroups
          entries={entries}
          axisMax={axisMax}
          activeIndex={activeIndex}
          dimUpBars={dimUpBars}
          dimDownBars={dimDownBars}
          transition={transition}
          hover={hover}
          onHover={setHover}
          onToggle={toggleIndex}
          onKeyToggle={onKeyToggle}
          ariaLabel={ariaLabel}
        />
      )}

      {/* sr-only goes on a wrapper, never on the <table> itself: a table can't shrink below its content, so an sr-only TABLE still widened the page at 360px. */}
      <div className="sr-only">
        <table>
          <caption>Index meter</caption>
          <thead>
            <tr>
              <th scope="col">Index</th>
              <th scope="col">Up %</th>
              <th scope="col">Down %</th>
              <th scope="col">Constituents</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.key}>
                <th scope="row">{entry.label}</th>
                <td>{formatNumber(entry.upPct, 1)}%</td>
                <td>{formatNumber(entry.downPct, 1)}%</td>
                <td>{entry.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface VerticalGroupsProps {
  entries: IndexMeterEntry[]
  axisMax: number
  activeIndex: IndexKey | null
  dimUpBars: boolean
  dimDownBars: boolean
  transition: string
  hover: HoverState | null
  onHover: (h: HoverState | null) => void
  onToggle: (key: IndexKey) => void
  onKeyToggle: (event: React.KeyboardEvent, key: IndexKey) => void
  ariaLabel: string
}

function VerticalGroups({ entries, axisMax, activeIndex, dimUpBars, dimDownBars, transition, hover, onHover, onToggle, onKeyToggle, ariaLabel }: VerticalGroupsProps) {
  const PLOT_H = 46
  const LABEL_BAND = 22
  const VALUE_BAND = 8
  const VIEW_H = VALUE_BAND + PLOT_H + LABEL_BAND
  const { ref, size } = useSvgBox()
  // Groups widen to fill the panel (the chart is height-bound), bars stay a fixed share of their group.
  const GROUP_W = fillGroupWidth(size, VIEW_H, entries.length, 9)
  const BAR_W = GROUP_W * 0.38
  const VIEW_W = Math.max(entries.length * GROUP_W, GROUP_W)
  const scale = svgScale(size, VIEW_W, VIEW_H)
  const px = (pixels: number): number => pixels / scale
  // Per-bar values only when a group is wide enough to hold two of them side by side at a legible size; otherwise the tooltip and the sr-only table carry them.
  const showValues = GROUP_W * scale >= 30

  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={ariaLabel} className="w-full overflow-visible" style={{ height: 150 }} preserveAspectRatio="xMinYMid meet">
        <line x1={0} y1={VALUE_BAND + PLOT_H} x2={VIEW_W} y2={VALUE_BAND + PLOT_H} className="stroke-border-hairline" strokeWidth={0.3} />
        {entries.map((entry, i) => {
          const upH = (entry.upPct / axisMax) * PLOT_H
          const downH = (entry.downPct / axisMax) * PLOT_H
          const groupX = i * GROUP_W
          const active = activeIndex === entry.key
          const dimmed = activeIndex !== null && !active

          return (
            <g
              key={entry.key}
              transform={`translate(${groupX}, 0)`}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              aria-label={`Filter to ${entry.label}, ${formatNumber(entry.upPct, 1)}% up, ${formatNumber(entry.downPct, 1)}% down, ${entry.count} names`}
              onClick={() => onToggle(entry.key)}
              onKeyDown={(e) => onKeyToggle(e, entry.key)}
              onMouseEnter={() => onHover({ entry })}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover({ entry })}
              onBlur={() => onHover(null)}
              className="cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:outline-neutral"
            >
              <title>{entry.label}</title>
              <rect x={0.4} y={VALUE_BAND} width={GROUP_W - 0.8} height={PLOT_H} className={cn(active && 'fill-neutral/10')} />

              <rect
                x={(GROUP_W - BAR_W * 2 - 0.6) / 2}
                y={VALUE_BAND + PLOT_H - upH}
                width={BAR_W}
                height={upH}
                rx={0.6}
                className={cn('fill-bullish', (dimmed || dimUpBars) && 'opacity-40')}
                style={{ transition }}
              />
              <text
                x={(GROUP_W - BAR_W * 2 - 0.6) / 2 + BAR_W / 2}
                y={VALUE_BAND + PLOT_H - upH - 1.5}
                textAnchor="middle"
                fontSize={px(CHART_FONT_PX)}
                className="fill-text-secondary font-mono"
              >
                {showValues ? formatNumber(entry.upPct, 0) : ''}
              </text>

              <rect
                x={(GROUP_W - BAR_W * 2 - 0.6) / 2 + BAR_W + 0.6}
                y={VALUE_BAND + PLOT_H - downH}
                width={BAR_W}
                height={downH}
                rx={0.6}
                className={cn('fill-bearish', (dimmed || dimDownBars) && 'opacity-40')}
                style={{ transition }}
              />
              <text
                x={(GROUP_W - BAR_W * 2 - 0.6) / 2 + BAR_W + 0.6 + BAR_W / 2}
                y={VALUE_BAND + PLOT_H - downH - 1.5}
                textAnchor="middle"
                fontSize={px(CHART_FONT_PX)}
                className="fill-text-secondary font-mono"
              >
                {showValues ? formatNumber(entry.downPct, 0) : ''}
              </text>

              <text
                x={GROUP_W / 2}
                y={VALUE_BAND + PLOT_H + 3}
                fontSize={px(CHART_FONT_PX)}
                textAnchor="end"
                transform={`rotate(-45, ${GROUP_W / 2}, ${VALUE_BAND + PLOT_H + 3})`}
                className="fill-text-secondary"
              >
                {truncate(entry.label, 10)}
              </text>
            </g>
          )
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
          <GroupTooltip entry={hover.entry} />
        </div>
      )}
    </div>
  )
}
