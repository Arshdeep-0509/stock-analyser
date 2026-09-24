import { useRenderCount } from '../../lib/renderCounter'
import { X } from 'lucide-react'
import { Button } from '../../components/ui'
import { DEFAULT_FILTERS, matchesFilters, type IntradayStore } from '../../store/intradayStore'
import { activeFilterChips } from './filterChips'

export interface ActiveFilterBarProps {
  store: IntradayStore
}

/**
 * The one place every active filter dimension is visible at once, regardless
 * of which chart set it — a dismissible chip per dimension (reusing
 * activeFilterChips(), the SAME derivation every table's own empty-state
 * text uses, so this bar and a table's "Active: ..." message never
 * disagree), a "Showing N of M" live count, and one "Clear all" that resets
 * every dimension in one click.
 */
export function ActiveFilterBar({ store }: ActiveFilterBarProps) {
  useRenderCount('ActiveFilterBar')
  const filters = store((s) => s.filters)
  // Selecting the two NUMBERS (not `rows`) means a tick flush re-renders this bar only when a count actually changes.
  const totalCount = store((s) => s.rows.length)
  const visibleCount = store((s) => s.rows.reduce((n, r) => (matchesFilters(r, s.filters) ? n + 1 : n), 0))

  const chips = activeFilterChips(filters)
  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-border bg-panel px-3 py-1.5" role="region" aria-label="Active filters">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">Filters</span>
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
      <Button size="sm" variant="ghost" onClick={() => store.getState().setFilters({ ...DEFAULT_FILTERS })}>
        Clear all
      </Button>
      <span className="ml-auto text-xs text-text-secondary">
        Showing <span className="font-mono text-text-primary">{visibleCount}</span> of <span className="font-mono text-text-primary">{totalCount}</span> F&O
        names
      </span>
    </div>
  )
}
