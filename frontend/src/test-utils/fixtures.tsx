/**
 * Component-test fixtures: a do-nothing MarketDataSource, a ScreenerRow
 * factory, a store seeded with fixture rows, and a renderer that mounts a
 * component inside a router with a probe exposing the current URL query.
 *
 * Component tests seed rows directly — they never boot the real mock data
 * source (that is the integration suite's job, see realMock.ts).
 */
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../data/MarketDataSource'
import type { ScanResult } from '../features/rsi-ha/scanner'
import { createScreenerStore, type ScreenerState, type ScreenerStore } from '../store/screenerStore'
import type { ScreenerRow } from '../store/types'
import type { ScripRow, SearchResponse } from '../types/api'
import type { Candle, Instrument, MarketTick } from '../types/domain'

export const FIXTURE_NOW = 1767598200 // 2026-01-05 13:00 IST

export class NoopDataSource implements MarketDataSource {
  /** Returned for every candle request. */
  candles: Candle[] = []
  /** Every token fetchHistoricalCandles() was asked for, in order. */
  requestedTokens: string[] = []
  async searchSymbol(): Promise<SearchResponse> {
    return { error: null, result: [] }
  }
  async fetchHistoricalCandles(token: string): Promise<Candle[]> {
    this.requestedTokens.push(token)
    return this.candles
  }
  async loadScripMaster(): Promise<ScripRow[]> {
    return []
  }
  subscribeTicks(_tokens: string[], _onTick: (tick: MarketTick) => void): () => void {
    return () => {}
  }
  getConnectionState(): ConnectionState {
    return 'connected'
  }
  async fetchIndexQuotes(keys: IndexQuoteKey[]): Promise<IndexQuote[]> {
    return keys.map((key) => ({ key, label: key, last: 0, prevClose: 0, changePct: 0, time: 0 }))
  }
  async fetchDailyBars(_instrument: Pick<Instrument, 'token' | 'exchange'>, _days: number): Promise<Candle[]> {
    return []
  }
}

let counter = 0
export function makeRow(overrides: Partial<ScreenerRow> = {}): ScreenerRow {
  counter += 1
  return {
    id: `row-${counter}`,
    // NFO by default: NSE equity rows are hidden by the store's output rule (selectVisibleRows) whenever it recomputes visibleRows.
    symbol: `SYM${counter}FUT`,
    exchange: 'NFO',
    signal: 'BUY',
    price: 2500,
    rsi: 62,
    time: FIXTURE_NOW - 300,
    status: 'active',
    firstSeenAt: FIXTURE_NOW - 300,
    lastSeenAt: FIXTURE_NOW - 300,
    pinned: false,
    token: `T${counter}`,
    haStreak: ['red', 'red', 'red', 'red', 'green', 'green'],
    ...overrides,
  }
}

/**
 * A real screener store (never started — no poll timer, no mock) seeded with
 * `rows`. Any rescan it triggers (a parameter change, a reset) runs in-thread
 * and returns `scanResult` — jsdom has no Web Worker for the real runner.
 */
export function seededStore(
  rows: ScreenerRow[],
  patch: Partial<ScreenerState> = {},
  source: MarketDataSource = new NoopDataSource(),
  scanResult: () => ScreenerRow[] = () => rows,
): ScreenerStore {
  const runScan = async (): Promise<ScanResult> => {
    const scanned = scanResult()
    return { rows: scanned, errors: [], visibleRows: scanned }
  }
  const store = createScreenerStore({ dataSource: source, now: () => FIXTURE_NOW, runScan })
  store.setState({ rows, visibleRows: rows, scanState: 'done', lastScanAt: FIXTURE_NOW, nextScanAt: FIXTURE_NOW + 300, ...patch })
  return store
}

/** Renders the current `?query` so a test can assert what a component wrote to the URL. */
function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location-search">{location.search}</output>
}

export function renderWithRouter(ui: ReactElement, initialEntries: string[] = ['/rsi-ha']): RenderResult {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      {ui}
      <LocationProbe />
    </MemoryRouter>,
  )
}

/**
 * jsdom has no layout, so every element reports 0 height and the virtualizer
 * would render nothing. Gives scroll containers a realistic viewport.
 */
export function mockViewportDimensions(height = 600): () => void {
  const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: height })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: height })
  return () => {
    if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight)
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
  }
}

/** Overrides window.matchMedia for the test: `wide` decides every `(min-width: …)` query. */
export function setViewportWidth(width: number): () => void {
  const original = window.matchMedia
  window.matchMedia = (query: string): MediaQueryList => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    const max = /max-width:\s*(\d+)px/.exec(query)
    const matches = min ? width >= Number(min[1]) : max ? width <= Number(max[1]) : false
    return { matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false } as MediaQueryList
  }
  return () => {
    window.matchMedia = original
  }
}
