import type { ReactNode } from 'react'
import { Search, X } from 'lucide-react'
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
  /** Skips the search input — used when this is embedded in the mobile filters sheet, which sits below a search bar that's already always visible. */
  hideSearch?: boolean
}

const chipBase = 'rounded border px-2 py-0.5 text-xs font-medium transition-colors'
const chipActive = 'border-neutral bg-neutral/15 text-neutral'
const chipInactive = 'border-border text-text-secondary hover:border-text-secondary hover:text-text-primary'

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn(chipBase, active ? chipActive : chipInactive)}>
      {children}
    </button>
  )
}

export function FilterBar({ filters, showNseEquityRows, onShowNseEquityRowsChange, hideSearch }: FilterBarProps) {
  const { filters: f, searchInput, setSearchInput, toggleSignal, toggleExchange, toggleInstrumentType, setRsiRange, setMinPrice, clearAll, activeFilterCount } =
    filters

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        {!hideSearch && (
          <span className="relative inline-flex items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-text-muted" />
            <Input
              id="symbol-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search symbol… ( / )"
              className="w-44 pl-7"
              aria-label="Search symbol"
            />
          </span>
        )}

        <div className="flex items-center gap-1" role="group" aria-label="Filter by signal">
          {SIGNAL_KINDS.map((signal) => (
            <Chip key={signal} active={f.signals.includes(signal)} onClick={() => toggleSignal(signal)}>
              {signal}
            </Chip>
          ))}
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Filter by exchange">
          {EXCHANGES.map((exchange) => (
            <Chip key={exchange} active={f.exchanges.includes(exchange)} onClick={() => toggleExchange(exchange)}>
              {exchange}
            </Chip>
          ))}
        </div>

        <div className="flex items-center rounded border border-border" role="group" aria-label="Filter by instrument type">
          {INSTRUMENT_TYPES.map((type, i) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleInstrumentType(type)}
              className={cn(
                'px-2 py-0.5 text-xs font-medium transition-colors',
                i > 0 && 'border-l border-border',
                f.instrumentTypes.includes(type) ? 'bg-neutral/15 text-neutral' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {type}
            </button>
          ))}
        </div>

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
          >
            <X className="h-3 w-3" />
            Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex items-center gap-2 text-xs text-text-secondary">
          RSI
          <span className="w-32">
            <RangeSlider min={0} max={100} valueMin={f.rsiMin} valueMax={f.rsiMax} onChange={setRsiRange} />
          </span>
          <span className="w-16 font-mono tabular-nums text-text-primary">
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
            className="w-20"
            placeholder="0"
          />
        </label>

        <Toggle
          checked={showNseEquityRows}
          onChange={onShowNseEquityRowsChange}
          label="Show underlying equity signals (hidden by default, matching the screener's output rule)"
        />
      </div>
    </div>
  )
}
