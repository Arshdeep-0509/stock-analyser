import { Maximize2, X } from 'lucide-react'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { marketMeter, meanExcludingNaN, sectorCardSummaries, type SectorCardSummary } from '../../analytics/aggregate'
import { INDEX_PANELS, type IndexPanel } from '../../data/reference/indices'
import { matchesFilters, type IntradayFilters, type IntradayStore } from '../../store/intradayStore'
import type { IndexKey, IntradayRow } from '../../types/domain'
import { StarMarker, StrengthCell, StrengthInfo } from '../../components/ui'
import { cn } from '../../lib/cn'
import { formatNumber } from '../../lib/formatters'
import { useRenderCount } from '../../lib/renderCounter'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { ChangePercentCell, LtpCell } from '../rsi-ha/cells'
import { compareRows, useSort, type SortableColumn } from '../rsi-ha/useSort'
import { BreakoutCell, IntradayDirCell } from './cells'
import { useDensity } from './DensityContext'
import { SessionBadge } from './Panel'

export interface SectorGridProps {
  store: IntradayStore
}

/** METAL through OTHERS, in Prompt 12's own order — INDEX_PANELS minus the two broad-market indices (NIFTY 50, BANK NIFTY), which get their own cards in IndexMeter instead. */
const SECTOR_GRID_PANELS: readonly IndexPanel[] = INDEX_PANELS.filter((p) => p.key !== 'NIFTY_50' && p.key !== 'BANK_NIFTY')

const FLASH_DURATION_MS = 400
/** Above this many simultaneously-changed rows, flashing every one of them at once would read as a strobe — flash the card header instead. */
const FLASH_CAP = 8
const ROW_HEIGHT = 28
const COMPACT_ROW_HEIGHT = 20
const NARROW_ROW_HEIGHT = 42
const VISIBLE_ROWS = 10
const NARROW_VISIBLE_ROWS = 6
/** The id IntradayPage's own scroll container must carry — a card header click scrolls THIS element to the top, not `window` (the page's real scroller is this div, not the document). */
export const SCROLL_ROOT_ID = 'intraday-scroll-root'

type SortMode = 'default' | 'strength' | 'advanceDecline' | 'alphabetical'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'strength', label: 'Mean strength' },
  { value: 'advanceDecline', label: 'Advance/decline' },
  { value: 'alphabetical', label: 'A–Z' },
]

/** Strength descending; NaN maps to -Infinity so it always sorts last — the same invariant every /intraday table upholds, hand-rolled here since a single always-active key doesn't need the generic multi-column sort machinery. */
function compareByStrengthDesc(a: IntradayRow, b: IntradayRow): number {
  const av = Number.isNaN(a.strength) ? -Infinity : a.strength
  const bv = Number.isNaN(b.strength) ? -Infinity : b.strength
  return bv - av
}

function AdvanceDeclineStrip({ upPct, downPct }: { upPct: number; downPct: number }) {
  const total = Math.max(upPct + downPct, 1)
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-border-hairline"
      role="img"
      aria-label={`${formatNumber(upPct, 0)}% advancing, ${formatNumber(downPct, 0)}% declining`}
    >
      <div className="h-full bg-bullish" style={{ width: `${(upPct / total) * 100}%` }} />
      <div className="h-full bg-bearish" style={{ width: `${(downPct / total) * 100}%` }} />
    </div>
  )
}

/**
 * Diffs consecutive `rows` snapshots to decide, per render, which tokens'
 * %Ch changed since last time — and caps it: more than FLASH_CAP changes in
 * one batch flashes the card header instead of every row (ten cards each
 * flashing ten rows on the same tick would read as a strobe, not a signal).
 * Runs in an effect (not during render) since scheduling the auto-clear
 * timeout is a real side effect either way.
 */
function useSectorFlash(rows: readonly IntradayRow[]): { flashByToken: ReadonlyMap<string, 'up' | 'down'>; headerFlash: boolean } {
  const prevRef = useRef<Map<string, number> | null>(null)
  const [flashByToken, setFlashByToken] = useState<Map<string, 'up' | 'down'>>(new Map())
  const [headerFlash, setHeaderFlash] = useState(false)

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = new Map(rows.map((r) => [r.token, r.changePct]))
    if (prev === null) return // first mount — nothing to compare against yet

    const changed = new Map<string, 'up' | 'down'>()
    for (const row of rows) {
      if (Number.isNaN(row.changePct)) continue
      const prevValue = prev.get(row.token)
      if (prevValue !== undefined && prevValue !== row.changePct) changed.set(row.token, row.changePct > prevValue ? 'up' : 'down')
    }
    if (changed.size === 0) return

    if (changed.size > FLASH_CAP) {
      setHeaderFlash(true)
      const t = window.setTimeout(() => setHeaderFlash(false), FLASH_DURATION_MS)
      return () => window.clearTimeout(t)
    }
    setFlashByToken(changed)
    const t = window.setTimeout(() => setFlashByToken(new Map()), FLASH_DURATION_MS)
    return () => window.clearTimeout(t)
  }, [rows])

  return { flashByToken, headerFlash }
}

const CARD_GRID = '16px minmax(0,1fr) 52px 62px 40px 40px'
const CARD_GRID_NARROW = '16px minmax(0,1fr) 52px 62px 40px'

interface SectorCardProps {
  indexKey: IndexKey
  label: string
  store: IntradayStore
  onToggleFilter: (key: IndexKey) => void
  onExpand: (key: IndexKey) => void
}

/** Excludes ONLY the `index` dimension from matchesFilters — a card already scopes to its own index by construction, so applying that check too would make every OTHER card's rows vanish the moment one card's header is clicked. Every other filter dimension (sector, tokens, q, direction, breakoutOnly, minStrength) still narrows the table normally. */
function matchesFiltersIgnoringIndex(row: IntradayRow, filters: IntradayFilters): boolean {
  return matchesFilters(row, { ...filters, index: null })
}

const SectorCard = memo(function SectorCard({ indexKey, label, store, onToggleFilter, onExpand }: SectorCardProps) {
  useRenderCount(`SectorCard:${indexKey}`)

  // The one subscription that matters for tick isolation: useShallow means
  // this component only re-renders when THIS index's own filtered row list
  // actually differs (by content, not by array identity) from last time —
  // Immer's structural sharing means a tick affecting some OTHER sector
  // leaves every one of THIS sector's row objects at the same reference, so
  // the shallow comparison correctly bails out.
  const sectorRows = store(useShallow((s) => s.rows.filter((r) => r.indices.includes(indexKey))))
  const filters = store((s) => s.filters)
  const activeIndex = filters.index
  const selectedToken = store((s) => s.selectedToken)
  const isNarrow = useMediaQuery('(max-width: 479px)')
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const density = useDensity()

  const visibleRows = useMemo(() => sectorRows.filter((r) => matchesFiltersIgnoringIndex(r, filters)), [sectorRows, filters])
  const sorted = useMemo(() => visibleRows.slice().sort(compareByStrengthDesc), [visibleRows])
  const meanStrength = useMemo(() => meanExcludingNaN(sectorRows.map((r) => r.strength)), [sectorRows])
  const adv = useMemo(() => marketMeter(sectorRows), [sectorRows])

  const { flashByToken, headerFlash } = useSectorFlash(sectorRows)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [shadow, setShadow] = useState({ top: false, bottom: false })
  function updateShadow(): void {
    const el = scrollRef.current
    if (!el) return
    setShadow({ top: el.scrollTop > 2, bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 2 })
  }
  useEffect(() => updateShadow(), [sorted.length])

  const active = activeIndex === indexKey
  const rowHeight = isNarrow ? NARROW_ROW_HEIGHT : density === 'compact' ? COMPACT_ROW_HEIGHT : ROW_HEIGHT
  const visibleCount = isNarrow ? NARROW_VISIBLE_ROWS : VISIBLE_ROWS
  const maxHeight = rowHeight * visibleCount
  const grid = isNarrow ? CARD_GRID_NARROW : CARD_GRID

  function toggle(): void {
    onToggleFilter(indexKey)
    document.getElementById(SCROLL_ROOT_ID)?.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
  }

  const titleNode = (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={active}
      className={cn(
        'truncate rounded text-left text-xs font-medium uppercase tracking-wide text-text-secondary hover:text-text-primary',
        active && 'text-neutral',
      )}
    >
      {label}
    </button>
  )

  return (
    <section className={cn('flex min-w-0 flex-col rounded border border-border bg-panel', active && 'border-neutral')}>
      <header
        className={cn(
          'flex shrink-0 items-center justify-between gap-2 border-b border-border-hairline px-3 py-2 transition-colors duration-300',
          headerFlash && 'bg-neutral/15',
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {titleNode}
          <SessionBadge tone="bearish" />
          <span className="shrink-0 font-mono text-[10px] text-text-muted">({sectorRows.length})</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs text-text-primary" title="Mean Strength">
            {Number.isNaN(meanStrength) ? '—' : formatNumber(meanStrength, 1)}
          </span>
          <button type="button" aria-label={`Expand ${label}`} onClick={() => onExpand(indexKey)} className="text-text-muted hover:text-text-primary">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="relative min-w-0">
        {sorted.length === 0 ? (
          <p className="p-3 text-xs text-text-muted">{sectorRows.length === 0 ? 'No constituents loaded yet.' : 'No names match the current filters.'}</p>
        ) : (
          <div ref={scrollRef} onScroll={updateShadow} className="overflow-y-auto" style={{ maxHeight }}>
            <div
              role="row"
              className="sticky top-0 z-10 grid gap-x-1.5 border-b border-border bg-panel px-2 text-[9px] font-medium uppercase tracking-wide text-text-secondary"
              style={{ gridTemplateColumns: grid }}
            >
              <span role="columnheader" className="min-w-0 overflow-hidden" />
              <span role="columnheader" className="min-w-0 overflow-hidden truncate">
                Symbol
              </span>
              <span role="columnheader" className="min-w-0 overflow-hidden truncate text-right">
                % Ch
              </span>
              <span role="columnheader" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
                <span className="truncate">Strength</span>
                <StrengthInfo className="shrink-0" />
              </span>
              <span role="columnheader" className="min-w-0 overflow-hidden truncate">
                Intraday
              </span>
              {!isNarrow && (
                <span role="columnheader" className="min-w-0 overflow-hidden truncate">
                  Breakouts
                </span>
              )}
            </div>

            {sorted.map((row) => (
              <div
                key={row.token}
                role="row"
                className={cn(
                  'grid items-center gap-x-1.5 overflow-hidden border-b border-border-hairline px-2 text-xs hover:bg-panel/60',
                  density === 'compact' && !isNarrow ? 'py-0' : 'py-1',
                  selectedToken === row.token && 'border-l-2 border-l-neutral bg-panel/40',
                )}
                style={{ gridTemplateColumns: grid }}
              >
                <span role="gridcell" className="min-w-0 overflow-hidden">
                  <StarMarker starred={row.starred} onToggle={() => store.getState().toggleStar(row.token)} />
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
                <span role="gridcell" className="min-w-0 overflow-hidden text-right">
                  <ChangePercentCell value={Number.isNaN(row.changePct) ? null : row.changePct} flash={flashByToken.get(row.token) ?? null} />
                </span>
                <span role="gridcell" className="min-w-0 overflow-hidden">
                  <StrengthCell value={row.strength} />
                </span>
                <span role="gridcell" className="min-w-0 overflow-hidden">
                  <IntradayDirCell dir={row.intradayDir} />
                </span>
                {!isNarrow && (
                  <span role="gridcell" className="min-w-0 overflow-hidden">
                    <BreakoutCell breakout={row.breakout} />
                  </span>
                )}
                {isNarrow && row.breakout !== null && (
                  <span className="col-span-full flex justify-end pt-0.5">
                    <BreakoutCell breakout={row.breakout} />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-panel to-transparent transition-opacity',
            shadow.top ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 h-3 bg-gradient-to-t from-panel to-transparent transition-opacity',
            shadow.bottom ? 'opacity-100' : 'opacity-0',
          )}
        />
      </div>

      <footer className="border-t border-border-hairline px-3 py-2">
        <AdvanceDeclineStrip upPct={adv.upPct} downPct={adv.downPct} />
      </footer>
    </section>
  )
})

// ---------------------------------------------------------------------------
// Expand modal — full-width, all constituents, every column, sortable.
// ---------------------------------------------------------------------------

const MODAL_COLUMNS: Record<string, SortableColumn<IntradayRow>> = {
  symbol: { key: 'symbol', sortValue: (r) => r.symbol },
  cmp: { key: 'cmp', sortValue: (r) => r.cmp },
  changePct: { key: 'changePct', sortValue: (r) => r.changePct },
  change3dPct: { key: 'change3dPct', sortValue: (r) => r.change3dPct },
  strength: { key: 'strength', sortValue: (r) => r.strength },
  rvol: { key: 'rvol', sortValue: (r) => r.rvol },
  vwap: { key: 'vwap', sortValue: (r) => r.vwap },
  intradayDir: { key: 'intradayDir', sortValue: (r) => (r.intradayDir === 'up' ? 1 : 0) },
  breakout: { key: 'breakout', sortValue: (r) => (r.breakout === 'BREAKOUT-UP' ? 2 : r.breakout === 'BREAKOUT-DOWN' ? 1 : 0) },
}

const MODAL_COLUMN_META: { key: string; label: string; align?: 'right' }[] = [
  { key: 'star', label: '' },
  { key: 'symbol', label: 'Symbol' },
  { key: 'cmp', label: 'CMP', align: 'right' },
  { key: 'changePct', label: '% Ch', align: 'right' },
  { key: 'change3dPct', label: '3 Day Ch%', align: 'right' },
  { key: 'strength', label: 'Strength' },
  { key: 'rvol', label: 'rvol', align: 'right' },
  { key: 'vwap', label: 'VWAP', align: 'right' },
  { key: 'intradayDir', label: 'Intraday' },
  { key: 'breakout', label: 'Breakouts' },
]

const MODAL_GRID = '20px minmax(0,1fr) 90px 76px 84px 84px 64px 90px 70px 70px'

function ariaSortFor(direction: 'asc' | 'desc' | null): 'ascending' | 'descending' | 'none' {
  if (direction === 'asc') return 'ascending'
  if (direction === 'desc') return 'descending'
  return 'none'
}

function SectorExpandModal({ indexKey, label, store, onClose }: { indexKey: IndexKey; label: string; store: IntradayStore; onClose: () => void }) {
  const rows = store(useShallow((s) => s.rows.filter((r) => r.indices.includes(indexKey))))
  const selectedToken = store((s) => s.selectedToken)
  const sort = useSort([{ key: 'strength', direction: 'desc' }])

  const sorted = useMemo(() => rows.slice().sort((a, b) => compareRows(a, b, sort.rules, MODAL_COLUMNS)), [rows, sort.rules])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      <div className="absolute inset-0 bg-surface/80" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative flex max-h-full w-full max-w-6xl flex-col rounded border border-border bg-panel shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-primary">
            {label} <span className="font-mono text-xs font-normal text-text-muted">({rows.length})</span>
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <div style={{ minWidth: 640 }}>
            <div
              role="row"
              className="sticky top-0 grid gap-x-2 border-b border-border bg-panel px-3 text-[10px] font-medium uppercase tracking-wide text-text-secondary"
              style={{ gridTemplateColumns: MODAL_GRID }}
            >
              {MODAL_COLUMN_META.map((col) => {
                const sortable = col.key !== 'star'
                return (
                  <div
                    key={col.key}
                    role="columnheader"
                    aria-sort={sortable ? ariaSortFor(sort.directionFor(col.key)) : undefined}
                    className={cn('flex h-8 min-w-0 items-center gap-0.5 overflow-hidden py-1', col.align === 'right' && 'justify-end text-right')}
                  >
                    <button
                      type="button"
                      disabled={!sortable}
                      onClick={(e) => sortable && sort.handleHeaderClick(col.key, e.shiftKey)}
                      className={cn(
                        'flex min-w-0 items-center gap-0.5 truncate text-left disabled:cursor-default',
                        sortable && 'cursor-pointer hover:text-text-primary',
                      )}
                    >
                      <span className="truncate">{col.label}</span>
                      {sort.directionFor(col.key) === 'asc' && <span aria-hidden="true">▲</span>}
                      {sort.directionFor(col.key) === 'desc' && <span aria-hidden="true">▼</span>}
                    </button>
                    {col.key === 'strength' && <StrengthInfo className="shrink-0" />}
                  </div>
                )
              })}
            </div>

            {sorted.map((row) => (
              <div
                key={row.token}
                role="row"
                className={cn(
                  'grid items-center gap-x-2 overflow-hidden border-b border-border-hairline px-3 py-1.5 text-sm hover:bg-panel/60',
                  selectedToken === row.token && 'border-l-2 border-l-neutral bg-panel/40',
                )}
                style={{ gridTemplateColumns: MODAL_GRID }}
              >
                <span role="gridcell" className="min-w-0 overflow-hidden">
                  <StarMarker starred={row.starred} onToggle={() => store.getState().toggleStar(row.token)} />
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
                <span role="gridcell" className="min-w-0 overflow-hidden text-right font-mono tabular-nums text-text-secondary">
                  {Number.isNaN(row.rvol) ? '—' : formatNumber(row.rvol, 2)}
                </span>
                <span role="gridcell" className="min-w-0 overflow-hidden text-right">
                  <LtpCell ltp={Number.isNaN(row.vwap) ? undefined : row.vwap} />
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
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

function sortKeyFor(mode: SortMode, summary: SectorCardSummary): number | string {
  switch (mode) {
    case 'strength':
      return Number.isNaN(summary.meanStrength) ? -Infinity : summary.meanStrength
    case 'advanceDecline':
      return summary.upPct - summary.downPct
    case 'alphabetical':
      return summary.label
    case 'default':
      return 0
  }
}

/**
 * The bottom-of-dashboard grid of per-index cards. This PARENT subscribes to
 * the full `rows` array (so its own sort-order/hide-empty computation is
 * always current — that recompute is cheap, it's just ~10 summaries), but
 * every card it renders gets STABLE props and does its OWN scoped
 * subscription internally (see SectorCard's own comment), so a re-render
 * here from a tick never forces a child to re-render — React.memo bails out
 * because indexKey/label/store/the two callbacks never change identity.
 */
export function SectorGrid({ store }: SectorGridProps) {
  useRenderCount('SectorGrid')
  // The 1s meter snapshot: card ORDER and hide-empty only need summaries, and
  // re-sorting the cards on every tick flush would make them jump around.
  // Each card still reads live rows through its own selector.
  const rows = store((s) => s.meterRows)
  const [sortMode, setSortMode] = useState<SortMode>('default')
  const [hideEmpty, setHideEmpty] = useState(false)
  const [expandedKey, setExpandedKey] = useState<IndexKey | null>(null)

  const summaries = useMemo(() => sectorCardSummaries(rows, SECTOR_GRID_PANELS), [rows])
  const summaryByKey = useMemo(() => new Map(summaries.map((s) => [s.key, s])), [summaries])

  const orderedPanels = useMemo(() => {
    let panels = SECTOR_GRID_PANELS
    if (hideEmpty) panels = panels.filter((p) => (summaryByKey.get(p.key)?.count ?? 0) > 0)
    if (sortMode === 'default') return panels
    return [...panels].sort((a, b) => {
      const av = sortKeyFor(sortMode, summaryByKey.get(a.key)!)
      const bv = sortKeyFor(sortMode, summaryByKey.get(b.key)!)
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv))
      return bv - av
    })
  }, [hideEmpty, sortMode, summaryByKey])

  // Stable across every render regardless of tick activity — required for
  // SectorCard's React.memo to actually bail children out on a parent
  // re-render (see the component's own doc comment).
  const handleToggleFilter = useMemo(
    () => (key: IndexKey) => store.getState().setFilters({ index: store.getState().filters.index === key ? null : key }),
    [store],
  )
  const handleExpand = useMemo(() => (key: IndexKey) => setExpandedKey(key), [])

  const expandedLabel = expandedKey ? (SECTOR_GRID_PANELS.find((p) => p.key === expandedKey)?.label ?? expandedKey) : null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Sort by</span>
        <div role="radiogroup" aria-label="Sort sector cards by" className="inline-flex overflow-hidden rounded border border-border-hairline">
          {SORT_OPTIONS.map((opt, i) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={sortMode === opt.value}
              onClick={() => setSortMode(opt.value)}
              className={cn(
                'px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                i > 0 && 'border-l border-border-hairline',
                sortMode === opt.value ? 'bg-neutral/20 text-neutral' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-text-secondary">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Hide empty sectors
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {orderedPanels.map((panel) => (
          <SectorCard key={panel.key} indexKey={panel.key} label={panel.label} store={store} onToggleFilter={handleToggleFilter} onExpand={handleExpand} />
        ))}
        {orderedPanels.length === 0 && <p className="text-xs text-text-muted">No sectors to show.</p>}
      </div>

      {expandedKey && expandedLabel && <SectorExpandModal indexKey={expandedKey} label={expandedLabel} store={store} onClose={() => setExpandedKey(null)} />}
    </div>
  )
}
