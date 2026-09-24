import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { INDEX_PANELS } from '../../data/reference/indices'
import { DEFAULT_FILTERS, type IntradayFilters, type IntradayStore } from '../../store/intradayStore'
import type { IndexKey } from '../../types/domain'

const VALID_INDEX_KEYS: ReadonlySet<string> = new Set(INDEX_PANELS.map((p) => p.key))
const VALID_DIRECTIONS: ReadonlySet<string> = new Set(['all', 'up', 'down'])

function parseIndexKey(raw: string | null): IndexKey | undefined {
  return raw !== null && VALID_INDEX_KEYS.has(raw) ? (raw as IndexKey) : undefined
}

function parseDirection(raw: string | null): IntradayFilters['direction'] | undefined {
  return raw !== null && VALID_DIRECTIONS.has(raw) ? (raw as IntradayFilters['direction']) : undefined
}

/**
 * The 7 canonical, shareable filter dimensions — deliberately NOT including
 * `tokens` (SmartMoney's per-click token whitelist): that's a derived,
 * click-scoped snapshot rather than a named criterion a shared link should
 * carry, and it doesn't serialise to a short URL cleanly either.
 */
export function filtersFromSearchParams(params: URLSearchParams): Partial<IntradayFilters> {
  const patch: Partial<IntradayFilters> = {}
  if (params.has('sector')) patch.sector = params.get('sector')
  const index = parseIndexKey(params.get('index'))
  if (index !== undefined) patch.index = index
  const direction = parseDirection(params.get('dir'))
  if (direction !== undefined) patch.direction = direction
  if (params.has('minStrength')) {
    const parsed = Number(params.get('minStrength'))
    patch.minStrength = Number.isFinite(parsed) ? parsed : DEFAULT_FILTERS.minStrength
  }
  if (params.has('breakout')) patch.breakoutOnly = params.get('breakout') === '1'
  if (params.has('smartMoney')) patch.smartMoneyOnly = params.get('smartMoney') === '1'
  if (params.has('q')) patch.q = params.get('q') ?? ''
  return patch
}

export function searchParamsFromFilters(filters: IntradayFilters, previous: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(previous)
  const setOrDelete = (key: string, value: string | null) => {
    if (value === null) next.delete(key)
    else next.set(key, value)
  }

  setOrDelete('sector', filters.sector)
  setOrDelete('index', filters.index)
  setOrDelete('dir', filters.direction !== 'all' ? filters.direction : null)
  setOrDelete('minStrength', filters.minStrength > 0 ? String(filters.minStrength) : null)
  setOrDelete('breakout', filters.breakoutOnly ? '1' : null)
  setOrDelete('smartMoney', filters.smartMoneyOnly ? '1' : null)
  setOrDelete('q', filters.q.trim() !== '' ? filters.q : null)

  return next
}

/**
 * One-way-with-one-time-hydration sync between the URL and the store's own
 * `filters` (unlike /rsi-ha's useTableFilters, where the URL itself IS the
 * state — intraday's filters already live in the store, set directly by a
 * dozen chart click-handlers, so rewiring every one of them through a URL
 * hook would be a much bigger, riskier change for the same result). On
 * mount, whatever's in the URL is applied to the store once (this is what
 * makes a shared link and a page reload both work). After that, any store
 * filter change — from a URL edit OR a chart click — is mirrored back into
 * the URL (replacing, not pushing, so filter tweaks don't spam browser
 * history).
 */
export function useIntradayUrlSync(store: IntradayStore): void {
  const [searchParams, setSearchParams] = useSearchParams()
  // A state flag, not a ref: setFilters() below and setHydrated() both fire
  // inside the SAME effect, so React 18 batches them into one re-render —
  // the mirror effect below then sees `hydrated` and the freshly-hydrated
  // `filters` TOGETHER, in the same pass. A ref-based gate checked
  // synchronously would instead let the mirror effect's first run see a
  // stale (pre-hydration) `filters` closure and briefly write the OLD
  // defaults back over the just-read URL.
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const initial = filtersFromSearchParams(searchParams)
    if (Object.keys(initial).length > 0) store.getState().setFilters(initial)
    setHydrated(true)
    // Intentionally empty deps: this must run exactly once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filters = store((s) => s.filters)
  useEffect(() => {
    if (!hydrated) return
    setSearchParams((prev) => searchParamsFromFilters(filters, prev), { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, hydrated])
}
