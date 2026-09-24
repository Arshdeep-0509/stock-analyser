import { useEffect } from 'react'

/**
 * Dev-only render-count registry, read by the `~` devtools panel's render
 * overlay. Counts COMMITS (an effect with no deps runs once per committed
 * render), not render-function calls, so React StrictMode's dev-only double
 * render doesn't inflate the numbers.
 *
 * Deliberately not a store and never notifies anyone: bumping a counter must
 * not itself trigger a render. The overlay polls getRenderCounts() instead.
 */
const counts = new Map<string, number>()

export function useRenderCount(name: string): void {
  useEffect(() => {
    if (!import.meta.env?.DEV) return
    counts.set(name, (counts.get(name) ?? 0) + 1)
  })
}

export function getRenderCount(name: string): number {
  return counts.get(name) ?? 0
}

/** A sorted snapshot — highest count first. */
export function getRenderCounts(): { name: string; count: number }[] {
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export function resetRenderCounts(): void {
  counts.clear()
}
