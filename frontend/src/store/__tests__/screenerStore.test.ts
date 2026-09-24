import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MarketDataSource, ConnectionState, IndexQuote, IndexQuoteKey } from '../../data/MarketDataSource'
import type { ScripRow, SearchResponse } from '../../types/api'
import type { Candle, Exchange, Instrument, MarketTick } from '../../types/domain'
import { createScreenerStore, type ScreenerStore } from '../screenerStore'
import buyCandlesFixture from '../../features/rsi-ha/__tests__/fixtures/buy-candles.json'

const buyCandles = buyCandlesFixture as Candle[]

function flatCandles(price: number): Candle[] {
  return Array.from({ length: 20 }, (_, i) => ({ time: i * 300, open: price, high: price, low: price, close: price, volume: 1000 }))
}

const SCRIP_ROWS: ScripRow[] = [
  { exchange: 'NSE', instrument_name: 'EQ', trading_symbol: 'BUYER-EQ', exchange_token: 'T1', close_price: '8800', expiry: '', company_name: 'BUYER', strike: '', option_type: '' },
  { exchange: 'NSE', instrument_name: 'EQ', trading_symbol: 'FLAT-EQ', exchange_token: 'T2', close_price: '2500', expiry: '', company_name: 'FLAT', strike: '', option_type: '' },
]

class FakeDataSource implements MarketDataSource {
  candlesByToken = new Map<string, Candle[]>([
    ['T1', buyCandles],
    ['T2', flatCandles(2500)],
  ])
  connectionState: ConnectionState = 'connected'
  tickListener: ((tick: MarketTick) => void) | null = null

  async searchSymbol(): Promise<SearchResponse> {
    return { error: null, result: [] }
  }

  async fetchHistoricalCandles(token: string): Promise<Candle[]> {
    return this.candlesByToken.get(token) ?? []
  }

  async loadScripMaster(): Promise<ScripRow[]> {
    return SCRIP_ROWS
  }

  subscribeTicks(_tokens: string[], onTick: (tick: MarketTick) => void): () => void {
    this.tickListener = onTick
    return () => {
      this.tickListener = null
    }
  }

  getConnectionState(): ConnectionState {
    return this.connectionState
  }

  async fetchIndexQuotes(keys: IndexQuoteKey[]): Promise<IndexQuote[]> {
    return keys.map((key) => ({ key, label: key, last: 0, prevClose: 0, changePct: 0, time: 0 }))
  }

  async fetchDailyBars(_instrument: Pick<Instrument, 'token' | 'exchange'>, _days: number): Promise<Candle[]> {
    return []
  }

  emitTick(token: string, ltp: number, time: number, exchange: Exchange = 'NSE'): void {
    this.tickListener?.({ token, exchange, ltp, time })
  }
}

let store: ScreenerStore | null = null

afterEach(() => {
  store?.getState().stop()
  store = null
  vi.useRealTimers()
})

describe('screenerStore', () => {
  it('loads a universe and populates rows from a real (non-worker) scan', async () => {
    const dataSource = new FakeDataSource()
    let nowSec = 1767609600
    store = createScreenerStore({
      dataSource,
      now: () => nowSec,
      runScan: (universe, ds, atmMap, params, onProgress) =>
        import('../../features/rsi-ha/scanner').then((m) => m.runFullScan(universe, ds, atmMap, params, onProgress)),
    })

    await store.getState().loadUniverse()
    await store.getState().runScanNow()

    const state = store.getState()
    expect(state.scanState).toBe('done')
    const buyRow = state.rows.find((r) => r.symbol === 'BUYER-EQ')
    expect(buyRow).toBeDefined()
    expect(buyRow?.signal).toBe('BUY')
    expect(state.lastScanAt).toBe(nowSec)
    expect(state.nextScanAt).toBe(nowSec + state.params.scanEverySeconds)
  })

  it('updates an existing row in place on a repeated scan instead of duplicating it', async () => {
    const dataSource = new FakeDataSource()
    const nowSec = 1767609600
    store = createScreenerStore({
      dataSource,
      now: () => nowSec,
      runScan: (universe, ds, atmMap, params, onProgress) =>
        import('../../features/rsi-ha/scanner').then((m) => m.runFullScan(universe, ds, atmMap, params, onProgress)),
    })

    await store.getState().loadUniverse()
    await store.getState().runScanNow()
    const firstId = store.getState().rows.find((r) => r.symbol === 'BUYER-EQ')?.id

    await store.getState().runScanNow()
    const rowsForBuyer = store.getState().rows.filter((r) => r.symbol === 'BUYER-EQ' && r.signal === 'BUY')

    expect(rowsForBuyer).toHaveLength(1)
    expect(rowsForBuyer[0].id).toBe(firstId)
  })

  it('a WS tick updates liveLtp but never touches rows (signals only evaluate on closed candles)', async () => {
    const dataSource = new FakeDataSource()
    store = createScreenerStore({ dataSource, now: () => 1767609600 })

    await store.getState().loadUniverse()
    const rowsBefore = store.getState().rows

    dataSource.emitTick('T2', 9999, 1767609600)

    expect(store.getState().liveLtp.get('T2')).toBe(9999)
    expect(store.getState().rows).toBe(rowsBefore)
  })

  it('re-evaluates a symbol only once its bar actually closes (a new bar-start bucket), not on every tick', async () => {
    const dataSource = new FakeDataSource()
    store = createScreenerStore({
      dataSource,
      now: () => 1767609900,
      runScan: (universe, ds, atmMap, params, onProgress) =>
        import('../../features/rsi-ha/scanner').then((m) => m.runFullScan(universe, ds, atmMap, params, onProgress)),
    })

    await store.getState().loadUniverse()

    // Two ticks inside the SAME 5-minute bucket [1767609600, 1767609900) - no rescan expected.
    dataSource.emitTick('T1', 8850, 1767609600)
    await Promise.resolve()
    dataSource.emitTick('T1', 8855, 1767609700)
    await Promise.resolve()
    expect(store.getState().rows.some((r) => r.symbol === 'BUYER-EQ')).toBe(false)

    // This tick lands in the NEXT bucket -> the previous bar just "closed" -> triggers a single-symbol rescan.
    dataSource.emitTick('T1', 8860, 1767609900)
    await new Promise((resolve) => setTimeout(resolve, 20))

    const buyRow = store.getState().rows.find((r) => r.symbol === 'BUYER-EQ')
    expect(buyRow).toBeDefined()
    expect(buyRow?.signal).toBe('BUY')
  })

  it('pausing suppresses tick-driven rescans but ticks still update liveLtp', async () => {
    const dataSource = new FakeDataSource()
    store = createScreenerStore({ dataSource, now: () => 1767609600 })

    await store.getState().loadUniverse()
    store.getState().togglePause()
    expect(store.getState().isPaused).toBe(true)

    dataSource.emitTick('T1', 12345, 1767609600)
    await Promise.resolve()
    dataSource.emitTick('T1', 12346, 1767609900)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(store.getState().liveLtp.get('T1')).toBe(12346)
    expect(store.getState().rows.some((r) => r.symbol === 'BUYER-EQ')).toBe(false)
  })
})
