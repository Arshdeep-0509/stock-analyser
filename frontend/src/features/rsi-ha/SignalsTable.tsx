import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Copy, FileJson, Pause, Pin, Play, RotateCcw, Rows3, Search, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BottomSheet } from '../../components/ui/BottomSheet'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { formatISTTime } from '../../lib/formatters'
import { useIsDesktop } from '../../lib/useIsDesktop'
import type { ScreenerStore } from '../../store/screenerStore'
import type { ScreenerRow } from '../../store/types'
import type { SignalKind } from '../../types/domain'
import { playChime } from './chime'
import { ChangePercentCell, ExchangeChip, HaStreakSparkline, InstrumentTypeChip, LevelCell, LtpCell, PriceCell, RsiCell, SignalBadge, TimeCell } from './cells'
import { SignalCardList } from './SignalCardList'
import { SignalDetail } from './SignalDetail'
import { downloadCsv, copyRowsAsMarkdown } from './exportRows'
import { FilterBar } from './FilterBar'
import { ParamsOverrideBanner } from './ParamsOverrideBanner'
import { RowContextMenu, type ContextMenuState } from './RowContextMenu'
import { applyFilters, useTableFilters } from './useTableFilters'
import { compareRows, useSort, type SortableColumn } from './useSort'
import { UniverseSelector } from './UniverseSelector'
import { getInstrumentType, isDerivedRow } from './rowHelpers'

export interface SignalsTableProps {
  store: ScreenerStore
}

const ROW_HEIGHT = 32
const GROUP_HEADER_HEIGHT = 28
const GRID_TEMPLATE = '84px 180px 52px 140px 96px 96px 84px 118px 64px 96px 96px'
const SEARCH_INPUT_ID = 'symbol-search'

interface ColumnMeta {
  key: string
  label: string
  sortable: boolean
  align?: 'right'
}

const COLUMN_META: ColumnMeta[] = [
  { key: 'time', label: 'Time', sortable: true },
  { key: 'symbol', label: 'Symbol', sortable: true },
  { key: 'instrumentType', label: 'Type', sortable: true },
  { key: 'signal', label: 'Signal', sortable: true },
  { key: 'price', label: 'Price', sortable: true, align: 'right' },
  { key: 'ltp', label: 'LTP', sortable: true, align: 'right' },
  { key: 'changePercent', label: 'Chg %', sortable: true, align: 'right' },
  { key: 'rsi', label: 'RSI', sortable: true },
  { key: 'haStreak', label: 'HA', sortable: false },
  { key: 'level', label: 'Level', sortable: true, align: 'right' },
  { key: 'actions', label: '', sortable: false },
]

type DisplayItem = { type: 'group'; signal: SignalKind; count: number } | { type: 'row'; row: ScreenerRow }

function ariaSortFor(direction: 'asc' | 'desc' | null): 'ascending' | 'descending' | 'none' {
  if (direction === 'asc') return 'ascending'
  if (direction === 'desc') return 'descending'
  return 'none'
}

function SortIndicator({ direction, rank }: { direction: 'asc' | 'desc' | null; rank: number | null }) {
  return (
    <span className="inline-flex w-3 items-center justify-center text-text-muted">
      {direction === 'asc' && <ChevronUp className="h-3 w-3 text-neutral" />}
      {direction === 'desc' && <ChevronDown className="h-3 w-3 text-neutral" />}
      {rank !== null && rank > 1 && <span className="ml-px text-[9px] text-neutral">{rank}</span>}
    </span>
  )
}

export function SignalsTable({ store }: SignalsTableProps) {
  const rows = store((s) => s.visibleRows)
  const scanState = store((s) => s.scanState)
  const scanProgress = store((s) => s.scanProgress)
  const errors = store((s) => s.errors)
  const universe = store((s) => s.universe)
  const nextScanAt = store((s) => s.nextScanAt)
  const showNseEquityRows = store((s) => s.showNseEquityRows)
  const selectedRowId = store((s) => s.selectedRowId)
  const isPaused = store((s) => s.isPaused)

  const filters = useTableFilters()
  const sort = useSort([{ key: 'time', direction: 'desc' }])

  const [groupBy, setGroupBy] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<SignalKind>>(new Set())
  const [chimeEnabled, setChimeEnabled] = useState(false)
  const [detailRowId, setDetailRowId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [hoveredUnderlying, setHoveredUnderlying] = useState<string | null>(null)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  const isDesktop = useIsDesktop()
  const parentRef = useRef<HTMLDivElement>(null)
  const seenRowIds = useRef<Set<string>>(new Set())
  const freshRowIds = useRef<Set<string>>(new Set())

  // Opens the drawer when something OUTSIDE this table (the alerts inbox,
  // history view) requests it — the nonce means even a repeat request for
  // the same row re-opens it. Never fires from j/k keyboard nav, which only
  // ever touches selectedRowId directly.
  const detailOpenRequest = store((s) => s.detailOpenRequest)
  useEffect(() => {
    if (detailOpenRequest) setDetailRowId(detailOpenRequest.rowId)
  }, [detailOpenRequest])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [])

  // New-row detection for the slide-in accent + chime. This runs once per
  // `rows` change (scan completion / dedupe merge), never per tick.
  useEffect(() => {
    const currentIds = new Set(rows.map((r) => r.id))
    const newlySeen: ScreenerRow[] = []
    for (const row of rows) {
      if (!seenRowIds.current.has(row.id)) {
        freshRowIds.current.add(row.id)
        newlySeen.push(row)
      }
    }
    seenRowIds.current = currentIds
    if (newlySeen.length > 0) {
      if (chimeEnabled) playChime()
      // aria-live announcement — capped so a big batch (e.g. right after
      // "Reset to defaults") doesn't read out dozens of rows at once.
      const announced = newlySeen.slice(0, 3)
      const text = announced.map((r) => `${r.signal} signal, ${r.symbol}, RSI ${r.rsi.toFixed(1)}`).join('. ')
      setAnnouncement(newlySeen.length > announced.length ? `${text}. And ${newlySeen.length - announced.length} more.` : text)
    }
    const timer = window.setTimeout(() => {
      freshRowIds.current.clear()
    }, 1600)
    return () => window.clearTimeout(timer)
    // Intentionally keyed on `rows` alone — chimeEnabled is still read at
    // its current value whenever this fires, since React always runs the
    // latest render's effect body, not the one from when deps last changed.
  }, [rows, chimeEnabled])

  // LTP/Change% sort against a SNAPSHOT of liveLtp taken now (store.getState(),
  // not a subscription) — subscribing the whole table to every tick would
  // defeat the point of per-row LTP subscriptions and blow the 60fps budget.
  // Continuously re-sorting the table on every tick would also be bad UX
  // (rows jumping under the cursor), so the snapshot is intentionally
  // refreshed only when `rows` or `sort.rules` change, not on every tick —
  // both are listed in the deps below even though the closure reads
  // `store.getState()` rather than either directly.
  const columns: Record<string, SortableColumn<ScreenerRow>> = useMemo(() => {
    const ltpSnapshot = store.getState().liveLtp
    return {
      time: { key: 'time', sortValue: (r) => r.time },
      symbol: { key: 'symbol', sortValue: (r) => r.symbol },
      instrumentType: { key: 'instrumentType', sortValue: (r) => getInstrumentType(r) },
      signal: { key: 'signal', sortValue: (r) => r.signal },
      price: { key: 'price', sortValue: (r) => r.price },
      ltp: { key: 'ltp', sortValue: (r) => (r.token ? (ltpSnapshot.get(r.token) ?? NaN) : NaN) },
      changePercent: {
        key: 'changePercent',
        sortValue: (r) => {
          const ltp = r.token ? ltpSnapshot.get(r.token) : undefined
          return ltp === undefined || r.price === 0 ? NaN : ((ltp - r.price) / r.price) * 100
        },
      },
      rsi: { key: 'rsi', sortValue: (r) => r.rsi },
      level: { key: 'level', sortValue: (r) => r.level ?? NaN },
    } satisfies Record<string, SortableColumn<ScreenerRow>>
    // rows/sort.rules deliberately re-trigger the snapshot; store is stable.
  }, [rows, sort.rules, store])

  const filteredSorted = useMemo(() => {
    const filtered = applyFilters(rows, filters.filters, getInstrumentType)
    return filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return compareRows(a, b, sort.rules, columns)
    })
  }, [rows, filters.filters, sort.rules, columns])

  const displayItems: DisplayItem[] = useMemo(() => {
    if (!groupBy) return filteredSorted.map((row): DisplayItem => ({ type: 'row', row }))

    const groups = new Map<SignalKind, ScreenerRow[]>()
    for (const row of filteredSorted) {
      const list = groups.get(row.signal) ?? []
      list.push(row)
      groups.set(row.signal, list)
    }

    const items: DisplayItem[] = []
    for (const [signal, groupRows] of groups) {
      items.push({ type: 'group', signal, count: groupRows.length })
      if (!collapsedGroups.has(signal)) {
        for (const row of groupRows) items.push({ type: 'row', row })
      }
    }
    return items
  }, [filteredSorted, groupBy, collapsedGroups])

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (displayItems[index]?.type === 'group' ? GROUP_HEADER_HEIGHT : ROW_HEIGHT),
    overscan: 12,
  })

  // Keyboard nav: j/k move selection, Enter opens the drawer, Esc closes it, / focuses search.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      if (event.key === '/' && !isTyping) {
        event.preventDefault()
        document.getElementById(SEARCH_INPUT_ID)?.focus()
        return
      }
      if (isTyping) return

      const visibleRowItems = displayItems.filter((i): i is Extract<DisplayItem, { type: 'row' }> => i.type === 'row')
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault()
        const currentIndex = visibleRowItems.findIndex((i) => i.row.id === selectedRowId)
        const delta = event.key === 'j' ? 1 : -1
        const nextIndex = Math.max(0, Math.min(visibleRowItems.length - 1, currentIndex + delta))
        const next = visibleRowItems[nextIndex]
        if (next) store.getState().selectRow(next.row.id)
      } else if (event.key === 'Enter') {
        if (selectedRowId) setDetailRowId(selectedRowId)
      } else if (event.key === 'Escape') {
        setDetailRowId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [displayItems, selectedRowId, store])

  const detailRow = rows.find((r) => r.id === detailRowId) ?? null
  const contextMenuRow = rows.find((r) => r.id === contextMenu?.rowId) ?? null

  const secondsToNextScan = nextScanAt !== null ? Math.max(0, nextScanAt - now) : null

  const filterBarProps = {
    filters,
    showNseEquityRows,
    onShowNseEquityRowsChange: (v: boolean) => store.getState().setShowNseEquityRows(v),
  }

  return (
    <div className="flex h-full flex-col">
      {/* Visually hidden; announces new signals to screen readers without stealing focus. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <UniverseSelector store={store} />
      <ParamsOverrideBanner store={store} />

      {isDesktop ? (
        <FilterBar {...filterBarProps} />
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-border bg-panel px-3 py-2">
            <span className="relative inline-flex flex-1 items-center">
              <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-text-muted" />
              <Input
                id="symbol-search"
                value={filters.searchInput}
                onChange={(e) => filters.setSearchInput(e.target.value)}
                placeholder="Search symbol…"
                className="w-full pl-7"
                aria-label="Search symbol"
              />
            </span>
            <Button size="sm" variant="secondary" onClick={() => setMobileFiltersOpen(true)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {filters.activeFilterCount > 0 && <span className="ml-0.5 text-neutral">({filters.activeFilterCount})</span>}
            </Button>
          </div>
          <BottomSheet open={mobileFiltersOpen} onClose={() => setMobileFiltersOpen(false)} title="Filters">
            <FilterBar {...filterBarProps} hideSearch />
          </BottomSheet>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-1.5">
        <Button size="sm" variant="ghost" onClick={() => setGroupBy((v) => !v)} aria-pressed={groupBy}>
          <Rows3 className="h-3.5 w-3.5" />
          {groupBy ? 'Grouped' : 'Flat list'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setChimeEnabled((v) => !v)} aria-pressed={chimeEnabled}>
          {chimeEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          Chime
        </Button>
        <span className="mx-1 hidden h-4 w-px bg-border desktop:inline" aria-hidden="true" />
        <Button size="sm" variant="ghost" onClick={() => downloadCsv(filteredSorted)}>
          Export CSV
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void copyRowsAsMarkdown(filteredSorted)}>
          <Copy className="h-3.5 w-3.5" /> Copy as Markdown
        </Button>
        <Button size="sm" variant="ghost" onClick={() => store.getState().togglePause()} aria-pressed={isPaused}>
          {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {isPaused ? 'Resume scanning' : 'Pause scanning'}
        </Button>
        <span className="ml-auto text-xs text-text-secondary">
          {filteredSorted.length} of {rows.length} signals
          {isPaused ? (
            <span className="ml-2 font-medium text-warning">· scanning paused</span>
          ) : (
            secondsToNextScan !== null && <span className="ml-2 hidden font-mono tabular-nums desktop:inline">· next scan in {secondsToNextScan}s</span>
          )}
        </span>
      </div>

      {errors.length > 0 && <ErrorsStrip count={errors.length} errors={errors} onRetry={() => void store.getState().runScanNow()} />}

      {scanState === 'scanning' && (
        <div className="h-0.5 w-full bg-border" role="progressbar" aria-label="Scanning" aria-valuenow={scanProgress.done} aria-valuemin={0} aria-valuemax={scanProgress.total}>
          <div
            className="h-full bg-neutral transition-all duration-150"
            style={{ width: scanProgress.total > 0 ? `${(scanProgress.done / scanProgress.total) * 100}%` : '0%' }}
          />
        </div>
      )}

      {isDesktop && (
        <div role="row" className="grid border-b border-border bg-panel px-3 text-xs font-medium uppercase tracking-wide text-text-secondary" style={{ gridTemplateColumns: GRID_TEMPLATE }}>
          {COLUMN_META.map((col) => (
            <button
              key={col.key}
              type="button"
              role="columnheader"
              aria-sort={col.sortable ? ariaSortFor(sort.directionFor(col.key)) : undefined}
              disabled={!col.sortable}
              onClick={(e) => col.sortable && sort.handleHeaderClick(col.key, e.shiftKey)}
              className={cn(
                'flex h-8 items-center gap-1 py-1.5 text-left disabled:cursor-default',
                col.sortable && 'cursor-pointer hover:text-text-primary',
                col.align === 'right' && 'justify-end text-right',
              )}
            >
              {col.label}
              {col.sortable && <SortIndicator direction={sort.directionFor(col.key)} rank={sort.rankFor(col.key)} />}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1" role={isDesktop ? 'grid' : undefined} aria-label={isDesktop ? 'Signals' : undefined} aria-rowcount={isDesktop ? filteredSorted.length : undefined}>
        {scanState === 'loading-universe' && rows.length === 0 ? (
          <SkeletonTable />
        ) : filteredSorted.length === 0 ? (
          <ZeroSignalsEmptyState
            universeSize={universe.length}
            lastScanAt={store.getState().lastScanAt}
            secondsToNextScan={secondsToNextScan}
            hasFilters={filters.activeFilterCount > 0}
            onClearFilters={filters.clearAll}
          />
        ) : !isDesktop ? (
          <SignalCardList
            displayItems={displayItems}
            store={store}
            selectedRowId={selectedRowId}
            freshRowIds={freshRowIds.current}
            onOpenDetail={(rowId) => setDetailRowId(rowId)}
            collapsedGroups={collapsedGroups}
            onToggleGroup={(signal) =>
              setCollapsedGroups((prev) => {
                const next = new Set(prev)
                if (next.has(signal)) next.delete(signal)
                else next.add(signal)
                return next
              })
            }
          />
        ) : (
          <div ref={parentRef} className="h-full overflow-y-auto" role="rowgroup">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = displayItems[virtualRow.index]
                if (!item) return null

                if (item.type === 'group') {
                  return (
                    <GroupHeader
                      key={`group-${item.signal}`}
                      virtualRow={virtualRow}
                      signal={item.signal}
                      count={item.count}
                      collapsed={collapsedGroups.has(item.signal)}
                      onToggle={() =>
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev)
                          if (next.has(item.signal)) next.delete(item.signal)
                          else next.add(item.signal)
                          return next
                        })
                      }
                    />
                  )
                }

                return (
                  <SignalTableRowView
                    key={item.row.id}
                    row={item.row}
                    store={store}
                    virtualRow={virtualRow}
                    isSelected={item.row.id === selectedRowId}
                    isFresh={freshRowIds.current.has(item.row.id)}
                    isHoveredUnderlying={hoveredUnderlying === item.row.symbol}
                    onClick={() => {
                      store.getState().selectRow(item.row.id)
                      setDetailRowId(item.row.id)
                    }}
                    onContextMenu={(x, y) => setContextMenu({ x, y, rowId: item.row.id })}
                    onHoverDerived={(hovering) => setHoveredUnderlying(hovering ? (item.row.derivedFrom ?? null) : null)}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>

      <SignalDetail
        row={detailRow}
        rowList={filteredSorted}
        store={store}
        onClose={() => setDetailRowId(null)}
        onNavigate={(next) => {
          store.getState().selectRow(next.id)
          setDetailRowId(next.id)
        }}
      />

      {contextMenu && contextMenuRow && (
        <RowContextMenu
          state={contextMenu}
          pinned={contextMenuRow.pinned}
          onClose={() => setContextMenu(null)}
          onCopySymbol={() => {
            void navigator.clipboard.writeText(contextMenuRow.symbol)
            setContextMenu(null)
          }}
          onCopyJson={() => {
            void navigator.clipboard.writeText(JSON.stringify(contextMenuRow, null, 2))
            setContextMenu(null)
          }}
          onTogglePin={() => {
            store.getState().togglePin(contextMenuRow.id)
            setContextMenu(null)
          }}
          onOpenChart={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface SignalTableRowViewProps {
  row: ScreenerRow
  store: ScreenerStore
  virtualRow: { index: number; start: number; size: number }
  isSelected: boolean
  isFresh: boolean
  isHoveredUnderlying: boolean
  onClick: () => void
  onContextMenu: (x: number, y: number) => void
  onHoverDerived: (hovering: boolean) => void
}

function SignalTableRowView({ row, store, virtualRow, isSelected, isFresh, isHoveredUnderlying, onClick, onContextMenu, onHoverDerived }: SignalTableRowViewProps) {
  // Subscribes to just THIS row's token — a tick for any other token never
  // re-renders this row, which is what keeps 500 rows at 60fps under a
  // live tick stream.
  const ltp = store((s) => (row.token ? s.liveLtp.get(row.token) : undefined))
  const instrumentType = getInstrumentType(row)
  const derived = isDerivedRow(row)
  const change = ltp === undefined || row.price === 0 ? null : ((ltp - row.price) / row.price) * 100

  return (
    <div
      role="row"
      aria-selected={isSelected}
      tabIndex={isSelected ? 0 : -1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e.clientX, e.clientY)
      }}
      className={cn(
        'absolute left-0 right-0 grid items-center border-b border-border-hairline px-3 text-sm hover:bg-panel/60 cursor-pointer',
        isSelected && 'border-l-2 border-l-neutral bg-panel/40',
        row.status === 'fading' && 'opacity-50',
        isHoveredUnderlying && 'bg-neutral/10',
        isFresh && 'row-enter',
      )}
      style={{ gridTemplateColumns: GRID_TEMPLATE, transform: `translateY(${virtualRow.start}px)`, height: virtualRow.size }}
    >
      <span role="gridcell">
        <TimeCell epochSeconds={row.time} />
      </span>
      <span role="gridcell" className="flex items-center gap-1.5 truncate">
        <span className="truncate font-medium text-text-primary">{row.symbol}</span>
        <ExchangeChip exchange={row.exchange} />
        {row.pinned && <Pin className="h-3 w-3 shrink-0 text-warning" aria-label="Pinned" />}
      </span>
      <span role="gridcell">
        <InstrumentTypeChip type={instrumentType} />
      </span>
      <span role="gridcell" onMouseEnter={() => derived && onHoverDerived(true)} onMouseLeave={() => derived && onHoverDerived(false)}>
        <SignalBadge signal={row.signal} />
      </span>
      <span role="gridcell" className="text-right">
        <PriceCell price={row.price} />
      </span>
      <span role="gridcell" className="text-right">
        <LtpCell ltp={ltp} />
      </span>
      <span role="gridcell" className="text-right">
        <ChangePercentCell value={change} />
      </span>
      <span role="gridcell">
        <RsiCell rsi={row.rsi} inherited={derived ? row.derivedFrom : undefined} />
      </span>
      <span role="gridcell">
        <HaStreakSparkline colors={row.haStreak} />
      </span>
      <span role="gridcell" className="text-right">
        <LevelCell level={row.level} />
      </span>
      <span role="gridcell" className="flex items-center justify-end gap-1">
        <button
          type="button"
          aria-label="Pin"
          onClick={(e) => {
            e.stopPropagation()
            store.getState().togglePin(row.id)
          }}
          className={cn('text-text-muted hover:text-text-primary', row.pinned && 'text-warning')}
        >
          <Pin className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Copy symbol"
          onClick={(e) => {
            e.stopPropagation()
            void navigator.clipboard.writeText(row.symbol)
          }}
          className="text-text-muted hover:text-text-primary"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Copy row as JSON"
          onClick={(e) => {
            e.stopPropagation()
            void navigator.clipboard.writeText(JSON.stringify(row, null, 2))
          }}
          className="text-text-muted hover:text-text-primary"
        >
          <FileJson className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  )
}

function GroupHeader({
  virtualRow,
  signal,
  count,
  collapsed,
  onToggle,
}: {
  virtualRow: { start: number; size: number }
  signal: SignalKind
  count: number
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute left-0 right-0 flex items-center gap-2 border-b border-border bg-surface px-3 text-left text-xs font-medium text-text-secondary hover:text-text-primary"
      style={{ transform: `translateY(${virtualRow.start}px)`, height: virtualRow.size }}
    >
      {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      {signal}
      <span className="text-text-muted">({count})</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function SkeletonTable() {
  return (
    <div className="flex flex-col gap-px p-3">
      {Array.from({ length: 14 }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  )
}

function ZeroSignalsEmptyState({
  universeSize,
  lastScanAt,
  secondsToNextScan,
  hasFilters,
  onClearFilters,
}: {
  universeSize: number
  lastScanAt: number | null
  secondsToNextScan: number | null
  hasFilters: boolean
  onClearFilters: () => void
}) {
  if (hasFilters) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-text-primary">No signals match the current filters</p>
        <Button size="sm" variant="secondary" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    )
  }

  const scanTimeLabel = lastScanAt !== null ? formatISTTime(new Date(lastScanAt * 1000)) : '—'

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="max-w-md text-sm text-text-primary">
        Scanned {universeSize} instruments at {scanTimeLabel}. No instrument currently satisfies RSI 60–65 with a 2nd green HA
        candle, or RSI 35–40 with a 2nd red one.
      </p>
      {secondsToNextScan !== null && (
        <p className="font-mono text-xs tabular-nums text-text-secondary">Next scan in {secondsToNextScan}s</p>
      )}
    </div>
  )
}

function ErrorsStrip({ count, errors, onRetry }: { count: number; errors: { symbol: string; message: string }[]; onRetry: () => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border-b border-border bg-warning/10">
      <div className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-warning">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex flex-1 items-center gap-2 text-left">
          <AlertTriangle className="h-3.5 w-3.5" />
          {count} instrument{count === 1 ? '' : 's'} failed
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <Button size="sm" variant="ghost" onClick={onRetry}>
          <RotateCcw className="h-3 w-3" /> Retry these
        </Button>
      </div>
      {expanded && (
        <ul className="max-h-32 overflow-y-auto px-3 pb-2 text-xs text-text-secondary">
          {errors.map((err, i) => (
            <li key={i} className="flex gap-2 py-0.5">
              <span className="font-medium text-text-primary">{err.symbol}</span>
              <span>{err.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
