import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useRenderCount } from '../../lib/renderCounter'
import { breakoutCountsBySector, type BreakoutCountEntry, type BreakoutDirection } from '../../analytics/aggregate'
import { Button, EmptyState, StarMarker, StrengthCell, StrengthInfo } from '../../components/ui'
import { cn } from '../../lib/cn'
import { formatISTTime } from '../../lib/formatters'
import { DEFAULT_PARAMS } from '../../strategy/constants'
import { matchesFilters, type IntradayStore } from '../../store/intradayStore'
import type { IntradayRow } from '../../types/domain'
import { ChangePercentCell } from '../rsi-ha/cells'
import { BreakoutCell, IntradayDirCell } from './cells'
import { activeFilterChips } from './filterChips'
import { Panel } from './Panel'

export interface BreakoutPanelsProps {
  store: IntradayStore
}

interface PanelConfig {
  title: string
  accent: 'bullish' | 'bearish'
  tone: 'bullish' | 'bearish'
  emptyTitle: string
}

const PANEL_CONFIG: Record<BreakoutDirection, PanelConfig> = {
  'BREAKOUT-UP': {
    title: 'Breakout ▲',
    accent: 'bullish',
    tone: 'bullish',
    emptyTitle: 'No instrument has closed above its 20-bar high since 09:15. The panel fills as the session develops.',
  },
  'BREAKOUT-DOWN': {
    title: 'BreakDown ▼',
    accent: 'bearish',
    tone: 'bearish',
    emptyTitle: 'No instrument has closed below its 20-bar low since 09:15. The panel fills as the session develops.',
  },
}

const TABLE_GRID = '20px 108px 92px 62px 68px 66px 44px 44px'
const TABLE_MIN_WIDTH = 504 // sum of TABLE_GRID's columns — narrower than this, the table scrolls horizontally within its own 2/3 column rather than squeezing (or bleeding into the chart column beside it).

/** Strength descending, then |%Ch| descending — a fixed sort (no user control), matching the reference's own ranking for these two panels. NaN is mapped to -Infinity so it always sorts last regardless of how everything else compares, the same invariant every other /intraday table upholds. */
function compareBreakoutRows(a: IntradayRow, b: IntradayRow): number {
  const aStrength = Number.isNaN(a.strength) ? -Infinity : a.strength
  const bStrength = Number.isNaN(b.strength) ? -Infinity : b.strength
  if (aStrength !== bStrength) return bStrength - aStrength

  const aChange = Number.isNaN(a.changePct) ? -Infinity : Math.abs(a.changePct)
  const bChange = Number.isNaN(b.changePct) ? -Infinity : Math.abs(b.changePct)
  return bChange - aChange
}

function CountBadge({ count, tone }: { count: number; tone: 'bullish' | 'bearish' }) {
  return (
    <span
      className={cn(
        'rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-medium',
        tone === 'bullish' ? 'border-bullish/40 text-bullish' : 'border-bearish/40 text-bearish',
      )}
    >
      {count}
    </span>
  )
}

function SectorCountBars({
  entries,
  tone,
  activeSector,
  onToggle,
}: {
  entries: BreakoutCountEntry[]
  tone: 'bullish' | 'bearish'
  activeSector: string | null
  onToggle: (sector: string) => void
}) {
  if (entries.length === 0) {
    return <p className="p-2 text-[10px] text-text-muted">No sector has a breakout yet.</p>
  }

  const maxCount = Math.max(1, ...entries.map((e) => e.count))
  const ariaLabel = `Breakouts by sector, ${entries.length} sectors, descending. Highest: ${entries[0].sector} with ${entries[0].count}.`

  return (
    <div className="flex flex-col gap-1.5 p-2" role="img" aria-label={ariaLabel}>
      {entries.map((entry) => {
        const pct = (entry.count / maxCount) * 100
        const active = activeSector === entry.sector
        const dimmed = activeSector !== null && !active
        return (
          <button
            key={entry.sector}
            type="button"
            aria-pressed={active}
            aria-label={`Filter to ${entry.sector}, ${entry.count} breakout${entry.count === 1 ? '' : 's'}`}
            onClick={() => onToggle(entry.sector)}
            className={cn(
              'flex items-center gap-1.5 rounded px-0.5 py-0.5 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-neutral',
              active && 'bg-neutral/10',
            )}
          >
            <span className="w-16 shrink-0 truncate text-[10px] text-text-secondary" title={entry.sector}>
              {entry.sector}
            </span>
            <span className="relative h-3 flex-1 overflow-visible rounded bg-border-hairline">
              <span
                className={cn('absolute inset-y-0 left-0 rounded', tone === 'bullish' ? 'bg-bullish' : 'bg-bearish', dimmed && 'opacity-40')}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="w-4 shrink-0 text-right font-mono text-[10px] text-text-secondary">{entry.count}</span>
          </button>
        )
      })}
    </div>
  )
}

function BreakoutPanel({ store, direction }: { store: IntradayStore; direction: BreakoutDirection }) {
  useRenderCount(`BreakoutPanel:${direction}`)
  // Per-panel selector: only THIS direction's rows. useShallow + immer's
  // structural sharing means a tick on a non-breakout name never re-renders
  // this panel at all.
  const directionRows = store(useShallow((s) => s.rows.filter((r) => r.breakout === direction)))
  const filters = store((s) => s.filters)
  const lastComputedAt = store((s) => s.lastComputedAt)
  const selectedToken = store((s) => s.selectedToken)
  const universeSize = store((s) => s.rows.length)
  const headerBreakoutCount = store((s) => (direction === 'BREAKOUT-UP' ? s.meters.headerCounts.breakoutUpCount : s.meters.headerCounts.breakoutDownCount))

  const config = PANEL_CONFIG[direction]

  // The companion chart summarises the WHOLE breakout population for this
  // direction (same rationale as SmartMoney/SectorStrength: a chart that
  // sets the sector filter must never be scoped BY that same filter, or
  // clicking a bar would make it vanish on the next render).
  // breakoutCountsBySector() filters to `direction` itself, so feeding it the pre-filtered rows is identical.
  const sectorEntries = useMemo(() => breakoutCountsBySector(directionRows, direction), [directionRows, direction])

  const visibleRows = useMemo(() => directionRows.filter((r) => matchesFilters(r, filters)), [directionRows, filters])
  const sortedRows = useMemo(() => visibleRows.slice().sort(compareBreakoutRows), [visibleRows])

  const chips = activeFilterChips(filters)
  const filteredToZero = directionRows.length > 0 && sortedRows.length === 0

  // Dev-only invariant: this panel's own count (filtered straight from
  // `rows`) must always equal the throttled headerCounts value QuoteStrip
  // shows, because both are the same `r.breakout === direction` predicate
  // over the same universe. A brief (<1s) mismatch right after a bar close
  // is possible — `rows` updates synchronously, `meters.headerCounts`
  // catches up on its own 1s throttle — so this only really means something
  // if it persists.
  if (import.meta.env?.DEV && directionRows.length !== headerBreakoutCount) {
    console.warn(
      `[BreakoutPanels] ${direction} count mismatch: panel computed ${directionRows.length}, header strip says ${headerBreakoutCount}. Transient (<1s after a bar close) is expected; persistent is a bug.`,
    )
  }

  function toggleSector(sector: string): void {
    store.getState().setFilters({ sector: filters.sector === sector ? null : sector })
  }

  function toggleSelect(token: string): void {
    store.getState().selectToken(selectedToken === token ? null : token)
  }

  const checkedAtLabel = lastComputedAt !== null ? formatISTTime(new Date(lastComputedAt * 1000)) : '—'

  return (
    <Panel title={config.title} accent={config.accent} live={universeSize > 0} toolbar={<CountBadge count={headerBreakoutCount} tone={config.tone} />}>
      <div className="flex flex-col gap-3 md:flex-row">
        <div className="min-w-0 md:w-2/3">
          {chips.length > 0 && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => store.getState().setFilters(chip.clear)}
                  className="inline-flex items-center gap-1 rounded-full border border-border-hairline bg-surface px-2 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
                >
                  {chip.label}
                  <span aria-hidden="true">×</span>
                  <span className="sr-only">Clear this filter</span>
                </button>
              ))}
            </div>
          )}

          {directionRows.length === 0 ? (
            <EmptyState
              title={config.emptyTitle}
              description={`Checked at ${checkedAtLabel} · ${DEFAULT_PARAMS.breakoutLookback}-bar lookback · ${universeSize} instruments scanned.`}
            />
          ) : filteredToZero ? (
            <EmptyState
              title="No names match the current filters."
              description={`Active: ${chips.map((c) => c.label).join(', ')}.`}
              action={
                <Button size="sm" variant="secondary" onClick={() => store.getState().setFilters({ sector: null })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="max-h-72 overflow-auto">
              <div
                role="row"
                className="sticky top-0 grid border-b border-border bg-panel text-[10px] font-medium uppercase tracking-wide text-text-secondary"
                style={{ gridTemplateColumns: TABLE_GRID, minWidth: TABLE_MIN_WIDTH }}
              >
                <span role="columnheader" />
                <span role="columnheader">Symbol</span>
                <span role="columnheader">Sector</span>
                <span role="columnheader" className="text-right">
                  % Ch
                </span>
                <span role="columnheader" className="text-right">
                  3 Day Ch%
                </span>
                <span role="columnheader" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
                  <span className="truncate">Strength</span>
                  <StrengthInfo className="shrink-0" />
                </span>
                <span role="columnheader">Intraday</span>
                <span role="columnheader">Breakouts</span>
              </div>

              {sortedRows.map((row) => (
                <div
                  key={row.token}
                  role="row"
                  className={cn(
                    'grid items-center overflow-hidden border-b border-border-hairline py-1 text-xs hover:bg-panel/60',
                    selectedToken === row.token && 'border-l-2 border-l-neutral bg-panel/40',
                  )}
                  style={{ gridTemplateColumns: TABLE_GRID, minWidth: TABLE_MIN_WIDTH }}
                >
                  <span role="gridcell" className="min-w-0 overflow-hidden">
                    <StarMarker starred={row.starred} onToggle={() => store.getState().toggleStar(row.token)} />
                  </span>
                  <span role="gridcell" className="min-w-0 overflow-hidden truncate">
                    <button
                      type="button"
                      aria-label={`Open details for ${row.symbol}`}
                      onClick={() => toggleSelect(row.token)}
                      className="max-w-full truncate text-left font-medium text-text-primary hover:underline"
                    >
                      {row.symbol}
                    </button>
                  </span>
                  <span role="gridcell" className="min-w-0 overflow-hidden truncate text-text-secondary" title={row.sector}>
                    {row.sector}
                  </span>
                  <span role="gridcell" className="min-w-0 overflow-hidden text-right">
                    <ChangePercentCell value={Number.isNaN(row.changePct) ? null : row.changePct} />
                  </span>
                  <span role="gridcell" className="min-w-0 overflow-hidden text-right">
                    <ChangePercentCell value={Number.isNaN(row.change3dPct) ? null : row.change3dPct} />
                  </span>
                  <span role="gridcell" className="min-w-0 overflow-hidden">
                    <StrengthCell value={row.strength} />
                  </span>
                  <span role="gridcell" className="min-w-0 overflow-hidden">
                    <IntradayDirCell dir={row.intradayDir} />
                  </span>
                  <span role="gridcell" className="min-w-0 overflow-hidden">
                    <BreakoutCell breakout={row.breakout} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 md:w-1/3">
          <SectorCountBars entries={sectorEntries} tone={config.tone} activeSector={filters.sector} onToggle={toggleSector} />
        </div>
      </div>
    </Panel>
  )
}

/**
 * The paired Breakout ▲ / BreakDown ▼ panels — each a table (rows currently
 * flagged by the SAME checkBreakout() call computeIntradayRow() already
 * made; this file evaluates no breakout rule of its own) plus a companion
 * "breakouts by sector" bar chart. Below lg the two panels stack; within
 * each panel, below md the chart moves under the table instead of beside it.
 */
export function BreakoutPanels({ store }: BreakoutPanelsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <BreakoutPanel store={store} direction="BREAKOUT-UP" />
      <BreakoutPanel store={store} direction="BREAKOUT-DOWN" />
    </div>
  )
}
