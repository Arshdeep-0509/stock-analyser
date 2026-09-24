import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, Pin } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { formatISTTime } from '../../lib/formatters'
import type { ScreenerStore } from '../../store/screenerStore'
import type { ScreenerRow } from '../../store/types'
import type { SignalKind } from '../../types/domain'
import { RowContextMenu, type ContextMenuState } from './RowContextMenu'
import { ChangePercentCell, ExchangeChip, HaStreakSparkline, InstrumentTypeChip, LevelCell, LtpCell, PriceCell, RsiCell, SignalBadge } from './cells'
import { getInstrumentType, isDerivedRow } from './rowHelpers'

type DisplayItem = { type: 'group'; signal: SignalKind; count: number } | { type: 'row'; row: ScreenerRow }

export interface SignalCardListProps {
  displayItems: DisplayItem[]
  store: ScreenerStore
  selectedRowId: string | null
  freshRowIds: Set<string>
  onOpenDetail: (rowId: string) => void
  collapsedGroups: Set<SignalKind>
  onToggleGroup: (signal: SignalKind) => void
}

const CARD_HEIGHT = 104
const GROUP_HEADER_HEIGHT = 32
const LONG_PRESS_MS = 450
// Keeps the long-press context menu from opening off the right/bottom edge
// of a narrow viewport.
const MENU_WIDTH = 192
const MENU_HEIGHT = 176

/** The <900px counterpart to SignalsTable's virtualized grid — same data, same actions, a card per instrument instead of a table row. */
export function SignalCardList({ displayItems, store, selectedRowId, freshRowIds, onOpenDetail, collapsedGroups, onToggleGroup }: SignalCardListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenuState] = useState<ContextMenuState | null>(null)

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (displayItems[index]?.type === 'group' ? GROUP_HEADER_HEIGHT : CARD_HEIGHT),
    overscan: 8,
  })

  // This card list only ever exists while !isDesktop, so unlike
  // SignalsTable's grid virtualizer it doesn't need to re-measure on a
  // desktop<->card flip — but it DOES need to on an orientation change or a
  // viewport resize that changes how much horizontal room a card's content
  // has to wrap into, which can change CARD_HEIGHT's accuracy. Re-measuring
  // on every resize is cheap and keeps row pitch correct.
  useEffect(() => {
    function onResize() {
      virtualizer.measure()
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const contextMenuRow = contextMenu
    ? (displayItems.find((i) => i.type === 'row' && i.row.id === contextMenu.rowId) as Extract<DisplayItem, { type: 'row' }> | undefined)?.row
    : undefined

  return (
    <div ref={parentRef} className="h-full overflow-y-auto px-2" role="list" aria-label="Signals">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = displayItems[virtualRow.index]
          if (!item) return null

          if (item.type === 'group') {
            return (
              <button
                key={`group-${item.signal}`}
                type="button"
                onClick={() => onToggleGroup(item.signal)}
                className="absolute left-0 right-0 flex items-center gap-2 px-1 text-left text-xs font-medium text-text-secondary hover:text-text-primary"
                style={{ transform: `translateY(${virtualRow.start}px)`, height: virtualRow.size }}
              >
                {collapsedGroups.has(item.signal) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {item.signal}
                <span className="text-text-muted">({item.count})</span>
              </button>
            )
          }

          return (
            <SignalCard
              key={item.row.id}
              row={item.row}
              store={store}
              isSelected={item.row.id === selectedRowId}
              isFresh={freshRowIds.has(item.row.id)}
              style={{ transform: `translateY(${virtualRow.start}px)`, height: virtualRow.size }}
              onOpen={() => {
                store.getState().selectRow(item.row.id)
                onOpenDetail(item.row.id)
              }}
              onLongPress={(x, y) => {
                setContextMenuState(clampMenuPosition(x, y, item.row.id))
              }}
            />
          )
        })}
      </div>

      {contextMenu && contextMenuRow && (
        <RowContextMenu
          state={contextMenu}
          pinned={contextMenuRow.pinned}
          onClose={() => setContextMenuState(null)}
          onCopySymbol={() => {
            void navigator.clipboard.writeText(contextMenuRow.symbol)
            setContextMenuState(null)
          }}
          onCopyJson={() => {
            void navigator.clipboard.writeText(JSON.stringify(contextMenuRow, null, 2))
            setContextMenuState(null)
          }}
          onTogglePin={() => {
            store.getState().togglePin(contextMenuRow.id)
            setContextMenuState(null)
          }}
          onOpenChart={() => {
            store.getState().selectRow(contextMenuRow.id)
            onOpenDetail(contextMenuRow.id)
            setContextMenuState(null)
          }}
        />
      )}
    </div>
  )
}

function clampMenuPosition(x: number, y: number, rowId: string): ContextMenuState {
  const maxX = window.innerWidth - MENU_WIDTH - 8
  const maxY = window.innerHeight - MENU_HEIGHT - 8
  return { x: Math.max(8, Math.min(x, maxX)), y: Math.max(8, Math.min(y, maxY)), rowId }
}

interface SignalCardProps {
  row: ScreenerRow
  store: ScreenerStore
  isSelected: boolean
  isFresh: boolean
  style: React.CSSProperties
  onOpen: () => void
  onLongPress: (x: number, y: number) => void
}

function SignalCard({ row, store, isSelected, isFresh, style, onOpen, onLongPress }: SignalCardProps) {
  const ltp = store((s) => (row.token ? s.liveLtp.get(row.token) : undefined))
  const params = store((s) => s.params)
  const instrumentType = getInstrumentType(row)
  const derived = isDerivedRow(row)
  const change = ltp === undefined || row.price === 0 ? null : ((ltp - row.price) / row.price) * 100

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  function startPress(x: number, y: number) {
    longPressed.current = false
    pressTimer.current = setTimeout(() => {
      longPressed.current = true
      onLongPress(x, y)
    }, LONG_PRESS_MS)
  }
  function cancelPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current)
  }

  return (
    <div role="listitem" style={style} className="absolute left-0 right-0 px-1 py-1">
      {/*
        A div, not a <button> — it wraps its own interactive controls
        (pin/copy/JSON), and a <button> can never legally contain other
        interactive elements. role="button" + tabIndex + onKeyDown recreate
        button semantics/keyboard behaviour without that HTML violation.
      */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (longPressed.current) return
          onOpen()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onLongPress(e.clientX, e.clientY)
        }}
        onTouchStart={(e) => {
          const touch = e.touches[0]
          if (touch) startPress(touch.clientX, touch.clientY)
        }}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
        onPointerDown={(e) => {
          if (e.pointerType !== 'touch') startPress(e.clientX, e.clientY)
        }}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        aria-selected={isSelected}
        className={cn(
          'flex h-full w-full flex-col justify-between gap-1 rounded border border-border-hairline bg-panel px-3 py-2 text-left',
          isSelected && 'border-l-2 border-l-neutral',
          row.status === 'fading' && 'opacity-50',
          isFresh && 'row-enter',
        )}
      >
        {/* Line 1: symbol (truncated) + signal badge. */}
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-text-primary">{row.symbol}</span>
          <span className="shrink-0">
            <SignalBadge signal={row.signal} />
          </span>
        </div>

        {/* Line 2: price, live LTP with its flash, change %. */}
        <div className="flex items-center gap-3 text-xs text-text-secondary">
          <PriceCell price={row.price} />
          <LtpCell ltp={ltp} />
          <ChangePercentCell value={change} />
        </div>

        {/* Line 3: time, exchange chip, instrument chip, RSI, HA sparkline, breakout level. */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex min-w-0 items-center gap-2 overflow-hidden">
            <span className="shrink-0 font-mono tabular-nums text-text-muted">{formatISTTime(new Date(row.time * 1000))}</span>
            <ExchangeChip exchange={row.exchange} />
            <InstrumentTypeChip type={instrumentType} />
            {row.pinned && <Pin className="h-3 w-3 shrink-0 text-warning" aria-label="Pinned" />}
            <RsiCell rsi={row.rsi} inherited={derived ? row.derivedFrom : undefined} bands={params} />
            <HaStreakSparkline colors={row.haStreak} />
            {row.level !== undefined && <LevelCell level={row.level} />}
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label="Pin"
            onClick={(e) => {
              e.stopPropagation()
              store.getState().togglePin(row.id)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                store.getState().togglePin(row.id)
              }
            }}
            className={cn('shrink-0 text-text-muted hover:text-text-primary', row.pinned && 'text-warning')}
          >
            <Pin className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </div>
  )
}
