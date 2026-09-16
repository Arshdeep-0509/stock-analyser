import { useCallback, useMemo, useState } from 'react'

export type SortDirection = 'asc' | 'desc'

export interface SortRule {
  key: string
  direction: SortDirection
}

export interface SortableColumn<T> {
  key: string
  sortValue: (row: T) => number | string
}

/**
 * Compares two rows across every active sort rule in order. A NaN sort
 * value (e.g. an RSI that hasn't warmed up yet) always sorts to the end,
 * regardless of the column's sort direction — this is checked BEFORE the
 * direction flip is applied, so flipping asc/desc never brings NaN rows
 * back to the top.
 */
export function compareRows<T>(a: T, b: T, rules: readonly SortRule[], columns: Record<string, SortableColumn<T>>): number {
  for (const rule of rules) {
    const column = columns[rule.key]
    if (!column) continue

    const av = column.sortValue(a)
    const bv = column.sortValue(b)
    const aIsNaN = typeof av === 'number' && Number.isNaN(av)
    const bIsNaN = typeof bv === 'number' && Number.isNaN(bv)

    if (aIsNaN && bIsNaN) continue
    if (aIsNaN) return 1
    if (bIsNaN) return -1

    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
    if (cmp !== 0) return rule.direction === 'asc' ? cmp : -cmp
  }
  return 0
}

/**
 * Click a header to sort by it alone (asc -> desc -> unsorted). Shift-click
 * to add/flip/drop it as an additional rule on top of whatever's already
 * active, for multi-column sort.
 */
export function useSort(initialRules: SortRule[] = []) {
  const [rules, setRules] = useState<SortRule[]>(initialRules)

  const handleHeaderClick = useCallback((key: string, shiftKey: boolean) => {
    setRules((prev) => {
      const index = prev.findIndex((r) => r.key === key)

      if (shiftKey) {
        if (index === -1) return [...prev, { key, direction: 'asc' }]
        const current = prev[index]
        if (current.direction === 'asc') {
          const next = prev.slice()
          next[index] = { key, direction: 'desc' }
          return next
        }
        return prev.filter((r) => r.key !== key)
      }

      if (prev.length === 1 && index === 0) {
        return prev[0].direction === 'asc' ? [{ key, direction: 'desc' }] : []
      }
      return [{ key, direction: 'asc' }]
    })
  }, [])

  const directionFor = useCallback((key: string): SortDirection | null => rules.find((r) => r.key === key)?.direction ?? null, [rules])
  const rankFor = useCallback((key: string): number | null => {
    const index = rules.findIndex((r) => r.key === key)
    return index === -1 ? null : index + 1
  }, [rules])

  return useMemo(
    () => ({ rules, handleHeaderClick, directionFor, rankFor, setRules }),
    [rules, handleHeaderClick, directionFor, rankFor],
  )
}
