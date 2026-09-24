import { INDEX_PANELS } from '../../data/reference/indices'
import type { IntradayFilters } from '../../store/intradayStore'

export interface FilterChip {
  key: string
  label: string
  clear: Partial<IntradayFilters>
}

/**
 * Every dashboard-wide filter dimension that's currently non-default, as a
 * dismissible-chip description — shared by every /intraday table's header
 * chip row and its "filters exclude everything" empty state, so no two
 * tables ever describe the same active filters differently.
 */
export function activeFilterChips(filters: IntradayFilters): FilterChip[] {
  const chips: FilterChip[] = []
  if (filters.sector !== null) chips.push({ key: 'sector', label: `Sector: ${filters.sector}`, clear: { sector: null } })
  if (filters.index !== null) {
    const label = INDEX_PANELS.find((p) => p.key === filters.index)?.label ?? filters.index
    chips.push({ key: 'index', label: `Index: ${label}`, clear: { index: null } })
  }
  if (filters.tokens !== null) {
    chips.push({ key: 'tokens', label: `${filters.tokens.length} selected name${filters.tokens.length === 1 ? '' : 's'}`, clear: { tokens: null } })
  }
  if (filters.q.trim() !== '') chips.push({ key: 'q', label: `Search: "${filters.q.trim()}"`, clear: { q: '' } })
  if (filters.minStrength > 0) chips.push({ key: 'minStrength', label: `Strength ≥ ${filters.minStrength}`, clear: { minStrength: 0 } })
  if (filters.direction !== 'all') {
    chips.push({ key: 'direction', label: filters.direction === 'up' ? 'Advancing only' : 'Declining only', clear: { direction: 'all' } })
  }
  if (filters.breakoutOnly) chips.push({ key: 'breakoutOnly', label: 'Breakout only', clear: { breakoutOnly: false } })
  if (filters.smartMoneyOnly) chips.push({ key: 'smartMoneyOnly', label: 'Smart money only', clear: { smartMoneyOnly: false } })
  return chips
}
