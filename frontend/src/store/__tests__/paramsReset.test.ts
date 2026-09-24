import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../data/MarketDataSource'
import type { ScripRow, SearchResponse } from '../../types/api'
import type { Candle, Instrument } from '../../types/domain'
import { DEFAULT_PARAMS } from '../../strategy/constants'
import buyCandlesFixture from '../../features/rsi-ha/__tests__/fixtures/buy-candles.json'
import { createScreenerStore, type ScreenerStore } from '../screenerStore'
import type { ScreenerRow } from '../types'

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

  async searchSymbol(): Promise<SearchResponse> {
    return { error: null, result: [] }
  }
  async fetchHistoricalCandles(token: string): Promise<Candle[]> {
    return this.candlesByToken.get(token) ?? []
  }
  async loadScripMaster(): Promise<ScripRow[]> {
    return SCRIP_ROWS
  }
  subscribeTicks(): () => void {
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

/** Strips store-only bookkeeping (id/firstSeenAt/lastSeenAt/status/pinned) — those are inherently history-dependent by design; the acceptance criterion is about the COMPUTED signal content. */
function signalContent(rows: readonly ScreenerRow[]) {
  return rows
    .map((r) => ({ symbol: r.symbol, exchange: r.exchange, signal: r.signal, price: r.price, rsi: r.rsi, time: r.time, level: r.level }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.signal.localeCompare(b.signal))
}

let store: ScreenerStore | null = null

beforeEach(() => {
  store = createScreenerStore({
    dataSource: new FakeDataSource(),
    now: () => 1767609600,
    // jsdom has no real Worker — run the scan inline instead of through runScanInWorker.
    runScan: (universe, dataSource, atmMap, params, onProgress) =>
      import('../../features/rsi-ha/scanner').then((m) => m.runFullScan(universe, dataSource, atmMap, params, onProgress)),
  })
})

afterEach(() => {
  store?.getState().stop()
  store = null
})

describe('parameter reset', () => {
  it(
    'restores byte-identical signal content after a change-then-reset round trip',
    async () => {
      const s = store
      if (!s) throw new Error('store not initialised')

      await s.getState().loadUniverse()
      await s.getState().runScanNow()
      const before = signalContent(s.getState().rows)
      expect(before.length).toBeGreaterThan(0) // sanity: the fixture actually produces a signal

      // An extreme minPrice guarantees every signal is suppressed — a
      // reliable way to force a real change, rather than hoping a band
      // tweak happens to move the specific fixture RSI value out of range.
      await s.getState().setParams({ ...DEFAULT_PARAMS, minPrice: 999999 })
      const modified = signalContent(s.getState().rows)
      expect(modified).toEqual([])

      await s.getState().resetParams()
      const afterReset = signalContent(s.getState().rows)

      expect(afterReset).toEqual(before)
      expect(s.getState().params).toEqual(DEFAULT_PARAMS)
      // Confirms the round trip actually went somewhere and back, not that nothing ever changed.
      expect(modified).not.toEqual(before)
    },
    15000,
  )

  it('marks no parameters as overridden immediately after a reset', async () => {
    const s = store
    if (!s) throw new Error('store not initialised')
    await s.getState().setParams({ ...DEFAULT_PARAMS, minPrice: 3000 })
    await s.getState().resetParams()
    expect(s.getState().params).toStrictEqual(DEFAULT_PARAMS)
  }, 15000)
})
