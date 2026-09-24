import { useRenderCount } from '../../lib/renderCounter'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Download, Filter, Maximize2, Minimize2, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { DEFAULT_FILTERS, matchesFilters, type IntradayStore } from '../../store/intradayStore'
import type { IntradayRow } from '../../types/domain'
import { Button, EmptyState, IconButton, StarMarker, StrengthCell, StrengthInfo } from '../../components/ui'
import { cn } from '../../lib/cn'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { ChangePercentCell, LtpCell, TimeCell } from '../rsi-ha/cells'
import { compareRows, useSort, type SortableColumn } from '../rsi-ha/useSort'
import { BreakoutCell, IntradayDirCell } from './cells'
import { useDensity } from './DensityContext'
import { downloadCsv } from './exportRows'
import { activeFilterChips } from './filterChips'
import { Panel } from './Panel'

const PANEL_SUBTITLE = 'Look for trending names, or names holding support and resistance'

export interface TopStrengthTableProps {
  store: IntradayStore
}

const ROW_HEIGHT = 32
const COMPACT_ROW_HEIGHT = 24
const COLLAPSED_MAX_HEIGHT = 420
const EXPANDED_MAX_HEIGHT = 760
/** Above this many VISIBLE (post-filter, post-Top-N) rows, the grid switches to virtualised windowing — below it, every row still goes through the same virtualizer, it just never needs to window because the container comfortably fits them all. */
const VIRTUALIZE_ABOVE = 50

const TOP_N_OPTIONS = [10, 25, 50, 'all'] as const
type TopNOption = (typeof TOP_N_OPTIONS)[number]

interface ColumnMeta {
  key: string
  label: string
  sortable: boolean
  align?: 'right'
}

const COLUMN_META: ColumnMeta[] = [
  { key: 'star', label: '', sortable: false },
  { key: 'rank', label: '#', sortable: false },
  { key: 'symbol', label: 'Symbol', sortable: true },
  { key: 'sector', label: 'Sector', sortable: true },
  { key: 'cmp', label: 'CMP', sortable: true, align: 'right' },
  { key: 'changePct', label: '% Ch', sortable: true, align: 'right' },
  { key: 'change3dPct', label: '3 Day Ch%', sortable: true, align: 'right' },
  { key: 'strength', label: 'Strength', sortable: true },
  { key: 'time', label: 'Time', sortable: true },
  { key: 'intradayDir', label: 'Intraday', sortable: true },
  { key: 'breakout', label: 'Breakouts', sortable: true },
]

// star(22) rank(32) symbol(150) sector(130) cmp(80) changePct(72) change3dPct(84) strength(84) time(68) intraday(64) breakout(70)
const GRID_TEMPLATE = '22px 32px 150px 130px 80px 72px 84px 84px 68px 64px 70px'
const GRID_MIN_WIDTH = 856

const COLUMNS: Record<string, SortableColumn<IntradayRow>> = {
  symbol: { key: 'symbol', sortValue: (r) => r.symbol },
  sector: { key: 'sector', sortValue: (r) => r.sector },
  cmp: { key: 'cmp', sortValue: (r) => r.cmp },
  changePct: { key: 'changePct', sortValue: (r) => r.changePct },
  change3dPct: { key: 'change3dPct', sortValue: (r) => r.change3dPct },
  strength: { key: 'strength', sortValue: (r) => r.strength },
  time: { key: 'time', sortValue: (r) => r.lastTickAt },
  intradayDir: {
    key: 'intradayDir',
    sortValue: (r) => (r.intradayDir === 'up' ? 1 : 0),
  },
  breakout: {
    key: 'breakout',
    sortValue: (r) => (r.breakout === 'BREAKOUT-UP' ? 2 : r.breakout === 'BREAKOUT-DOWN' ? 1 : 0),
  },
}

function ariaSortFor(direction: 'asc' | 'desc' | null): 'ascending' | 'descending' | 'none' {
  if (direction === 'asc') return 'ascending'
  if (direction === 'desc') return 'descending'
  return 'none'
}

/**
 * The ranked "hero" table — every F&O row currently in scope, sorted (default
 * Strength descending), Top-N limited, respecting every dashboard-wide
 * filter another chart's click has set. Ranks are recomputed on every store
 * update (ticks included, not a throttled snapshot — unlike SignalsTable,
 * continuous re-ranking IS the point here) and rows are keyed by token
 * through the virtualizer's own getItemKey, so when a row's rank changes the
 * SAME DOM node slides to its new position under a CSS transition rather
 * than unmounting/remounting — the actual "proof of life" cue, not a fake
 * highlight.
 */
export function TopStrengthTable({ store }: TopStrengthTableProps) {
  useRenderCount('TopStrengthTable')
  const rows = store((s) => s.rows)
  const filters = store((s) => s.filters)
  const selectedToken = store((s) => s.selectedToken)
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const density = useDensity()
  const rowHeight = density === 'compact' ? COMPACT_ROW_HEIGHT : ROW_HEIGHT

  const sort = useSort([{ key: 'strength', direction: 'desc' }])
  const [topN, setTopN] = useState<TopNOption>(25)
  const [filterOpen, setFilterOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [searchDraft, setSearchDraft] = useState(filters.q)

  const parentRef = useRef<HTMLDivElement>(null)

  const visibleRows = useMemo(() => rows.filter((r) => matchesFilters(r, filters)), [rows, filters])
  const sorted = useMemo(() => visibleRows.slice().sort((a, b) => compareRows(a, b, sort.rules, COLUMNS)), [visibleRows, sort.rules])
  const limited = useMemo(() => (topN === 'all' ? sorted : sorted.slice(0, topN)), [sorted, topN])

  const chips = activeFilterChips(filters)

  const virtualizer = useVirtualizer({
    count: limited.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: (index) => limited[index]?.token ?? index,
  })

  const transition = prefersReducedMotion ? 'none' : 'transform 200ms ease'
  const maxHeight = expanded ? EXPANDED_MAX_HEIGHT : COLLAPSED_MAX_HEIGHT
  const shouldScroll = limited.length > VIRTUALIZE_ABOVE || limited.length * rowHeight > maxHeight

  function clearAll(): void {
    store.getState().setFilters({ ...DEFAULT_FILTERS })
    setSearchDraft('')
  }

  function submitSearch(): void {
    store.getState().setFilters({ q: searchDraft })
  }

  const toolbar = (
    <>
      <IconButton aria-label="Filter" aria-pressed={filterOpen} onClick={() => setFilterOpen((v) => !v)} className={cn(filterOpen && 'text-neutral')}>
        <Filter className="h-3.5 w-3.5" />
      </IconButton>
      <IconButton aria-label={expanded ? 'Collapse table' : 'Expand table'} aria-pressed={expanded} onClick={() => setExpanded((v) => !v)}>
        {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </IconButton>
      <IconButton aria-label="Export CSV" onClick={() => downloadCsv(limited)}>
        <Download className="h-3.5 w-3.5" />
      </IconButton>
    </>
  )

  const controlsRow = (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-hairline px-3 py-1.5">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">Top</span>
      <div role="radiogroup" aria-label="Top N" className="inline-flex overflow-hidden rounded border border-border-hairline">
        {TOP_N_OPTIONS.map((opt, i) => (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={topN === opt}
            onClick={() => setTopN(opt)}
            className={cn(
              'px-1.5 py-0.5 text-[10px] font-medium capitalize tabular-nums transition-colors',
              i > 0 && 'border-l border-border-hairline',
              topN === opt ? 'bg-neutral/20 text-neutral' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {opt}
          </button>
        ))}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => store.getState().setFilters(chip.clear)}
              className="inline-flex items-center gap-1 rounded-full border border-border-hairline bg-surface px-2 py-0.5 text-[10px] text-text-secondary hover:text-text-primary"
            >
              {chip.label}
              <X className="h-2.5 w-2.5" aria-hidden="true" />
              <span className="sr-only">Clear this filter</span>
            </button>
          ))}
        </div>
      )}

      <span className="ml-auto text-[10px] text-text-secondary">
        {limited.length} of {visibleRows.length} shown
        {visibleRows.length !== rows.length ? ` (${rows.length} total)` : ''}
      </span>
    </div>
  )

  if (rows.length === 0) {
    return (
      <Panel title="TOP INTRADAY STRENGTH · F&O" subtitle={PANEL_SUBTITLE} live={false} toolbar={toolbar}>
        <div className="flex flex-col">
          {controlsRow}
          <EmptyState title="No F&O names loaded yet." description="The ranked table will appear once the universe finishes loading." />
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="TOP INTRADAY STRENGTH · F&O" subtitle={PANEL_SUBTITLE} live bodyClassName="p-0" toolbar={toolbar}>
      <div className="flex flex-col">
        {controlsRow}

        {filterOpen && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border-hairline bg-surface px-3 py-1.5">
            <input
              type="text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
              onBlur={submitSearch}
              placeholder="Search symbol…"
              aria-label="Search symbol"
              className="h-7 w-40 rounded border border-border-hairline bg-panel px-2 text-xs text-text-primary placeholder:text-text-muted"
            />
            <label className="flex items-center gap-1.5 text-xs text-text-secondary">
              <input type="checkbox" checked={filters.breakoutOnly} onChange={(e) => store.getState().setFilters({ breakoutOnly: e.target.checked })} />
              Breakout only
            </label>
          </div>
        )}

        {limited.length === 0 ? (
          <EmptyState
            title={chips.length > 0 ? 'No names match the current filters.' : 'No names to show.'}
            description={chips.length > 0 ? `Active: ${chips.map((c) => c.label).join(', ')}.` : undefined}
            action={
              chips.length > 0 ? (
                <Button size="sm" variant="secondary" onClick={clearAll}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div ref={parentRef} className="overflow-auto" style={{ maxHeight: shouldScroll ? maxHeight : undefined }}>
            {/* The full grid width at EVERY size: the rows are absolutely positioned and clip to this box, so without it (the old below-640px branch) every column past the viewport rendered blank while the header still scrolled. Narrow screens scroll this container sideways instead. */}
            <div style={{ minWidth: GRID_MIN_WIDTH }}>
              <div
                role="row"
                className="sticky top-0 z-10 grid border-b border-border bg-panel px-2 text-[10px] font-medium uppercase tracking-wide text-text-secondary"
                style={{ gridTemplateColumns: GRID_TEMPLATE }}
              >
                {COLUMN_META.map((col) => (
                  <div
                    key={col.key}
                    role="columnheader"
                    aria-sort={col.sortable ? ariaSortFor(sort.directionFor(col.key)) : undefined}
                    className={cn('flex h-7 min-w-0 items-center gap-0.5 overflow-hidden py-1', col.align === 'right' && 'justify-end text-right')}
                  >
                    <button
                      type="button"
                      disabled={!col.sortable}
                      onClick={(e) => col.sortable && sort.handleHeaderClick(col.key, e.shiftKey)}
                      className={cn(
                        'flex min-w-0 items-center gap-0.5 truncate text-left disabled:cursor-default',
                        col.sortable && 'cursor-pointer hover:text-text-primary',
                      )}
                    >
                      <span className="truncate">{col.label}</span>
                      {sort.directionFor(col.key) === 'asc' && <span aria-hidden="true">▲</span>}
                      {sort.directionFor(col.key) === 'desc' && <span aria-hidden="true">▼</span>}
                    </button>
                    {col.key === 'strength' && <StrengthInfo className="shrink-0" />}
                  </div>
                ))}
              </div>

              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const row = limited[virtualRow.index]
                  if (!row) return null

                  return (
                    <div
                      key={virtualRow.key}
                      role="row"
                      aria-rowindex={virtualRow.index + 1}
                      className={cn(
                        'absolute left-0 right-0 grid items-center overflow-hidden border-b border-border-hairline px-2 text-xs hover:bg-panel/60',
                        selectedToken === row.token && 'border-l-2 border-l-neutral bg-panel/40',
                      )}
                      style={{
                        gridTemplateColumns: GRID_TEMPLATE,
                        transform: `translateY(${virtualRow.start}px)`,
                        height: virtualRow.size,
                        transition,
                      }}
                    >
                      <span role="gridcell" className="min-w-0 overflow-hidden">
                        <StarMarker starred={row.starred} onToggle={() => store.getState().toggleStar(row.token)} />
                      </span>
                      <span role="gridcell" className="min-w-0 overflow-hidden font-mono tabular-nums text-text-secondary">
                        {virtualRow.index + 1}
                      </span>
                      <span role="gridcell" className="min-w-0 overflow-hidden truncate">
                        <button
                          type="button"
                          aria-label={`Open details for ${row.symbol}`}
                          onClick={() => store.getState().selectToken(selectedToken === row.token ? null : row.token)}
                          className="max-w-full truncate text-left font-medium text-text-primary hover:underline"
                        >
                          {row.symbol}
                        </button>
                      </span>
                      <span role="gridcell" className="min-w-0 overflow-hidden truncate text-text-secondary" title={row.sector}>
                        {row.sector}
                      </span>
                      <span role="gridcell" className="min-w-0 overflow-hidden text-right">
                        <LtpCell ltp={Number.isNaN(row.cmp) ? undefined : row.cmp} />
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
                        {Number.isNaN(row.lastTickAt) ? <span className="text-text-muted">—</span> : <TimeCell epochSeconds={row.lastTickAt} />}
                      </span>
                      <span role="gridcell" className="min-w-0 overflow-hidden">
                        <IntradayDirCell dir={row.intradayDir} />
                      </span>
                      <span role="gridcell" className="min-w-0 overflow-hidden">
                        <BreakoutCell breakout={row.breakout} />
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}
