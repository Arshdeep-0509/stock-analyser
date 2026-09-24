import { afterEach, describe, expect, it } from 'vitest'
import type { MarketDataSource } from '../data/MarketDataSource'
import type { MockMarketDataSource } from '../data/mock'
import { runFullScan } from '../features/rsi-ha/scanner'
import { createScreenerStore, type ScreenerStore } from '../store/screenerStore'
import type { ScreenerRow } from '../store/types'
import { DEFAULT_PARAMS } from '../strategy/constants'
import { checkSignal } from '../strategy/signals'
import { BAR_SECONDS, makeMock, makeScreener, scanOnce, SESSION_NOW, strategyView } from '../test-utils/realMock'
import type { AnalyzedCandle, Candle } from '../types/domain'

/**
 * THE INVARIANT SUITE — the properties that decide whether this prototype is
 * honest. Each describe block is a claim made out loud in a demo.
 * (Invariants 8 and 9 read files from disk and live in invariants.node.test.ts.)
 */

const SEED_A = 424242
const SEED_B = 20260924

const stores: ScreenerStore[] = []
afterEach(() => {
  for (const s of stores.splice(0)) s.getState().stop()
  localStorage.clear()
})

async function scannedStore(seed: number, now = SESSION_NOW): Promise<{ source: MockMarketDataSource; store: ScreenerStore }> {
  const source = makeMock({ seed, now })
  const store = makeScreener(source)
  stores.push(store)
  await scanOnce(store)
  return { source, store }
}

/** Walks the default session bar by bar (deterministic) to the first instant whose rows satisfy `want`. */
async function scannedStoreWhere(want: (rows: ScreenerRow[]) => boolean): Promise<{ source: MockMarketDataSource; store: ScreenerStore; at: number }> {
  const { source, store } = await scannedStore(SEED_A, SESSION_NOW - 3 * 3600)
  for (let k = 0; k <= 75; k++) {
    const at = SESSION_NOW - 3 * 3600 + k * BAR_SECONDS
    if (k > 0) {
      source.setClockMode('fixed', at)
      await store.getState().runScanNow({ immediateReplace: true })
    }
    if (want(store.getState().rows)) return { source, store, at }
  }
  throw new Error('no instant in the session satisfied the precondition at this seed')
}

describe('1. NOTHING IS HARDCODED — changing the seed changes the screen', () => {
  it('seed A and seed B share no prices, and fewer than 30% of their signalling symbols', async () => {
    const a = (await scannedStore(SEED_A)).store.getState().rows
    const b = (await scannedStore(SEED_B)).store.getState().rows
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBeGreaterThan(0)

    const displayed = (rows: ScreenerRow[]) => ({
      prices: new Set(rows.map((r) => r.price)),
      rsis: new Set(rows.map((r) => r.rsi)),
      levels: new Set(rows.flatMap((r) => (r.level === undefined ? [] : [r.level]))),
      symbols: new Set(rows.map((r) => r.symbol)),
    })
    const A = displayed(a)
    const B = displayed(b)
    expect([...A.prices].filter((p) => B.prices.has(p))).toEqual([])
    expect([...A.rsis].filter((r) => B.rsis.has(r))).toEqual([])
    expect([...A.levels].filter((l) => B.levels.has(l))).toEqual([])
    const overlap = [...A.symbols].filter((s) => B.symbols.has(s)).length
    expect(overlap / Math.min(A.symbols.size, B.symbols.size)).toBeLessThan(0.3)
  }, 60_000)
})

describe('2. DETERMINISM — same seed, two independent instances, identical output', () => {
  it('two separately constructed mocks at the same seed and instant produce deeply equal rows, floats included', async () => {
    const first = (await scannedStore(SEED_A)).store.getState().rows
    const second = (await scannedStore(SEED_A)).store.getState().rows
    expect(strategyView(second)).toEqual(strategyView(first))
    // toEqual on floats is exact (Object.is per number), not approximate.
    expect(second.map((r) => r.rsi)).toEqual(first.map((r) => r.rsi))
  }, 60_000)
})

describe('3. SIGNALS ONLY EVER COME FROM CLOSED BARS', () => {
  it('rescanning every 30s inside one 5-minute bar never changes a signal, RSI, streak or level; crossing the boundary is allowed to', async () => {
    const { source, store } = await scannedStore(SEED_A, SESSION_NOW) // SESSION_NOW is a bar boundary (13:00 IST)
    const atBarStart = strategyView(store.getState().rows)
    expect(atBarStart.length).toBeGreaterThan(0)

    for (let dt = 30; dt <= 270; dt += 30) {
      source.setClockMode('fixed', SESSION_NOW + dt)
      await store.getState().runScanNow()
      expect(strategyView(store.getState().rows), `rows changed at T+${dt}s, inside the same bar`).toEqual(atBarStart)
    }

    // Across the boundary the next bar has closed: the scan must see it (the newest candle time moves), and rows MAY change.
    const recorder = recordingSource(source)
    const s2 = createScreenerStore({ dataSource: recorder.source, now: () => source.getNow(), runScan: runFullScan, pollIntervalMs: 3_600_000 })
    stores.push(s2)
    source.setClockMode('fixed', SESSION_NOW + BAR_SECONDS)
    await scanOnce(s2)
    expect(Math.max(...recorder.lastBarTimes.values())).toBe(SESSION_NOW) // the bar that opened at 13:00 closed at 13:05
  }, 90_000)
})

describe('4. THE FORMING CANDLE NEVER ENTERS A CALCULATION', () => {
  it('for every instrument scanned mid-bar, the last candle handed to the strategy satisfies time + interval <= now', async () => {
    const source = makeMock({ seed: SEED_A, now: SESSION_NOW + 150 }) // mid-bar
    const recorder = recordingSource(source)
    const store = createScreenerStore({ dataSource: recorder.source, now: () => source.getNow(), runScan: runFullScan, pollIntervalMs: 3_600_000 })
    stores.push(store)
    await scanOnce(store)

    const now = source.getNow()
    expect(recorder.lastBarTimes.size).toBeGreaterThanOrEqual(store.getState().universe.length)
    for (const [token, lastTime] of recorder.lastBarTimes) {
      expect(lastTime + BAR_SECONDS, `token ${token}`).toBeLessThanOrEqual(now)
    }
  }, 60_000)
})

describe('5. THE OUTPUT RULE HOLDS', () => {
  it('with equity rows hidden no visible row is NSE equity, and toggling never changes the computed rows', async () => {
    const isEquitySignal = (r: ScreenerRow) => r.exchange === 'NSE' && (r.signal === 'BUY' || r.signal === 'SELL')
    const { store } = await scannedStoreWhere((rows) => rows.some(isEquitySignal))
    const rows = store.getState().rows
    expect(rows.some(isEquitySignal)).toBe(true) // computed…
    store.getState().setShowNseEquityRows(false)
    expect(store.getState().visibleRows.filter((r) => r.exchange === 'NSE')).toEqual([]) // …but not shown
    store.getState().setShowNseEquityRows(true)
    expect(store.getState().rows).toBe(rows)
    expect(store.getState().rows).toHaveLength(rows.length)
    store.getState().setShowNseEquityRows(false)
    expect(store.getState().rows).toBe(rows)
  }, 120_000)
})

describe('6. OPTION LEGS INHERIT, THEY DO NOT RECOMPUTE', () => {
  it('every CE/PE row carries its underlying\'s rsi and time EXACTLY, and its own option price', async () => {
    const isLeg = (r: ScreenerRow) => r.signal === 'CE Buy' || r.signal === 'PE Buy'
    const { source, store } = await scannedStoreWhere((rows) => rows.some(isLeg))
    const rows = store.getState().rows
    const legs = rows.filter((r) => r.signal === 'CE Buy' || r.signal === 'PE Buy')
    expect(legs.length).toBeGreaterThan(0)

    for (const leg of legs) {
      const underlying = rows.find((r) => r.symbol === leg.derivedFrom && (r.signal === 'BUY' || r.signal === 'SELL'))
      expect(underlying, `${leg.symbol} has no underlying row`).toBeDefined()
      if (!underlying || !leg.token) continue
      expect(leg.rsi === underlying.rsi || (Number.isNaN(leg.rsi) && Number.isNaN(underlying.rsi))).toBe(true)
      expect(leg.time).toBe(underlying.time)
      const optionCandles = await source.fetchHistoricalCandles(leg.token, 'NFO', '5minute', 5)
      expect(leg.price).toBe(optionCandles[optionCandles.length - 1].close)
      expect(leg.price).not.toBe(underlying.price)
    }
  }, 120_000)
})

describe('7. BUY AND BREAKOUT ARE INDEPENDENT', () => {
  it('an instrument that is both a BUY/SELL and a breakout gets two rows with distinct ids', async () => {
    const { source, store } = await scannedStore(SEED_A)
    let both: { symbol: string; rows: ScreenerRow[] } | null = null
    for (let k = 0; k <= 75 && !both; k++) {
      if (k > 0) {
        source.setClockMode('fixed', SESSION_NOW - 3 * 3600 + k * BAR_SECONDS)
        await store.getState().runScanNow({ immediateReplace: true })
      }
      const bySymbol = new Map<string, ScreenerRow[]>()
      for (const r of store.getState().rows) bySymbol.set(r.symbol, [...(bySymbol.get(r.symbol) ?? []), r])
      for (const [symbol, list] of bySymbol) {
        const hasSignal = list.some((r) => r.signal === 'BUY' || r.signal === 'SELL')
        const hasBreakout = list.some((r) => r.signal === 'BREAKOUT-UP' || r.signal === 'BREAKOUT-DOWN')
        if (hasSignal && hasBreakout) {
          both = { symbol, rows: list }
          break
        }
      }
    }
    expect(both, 'no instrument produced both a signal and a breakout in a whole session at this seed').not.toBeNull()
    if (!both) return
    const ids = both.rows.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(both.rows.length).toBeGreaterThanOrEqual(2)
  }, 120_000)
})

describe('10. THE BAND, NOT THE THRESHOLD', () => {
  /** A synthetic analysed series: red, red, red, then two greens; the last bar's RSI is `rsi`. */
  function series(rsi: number): AnalyzedCandle[] {
    const colors: ('green' | 'red')[] = ['red', 'red', 'red', 'red', 'green', 'green']
    return colors.map((haColor, i) => ({
      time: SESSION_NOW - (colors.length - i) * BAR_SECONDS,
      open: 2500,
      high: 2510,
      low: 2490,
      close: 2505,
      volume: 1000,
      haOpen: 2500,
      haHigh: 2510,
      haLow: 2490,
      haClose: haColor === 'green' ? 2506 : 2494,
      haColor,
      rsi: i === colors.length - 1 ? rsi : 55,
    }))
  }

  it('checkSignal returns null at RSI 70 with a 2-candle green streak (the code implements the 60-65 BAND, not the docstring\'s ">60" threshold)', () => {
    expect(checkSignal(series(70), DEFAULT_PARAMS)).toBeNull()
  })

  it('positive control: the same construction at RSI 62 and at both band edges IS a BUY (so the null above is the band, not a broken fixture)', () => {
    expect(checkSignal(series(62), DEFAULT_PARAMS)).toBe('BUY')
    expect(checkSignal(series(DEFAULT_PARAMS.rsiBuyLow), DEFAULT_PARAMS)).toBe('BUY')
    expect(checkSignal(series(DEFAULT_PARAMS.rsiBuyHigh), DEFAULT_PARAMS)).toBe('BUY')
    expect(checkSignal(series(DEFAULT_PARAMS.rsiBuyHigh + 0.01), DEFAULT_PARAMS)).toBeNull()
  })
})

/** Wraps a data source, recording the last candle time handed out per token (i.e. the newest bar the strategy will see). */
function recordingSource(inner: MarketDataSource): { source: MarketDataSource; lastBarTimes: Map<string, number> } {
  const lastBarTimes = new Map<string, number>()
  const source: MarketDataSource = {
    searchSymbol: (q) => inner.searchSymbol(q),
    loadScripMaster: () => inner.loadScripMaster(),
    fetchHistoricalCandles: async (token, exchange, interval, daysBack) => {
      const candles: Candle[] = await inner.fetchHistoricalCandles(token, exchange, interval, daysBack)
      if (candles.length > 0) lastBarTimes.set(token, candles[candles.length - 1].time)
      return candles
    },
    fetchDailyBars: (instrument, days) => inner.fetchDailyBars(instrument, days),
    fetchIndexQuotes: (keys) => inner.fetchIndexQuotes(keys),
    subscribeTicks: (tokens, onTick, opts) => inner.subscribeTicks(tokens, onTick, opts),
    getConnectionState: () => inner.getConnectionState(),
  }
  return { source, lastBarTimes }
}
