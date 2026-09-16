import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, Copy, FileJson, Pin } from 'lucide-react'
import { useRef } from 'react'
import { cn } from '../../lib/cn'
import type { ScreenerStore } from '../../store/screenerStore'
import type { ScreenerRow } from '../../store/types'
import type { SignalKind } from '../../types/domain'
import { ChangePercentCell, ExchangeChip, HaStreakSparkline, InstrumentTypeChip, LevelCell, LtpCell, PriceCell, RsiCell, SignalBadge } from './cells'
import { getInstrumentType, isDerivedRow } from './rowHelpers'
import { formatISTTime } from '../../lib/formatters'

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

const CARD_HEIGHT = 116
const GROUP_HEADER_HEIGHT = 32

/** The <900px counterpart to SignalsTable's virtualized grid — same data, same actions, a card per instrument instead of a table row. */
export function SignalCardList({ displayItems, store, selectedRowId, freshRowIds, onOpenDetail, collapsedGroups, onToggleGroup }: SignalCardListProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (displayItems[index]?.type === 'group' ? GROUP_HEADER_HEIGHT : CARD_HEIGHT),
    overscan: 8,
  })

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
            />
          )
        })}
      </div>
    </div>
  )
}

function SignalCard({
  row,
  store,
  isSelected,
  isFresh,
  style,
  onOpen,
}: {
  row: ScreenerRow
  store: ScreenerStore
  isSelected: boolean
  isFresh: boolean
  style: React.CSSProperties
  onOpen: () => void
}) {
  const ltp = store((s) => (row.token ? s.liveLtp.get(row.token) : undefined))
  const instrumentType = getInstrumentType(row)
  const derived = isDerivedRow(row)
  const change = ltp === undefined || row.price === 0 ? null : ((ltp - row.price) / row.price) * 100

  return (
    <div
      role="listitem"
      style={style}
      className={cn('absolute left-0 right-0 px-1 py-1')}
    >
      {/*
        A div, not a <button> — it wraps its own interactive controls
        (pin/copy/JSON), and a <button> can never legally contain other
        interactive elements. role="button" + tabIndex + onKeyDown recreate
        button semantics/keyboard behaviour without that HTML violation.
      */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
        aria-selected={isSelected}
        className={cn(
          'flex h-full w-full flex-col gap-1.5 rounded border border-border-hairline bg-panel px-3 py-2 text-left',
          isSelected && 'border-l-2 border-l-neutral',
          row.status === 'fading' && 'opacity-50',
          isFresh && 'row-enter',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-text-primary">{row.symbol}</span>
            <ExchangeChip exchange={row.exchange} />
            <InstrumentTypeChip type={instrumentType} />
            {row.pinned && <Pin className="h-3 w-3 shrink-0 text-warning" aria-label="Pinned" />}
          </span>
          <SignalBadge signal={row.signal} />
        </div>

        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span className="flex items-center gap-3">
            <PriceCell price={row.price} />
            <LtpCell ltp={ltp} />
            <ChangePercentCell value={change} />
          </span>
          <span className="font-mono tabular-nums">{formatISTTime(new Date(row.time * 1000))}</span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-3">
            <RsiCell rsi={row.rsi} inherited={derived ? row.derivedFrom : undefined} />
            <HaStreakSparkline colors={row.haStreak} />
            {row.level !== undefined && <LevelCell level={row.level} />}
          </span>
          <span className="flex items-center gap-2">
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
              className={cn('text-text-muted hover:text-text-primary', row.pinned && 'text-warning')}
            >
              <Pin className="h-3.5 w-3.5" />
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label="Copy symbol"
              onClick={(e) => {
                e.stopPropagation()
                void navigator.clipboard.writeText(row.symbol)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  void navigator.clipboard.writeText(row.symbol)
                }
              }}
              className="text-text-muted hover:text-text-primary"
            >
              <Copy className="h-3.5 w-3.5" />
            </span>
            <span
              role="button"
              tabIndex={0}
              aria-label="Copy row as JSON"
              onClick={(e) => {
                e.stopPropagation()
                void navigator.clipboard.writeText(JSON.stringify(row, null, 2))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  void navigator.clipboard.writeText(JSON.stringify(row, null, 2))
                }
              }}
              className="text-text-muted hover:text-text-primary"
            >
              <FileJson className="h-3.5 w-3.5" />
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
