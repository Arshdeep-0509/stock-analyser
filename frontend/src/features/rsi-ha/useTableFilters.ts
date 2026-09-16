import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Exchange, SignalKind } from '../../types/domain'
import { EXCHANGES, INSTRUMENT_TYPES, SIGNAL_KINDS, type InstrumentType } from './rowHelpers'

export interface TableFilters {
  search: string
  signals: SignalKind[]
  exchanges: Exchange[]
  instrumentTypes: InstrumentType[]
  rsiMin: number
  rsiMax: number
  minPrice: number
}

const DEFAULT_FILTERS: TableFilters = {
  search: '',
  signals: [],
  exchanges: [],
  instrumentTypes: [],
  rsiMin: 0,
  rsiMax: 100,
  minPrice: 0,
}

const SEARCH_DEBOUNCE_MS = 250

function parseList<T extends string>(raw: string | null, valid: readonly T[]): T[] {
  if (!raw) return []
  const set = new Set(valid as readonly string[])
  return raw
    .split(',')
    .map((v) => decodeURIComponent(v))
    .filter((v): v is T => set.has(v))
}

function parseNumber(raw: string | null, fallback: number): number {
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function filtersFromParams(params: URLSearchParams): TableFilters {
  return {
    search: params.get('q') ?? '',
    signals: parseList(params.get('sig'), SIGNAL_KINDS),
    exchanges: parseList(params.get('exch'), EXCHANGES),
    instrumentTypes: parseList(params.get('itype'), INSTRUMENT_TYPES),
    rsiMin: parseNumber(params.get('rsiMin'), DEFAULT_FILTERS.rsiMin),
    rsiMax: parseNumber(params.get('rsiMax'), DEFAULT_FILTERS.rsiMax),
    minPrice: parseNumber(params.get('minPrice'), DEFAULT_FILTERS.minPrice),
  }
}

function paramsFromFilters(filters: TableFilters, previous: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(previous)
  const setOrDelete = (key: string, value: string | null) => {
    if (value === null || value === '') next.delete(key)
    else next.set(key, value)
  }

  setOrDelete('q', filters.search || null)
  setOrDelete('sig', filters.signals.length ? filters.signals.map(encodeURIComponent).join(',') : null)
  setOrDelete('exch', filters.exchanges.length ? filters.exchanges.join(',') : null)
  setOrDelete('itype', filters.instrumentTypes.length ? filters.instrumentTypes.join(',') : null)
  setOrDelete('rsiMin', filters.rsiMin !== DEFAULT_FILTERS.rsiMin ? String(filters.rsiMin) : null)
  setOrDelete('rsiMax', filters.rsiMax !== DEFAULT_FILTERS.rsiMax ? String(filters.rsiMax) : null)
  setOrDelete('minPrice', filters.minPrice !== DEFAULT_FILTERS.minPrice ? String(filters.minPrice) : null)

  return next
}

function toggleInArray<T>(arr: readonly T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
}

/** Lightweight subsequence fuzzy match (VSCode quick-open style): every character of `needle`, in order, appears somewhere in `haystack`. */
export function fuzzyMatch(needle: string, haystack: string): boolean {
  if (needle === '') return true
  let needleIndex = 0
  for (let i = 0; i < haystack.length && needleIndex < needle.length; i++) {
    if (haystack[i] === needle[needleIndex]) needleIndex += 1
  }
  return needleIndex === needle.length
}

/**
 * Filter state lives in the URL (via react-router's search params), so a
 * filtered view is shareable and survives a reload. Free-text search is
 * debounced locally before it touches the URL, so typing doesn't spam
 * history entries.
 */
export function useTableFilters() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams])

  const [searchInput, setSearchInput] = useState(filters.search)

  useEffect(() => {
    setSearchInput(filters.search)
    // Only resync from the URL (e.g. browser back/forward) — not on every local keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search])

  useEffect(() => {
    if (searchInput === filters.search) return
    const id = window.setTimeout(() => {
      setSearchParams((prev) => paramsFromFilters({ ...filtersFromParams(prev), search: searchInput }, prev), { replace: true })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput])

  const update = useCallback(
    (patch: Partial<TableFilters>) => {
      setSearchParams((prev) => paramsFromFilters({ ...filtersFromParams(prev), ...patch }, prev), { replace: true })
    },
    [setSearchParams],
  )

  const toggleSignal = useCallback((signal: SignalKind) => update({ signals: toggleInArray(filters.signals, signal) }), [filters.signals, update])
  const toggleExchange = useCallback(
    (exchange: Exchange) => update({ exchanges: toggleInArray(filters.exchanges, exchange) }),
    [filters.exchanges, update],
  )
  const toggleInstrumentType = useCallback(
    (type: InstrumentType) => update({ instrumentTypes: toggleInArray(filters.instrumentTypes, type) }),
    [filters.instrumentTypes, update],
  )
  const setRsiRange = useCallback((rsiMin: number, rsiMax: number) => update({ rsiMin, rsiMax }), [update])
  const setMinPrice = useCallback((minPrice: number) => update({ minPrice }), [update])

  const clearAll = useCallback(() => {
    setSearchInput('')
    setSearchParams((prev) => paramsFromFilters(DEFAULT_FILTERS, prev), { replace: true })
  }, [setSearchParams])

  const activeFilterCount =
    (filters.search ? 1 : 0) +
    filters.signals.length +
    filters.exchanges.length +
    filters.instrumentTypes.length +
    (filters.rsiMin !== DEFAULT_FILTERS.rsiMin || filters.rsiMax !== DEFAULT_FILTERS.rsiMax ? 1 : 0) +
    (filters.minPrice !== DEFAULT_FILTERS.minPrice ? 1 : 0)

  return {
    filters: { ...filters, search: searchInput },
    searchInput,
    setSearchInput,
    toggleSignal,
    toggleExchange,
    toggleInstrumentType,
    setRsiRange,
    setMinPrice,
    clearAll,
    activeFilterCount,
  }
}

/** Applies filters to a row list — pure, so it's independently testable. */
export function applyFilters<T extends { symbol: string; signal: SignalKind; exchange: Exchange; rsi: number; price: number }>(
  rows: readonly T[],
  filters: TableFilters,
  getInstrumentType: (row: T) => InstrumentType,
): T[] {
  const needle = filters.search.trim().toUpperCase()

  return rows.filter((row) => {
    if (needle && !fuzzyMatch(needle, row.symbol.toUpperCase())) return false
    if (filters.signals.length && !filters.signals.includes(row.signal)) return false
    if (filters.exchanges.length && !filters.exchanges.includes(row.exchange)) return false
    if (filters.instrumentTypes.length && !filters.instrumentTypes.includes(getInstrumentType(row))) return false
    if (!Number.isNaN(row.rsi) && (row.rsi < filters.rsiMin || row.rsi > filters.rsiMax)) return false
    if (row.price < filters.minPrice) return false
    return true
  })
}
