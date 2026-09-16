import { describe, expect, it } from 'vitest'
import type { MarketDataSource } from '../../../data/MarketDataSource'
import { MockMarketDataSource } from '../../../data/mock'
import { DEFAULT_PARAMS } from '../../../strategy/constants'
import { loadNseEquityUniverse } from '../../../strategy/universe'
import type { Candle } from '../../../types/domain'
import { scanWatchlist } from '../scanner'
import buyCandlesFixture from './fixtures/buy-candles.json'

const REFERENCE_NOW = 1767609600
const SEED = 424242

const buyCandles = buyCandlesFixture as Candle[]

/** A flat, no-signal series — RSI ends up NaN/50-ish, HA never confirms a fresh 2-candle streak reliably in-band. */
function flatCandles(): Candle[] {
  return Array.from({ length: 20 }, (_, i) => ({ time: i * 300, open: 2500, high: 2500, low: 2500, close: 2500, volume: 1000 }))
}

class FakeDataSource implements Pick<MarketDataSource, 'fetchHistoricalCandles'> {
  private readonly byToken: Map<string, Candle[] | 'throw'>

  constructor(byToken: Map<string, Candle[] | 'throw'>) {
    this.byToken = byToken
  }

  async fetchHistoricalCandles(token: string): Promise<Candle[]> {
    const entry = this.byToken.get(token)
    if (entry === undefined) throw new Error(`FakeDataSource: no fixture for token ${token}`)
    if (entry === 'throw') throw new Error(`simulated failure for token ${token}`)
    return entry
  }
}

describe('scanWatchlist', () => {
  it('records an error for a symbol whose fetch throws, without losing other symbols rows', async () => {
    const dataSource = new FakeDataSource(
      new Map<string, Candle[] | 'throw'>([
        ['A', flatCandles()],
        ['B', 'throw'],
        ['C', buyCandles],
      ]),
    )

    const universe = [
      { symbol: 'FLAT', token: 'A', exchange: 'NSE' as const },
      { symbol: 'BROKEN', token: 'B', exchange: 'NSE' as const },
      { symbol: 'INDUSINDBK-EQ', token: 'C', exchange: 'NSE' as const },
    ]

    const { rows, errors } = await scanWatchlist(universe, dataSource, DEFAULT_PARAMS)

    expect(errors).toEqual([{ symbol: 'BROKEN', message: 'simulated failure for token B' }])

    // The symbol AFTER the one that threw was still processed and its real
    // BUY signal (computed from genuine candles, not injected) survives.
    const buyRow = rows.find((r) => r.symbol === 'INDUSINDBK-EQ')
    expect(buyRow).toBeDefined()
    expect(buyRow?.signal).toBe('BUY')

    // The flat control symbol produced no rows and no error — it just has nothing to report.
    expect(rows.some((r) => r.symbol === 'FLAT')).toBe(false)
    expect(errors.some((e) => e.symbol === 'FLAT')).toBe(false)
  })

  it(
    'is byte-identical across two independently constructed runs of the same seed',
    async () => {
      const clockOptions = { mode: 'fixed' as const, startTimestamp: REFERENCE_NOW }
      const dataSourceA = new MockMarketDataSource(SEED, clockOptions)
      const dataSourceB = new MockMarketDataSource(SEED, clockOptions)

      const rowsA = await dataSourceA.loadScripMaster()
      const universeA = loadNseEquityUniverse(rowsA, DEFAULT_PARAMS).slice(0, 8)
      const rowsB = await dataSourceB.loadScripMaster()
      const universeB = loadNseEquityUniverse(rowsB, DEFAULT_PARAMS).slice(0, 8)

      expect(universeA).toEqual(universeB)

      const resultA = await scanWatchlist(universeA, dataSourceA, DEFAULT_PARAMS)
      const resultB = await scanWatchlist(universeB, dataSourceB, DEFAULT_PARAMS)

      expect(resultA).toEqual(resultB)
    },
    15000,
  )
})
