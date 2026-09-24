import type { ReactNode } from 'react'
import { useState } from 'react'
import { SlidersHorizontal, Search, X } from 'lucide-react'
import { BottomSheet } from '../../components/ui/BottomSheet'
import { Input } from '../../components/ui/Input'
import { RangeSlider } from '../../components/ui/RangeSlider'
import { Toggle } from '../../components/ui/Toggle'
import { cn } from '../../lib/cn'
import { EXCHANGES, INSTRUMENT_TYPES, SIGNAL_KINDS } from './rowHelpers'
import type { useTableFilters } from './useTableFilters'

export interface FilterBarProps {
  filters: ReturnType<typeof useTableFilters>
  showNseEquityRows: boolean
  onShowNseEquityRowsChange: (show: boolean) => void
}

const chipBase = 'h-10 shrink-0 whitespace-nowrap rounded border px-2 text-xs font-medium transition-colors md:h-auto md:py-0.5'
const chipActive = 'border-neutral bg-neutral/15 text-neutral'
const chipInactive = 'border-border text-text-secondary hover:border-text-secondary hover:text-text-primary'

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    // aria-pressed: the selected state must not be conveyed by colour alone.
    <button type="button" aria-pressed={active} onClick={onClick} className={cn(chipBase, active ? chipActive : chipInactive)}>
      {children}
    </button>
  )
}

/** The RSI range, min price, and the equity-visibility toggle — shown inline at md+, tucked behind a "More filters" sheet below it. */
function MoreFilterFields({
  f,
  setRsiRange,
  setMinPrice,
  showNseEquityRows,
  onShowNseEquityRowsChange,
}: {
  f: ReturnType<typeof useTableFilters>['filters']
  setRsiRange: (min: number, max: number) => void
  setMinPrice: (value: number) => void
  showNseEquityRows: boolean
  onShowNseEquityRowsChange: (show: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-center">
      <span className="flex items-center gap-2 text-xs text-text-secondary md:inline-flex">
        RSI
        <span className="w-full max-w-[220px] md:w-32">
          <RangeSlider min={0} max={100} valueMin={f.rsiMin} valueMax={f.rsiMax} onChange={setRsiRange} />
        </span>
        <span className="w-16 shrink-0 font-mono tabular-nums text-text-primary">
          {f.rsiMin}–{f.rsiMax}
        </span>
      </span>

      <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
        Min price
        <Input
          type="number"
          min={0}
          value={f.minPrice || ''}
          onChange={(e) => setMinPrice(Number(e.target.value) || 0)}
          className="w-24 md:w-20"
          placeholder="0"
        />
      </label>

      <Toggle
        checked={showNseEquityRows}
        onChange={onShowNseEquityRowsChange}
        label="Show underlying equity signals (hidden by default, matching the screener's output rule)"
      />
    </div>
  )
}

export function FilterBar({ filters, showNseEquityRows, onShowNseEquityRowsChange }: FilterBarProps) {
  const { filters: f, searchInput, setSearchInput, toggleSignal, toggleExchange, toggleInstrumentType, setRsiRange, setMinPrice, clearAll, activeFilterCount } =
    filters
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false)

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-panel py-2">
      <div className="flex flex-wrap items-center gap-2 px-4 md:gap-3">
        <span className="relative inline-flex shrink-0 items-center">
          <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-text-muted" />
          <Input
            id="symbol-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search symbol… ( / )"
            className="w-32 pl-7 sm:w-44"
            aria-label="Search symbol"
          />
        </span>

        {/* Below md, the "More filters" trigger sits up here next to search/count/CSV/scan, which all stay visible at every width. */}
        <button
          type="button"
          onClick={() => setMoreFiltersOpen(true)}
          className="flex h-10 shrink-0 items-center gap-1 rounded border border-border px-2 text-xs font-medium text-text-secondary hover:text-text-primary md:hidden"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          More filters
        </button>

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="flex h-10 shrink-0 items-center gap-1 text-xs text-text-secondary hover:text-text-primary md:h-auto"
          >
            <X className="h-3 w-3" />
            Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {/*
        Chips bleed to the screen edge (no side padding on this row, padding
        moves inside via the first/last chip's own margin-equivalent gap) so
        it's visually obvious the row scrolls — a chip row that stops short
        of the edge reads as "that's all of them."
      */}
      <div className="flex gap-1 overflow-x-auto px-4" role="group" aria-label="Filter by signal">
        {SIGNAL_KINDS.map((signal) => (
          <Chip key={signal} active={f.signals.includes(signal)} onClick={() => toggleSignal(signal)}>
            {signal}
          </Chip>
        ))}
        <span className="mx-1 hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden="true" />
        {EXCHANGES.map((exchange) => (
          <Chip key={exchange} active={f.exchanges.includes(exchange)} onClick={() => toggleExchange(exchange)}>
            {exchange}
          </Chip>
        ))}
        <span className="mx-1 hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden="true" />
        {INSTRUMENT_TYPES.map((type) => (
          <Chip key={type} active={f.instrumentTypes.includes(type)} onClick={() => toggleInstrumentType(type)}>
            {type}
          </Chip>
        ))}
      </div>

      {/* Inline at md+; below md this same content lives in the sheet instead. */}
      <div className="hidden px-4 md:block">
        <MoreFilterFields
          f={f}
          setRsiRange={setRsiRange}
          setMinPrice={setMinPrice}
          showNseEquityRows={showNseEquityRows}
          onShowNseEquityRowsChange={onShowNseEquityRowsChange}
        />
      </div>

      <BottomSheet open={moreFiltersOpen} onClose={() => setMoreFiltersOpen(false)} title="More filters">
        <div className="p-4">
          <MoreFilterFields
            f={f}
            setRsiRange={setRsiRange}
            setMinPrice={setMinPrice}
            showNseEquityRows={showNseEquityRows}
            onShowNseEquityRowsChange={onShowNseEquityRowsChange}
          />
        </div>
      </BottomSheet>
    </div>
  )
}
