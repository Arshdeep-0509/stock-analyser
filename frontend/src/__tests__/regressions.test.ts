import { afterEach, describe, expect, it } from 'vitest'
import type { MarketDataSource } from '../data/MarketDataSource'
import { DEFAULT_SEED, generateUniverse, MockMarketDataSource } from '../data/mock'
import { MAX_ATTEMPTS, MAX_SIGNALS, MIN_SIGNALS } from '../data/mock/generateUniverse'
import { createIntradayStore, matchesFilters, type IntradayStore } from '../store/intradayStore'
import { useAlertStore } from '../store/alertStore'
import { createScreenerStore, type ScreenerStore } from '../store/screenerStore'
import { runFullScan } from '../features/rsi-ha/scanner'
import { BAR_SECONDS, makeMock, makeScreener, scanOnce, SESSION_NOW } from '../test-utils/realMock'
import { DEFAULT_PARAMS } from '../strategy/constants'
import type { Candle } from '../types/domain'

/**
 * Layer 6: bugs this project has already shipped once. Each test is the
 * defect written down so it cannot come back. (Regression 1, the virtualizer
 * re-measure on a layout flip, needs real layout and lives in
 * e2e/regressions.spec.ts; jsdom measures every element at 0px.)
 */

let screener: ScreenerStore | null = null
let intraday: IntradayStore | null = null
afterEach(() => {
  screener?.getState().stop()
  intraday?.getState().stop()
  screener = null
  intraday = null
  useAlertStore.setState({ rules: [], notifications: [] })
  localStorage.clear()
})

/** Wraps a source and counts LIVE tick subscriptions (subscribed minus unsubscribed), recording each one's token set. */
function countingSource(inner: MarketDataSource): { source: MarketDataSource; active: () => number; last: () => { tokens: string[]; priority: string[] } } {
  let active = 0
  let last = { tokens: [] as string[], priority: [] as string[] }
  const source: MarketDataSource = {
    searchSymbol: (q) => inner.searchSymbol(q),
    loadScripMaster: () => inner.loadScripMaster(),
    fetchHistoricalCandles: (t, e, i, d) => inner.fetchHistoricalCandles(t, e, i, d),
    fetchDailyBars: (i, d) => inner.fetchDailyBars(i, d),
    fetchIndexQuotes: (k) => inner.fetchIndexQuotes(k),
    getConnectionState: () => inner.getConnectionState(),
    subscribeTicks: (tokens, onTick, opts) => {
      active += 1
      last = { tokens: [...tokens], priority: [...(opts?.priority ?? [])] }
      const off = inner.subscribeTicks(tokens, onTick, opts)
      let done = false
      return () => {
        if (!done) active -= 1
        done = true
        off()
      }
    },
  }
  return { source, active: () => active, last: () => last }
}

describe('2. TICK SUBSCRIPTION MUST NOT STACK', () => {
  it('screener: three universe loads + three scans leave exactly ONE live subscription, over exactly the universe', async () => {
    const mock = makeMock()
    const { source, active, last } = countingSource(mock)
    screener = createScreenerStore({ dataSource: source, now: () => mock.getNow(), runScan: runFullScan, pollIntervalMs: 60 * 60 * 1000 })
    for (let i = 0; i < 3; i++) {
      await screener.getState().loadUniverse()
      await screener.getState().runScanNow()
    }
    expect(active()).toBe(1)
    // The screener ticks its whole universe (a bar close on ANY symbol can create a signal),
    // so "only the current rows" means: nothing outside the current universe.
    expect(new Set(last().tokens)).toEqual(new Set(screener.getState().universe.map((u) => u.token)))
    screener.getState().stop()
    expect(active()).toBe(0)
  }, 60_000)

  it('intraday: init + three refreshes leave ONE live subscription whose priority is exactly the visible rows', async () => {
    const mock = makeMock()
    const { source, active, last } = countingSource(mock)
    intraday = createIntradayStore({ dataSource: source, now: () => mock.getNow(), scheduleFrame: (f) => f() })
    await intraday.getState().init()
    // An active filter, so "the visible rows" is a real subset rather than every row.
    intraday.getState().setFilters({ direction: 'up' })
    for (let i = 0; i < 3; i++) await intraday.getState().refreshAll()
    expect(active()).toBe(1)

    const state = intraday.getState()
    const visible = state.rows.filter((r) => matchesFilters(r, state.filters)).map((r) => r.token)
    expect(visible.length).toBeGreaterThan(0)
    expect(visible.length).toBeLessThan(state.rows.length)
    expect(new Set(last().priority)).toEqual(new Set(visible))
    intraday.getState().stop()
    expect(active()).toBe(0)
  }, 60_000)
})

describe('3. FIRST SCAN MUST NOT ANNOUNCE EVERYTHING', () => {
  // A rule that matches every row with an RSI: if anything is announced, it alerts.
  const catchAll = () => useAlertStore.setState({ rules: [{ id: 'all', type: 'rsi-threshold', direction: 'above', value: -1, enabled: true }], notifications: [] })

  it('after the first scan: rows exist, but freshIds and alerts are empty', async () => {
    catchAll()
    const mock = makeMock()
    screener = makeScreener(mock)
    await scanOnce(screener)
    expect(screener.getState().rows.length).toBeGreaterThan(0)
    expect(screener.getState().freshIds).toEqual([])
    expect(useAlertStore.getState().notifications).toEqual([])
  }, 60_000)

  it('a later scheduled scan that produces genuinely new rows announces exactly those rows, and alerts only for them', async () => {
    catchAll()
    const mock = makeMock()
    screener = makeScreener(mock)
    await scanOnce(screener)
    const firstIds = new Set(screener.getState().rows.map((r) => r.id))

    for (let k = 1; k <= 12 && screener.getState().freshIds.length === 0; k++) {
      mock.setClockMode('fixed', SESSION_NOW + k * BAR_SECONDS)
      await screener.getState().runScanNow()
    }
    const fresh = screener.getState().freshIds
    expect(fresh.length).toBeGreaterThan(0)
    for (const id of fresh) expect(firstIds.has(id)).toBe(false)
    const alerted = new Set(useAlertStore.getState().notifications.map((n) => n.rowId))
    const freshWithRsi = screener.getState().rows.filter((r) => fresh.includes(r.id) && !Number.isNaN(r.rsi)).map((r) => r.id)
    expect(alerted).toEqual(new Set(freshWithRsi))
  }, 120_000)

  it('a parameter change announces nothing, even though the row set changes', async () => {
    catchAll()
    const mock = makeMock()
    screener = makeScreener(mock)
    await scanOnce(screener)
    const before = screener.getState().rows.map((r) => r.id).join()
    await screener.getState().setParams({ ...screener.getState().params, rsiBuyLow: 40, rsiBuyHigh: 90 })
    expect(screener.getState().rows.map((r) => r.id).join()).not.toBe(before)
    expect(screener.getState().freshIds).toEqual([])
    expect(useAlertStore.getState().notifications).toEqual([])
  }, 60_000)

  it('a replay seek announces nothing, even though the row set changes', async () => {
    catchAll()
    const mock = makeMock()
    screener = makeScreener(mock)
    await scanOnce(screener)
    const before = screener.getState().rows.map((r) => r.id).join()
    // What ReplayTransportBar does on a seek: move the clock, then an immediate-replace rescan.
    mock.setClockMode('fixed', SESSION_NOW - 20 * BAR_SECONDS)
    await screener.getState().runScanNow({ immediateReplace: true })
    expect(screener.getState().rows.map((r) => r.id).join()).not.toBe(before)
    expect(screener.getState().freshIds).toEqual([])
    expect(useAlertStore.getState().notifications).toEqual([])
  }, 60_000)
})

function returns(candles: readonly Candle[]): Map<number, number> {
  const out = new Map<number, number>()
  for (let i = 1; i < candles.length; i++) out.set(candles[i].time, candles[i].close / candles[i - 1].close - 1)
  return out
}

function correlation(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxy / Math.sqrt(sxx * syy)
}

describe('4. FUTURES MUST NOT MIRROR THEIR UNDERLYING', () => {
  it('for 20 F&O names, equity vs near-month futures 5-minute returns correlate below 0.98', async () => {
    const mock = makeMock()
    const rows = await mock.loadScripMaster()
    const equityByBase = new Map(rows.filter((r) => r.exchange === 'NSE' && r.instrument_name === 'EQ').map((r) => [r.company_name, String(r.exchange_token)]))
    const futures = rows.filter((r) => r.exchange === 'NFO' && r.instrument_name === 'FUTSTK' && equityByBase.has(r.company_name))
    const futByBase = new Map<string, string>()
    for (const f of futures) if (!futByBase.has(f.company_name)) futByBase.set(f.company_name, String(f.exchange_token))
    const names = [...futByBase.keys()].slice(0, 20)
    expect(names).toHaveLength(20)

    for (const base of names) {
      const eq = returns(await mock.fetchHistoricalCandles(equityByBase.get(base) ?? '', 'NSE', '5minute', 5))
      const fut = returns(await mock.fetchHistoricalCandles(futByBase.get(base) ?? '', 'NFO', '5minute', 5))
      const times = [...eq.keys()].filter((t) => fut.has(t))
      expect(times.length, base).toBeGreaterThan(50)
      const r = correlation(
        times.map((t) => eq.get(t) ?? 0),
        times.map((t) => fut.get(t) ?? 0),
      )
      expect(r, `${base} correlation`).toBeLessThan(0.98)
    }
  }, 60_000)
})

describe('5. BREAKOUT RATE MUST BE REALISTIC', () => {
  it("the default seed's universe has between 1% and 20% of instruments in breakout on the final bar", () => {
    const { results } = generateUniverse(DEFAULT_SEED, SESSION_NOW)
    const rate = results.filter((r) => r.breakout.signal !== null).length / results.length
    expect(rate).toBeGreaterThanOrEqual(0.01)
    expect(rate).toBeLessThanOrEqual(0.2)
  }, 60_000)
})

describe('6. THE TUNER LANDS IN RANGE', () => {
  // Spec name mapping: getTuningReport() -> MockMarketDataSource.getDevState() (signalCount,
  // attempts); the report's "salt" -> (seed, regenerateEpoch), the pair a universe is derived from.
  it('the tuning report is within the stated target band, inside the retry budget', () => {
    const report = new MockMarketDataSource(DEFAULT_SEED, { mode: 'fixed', startTimestamp: SESSION_NOW }).getDevState()
    expect(report.signalCount).toBeGreaterThanOrEqual(MIN_SIGNALS)
    expect(report.signalCount).toBeLessThanOrEqual(MAX_SIGNALS)
    expect(report.attempts).toBeGreaterThanOrEqual(1)
    expect(report.attempts).toBeLessThanOrEqual(MAX_ATTEMPTS)
  }, 60_000)

  it('when the first attempt misses the band the tuner retries until it lands in it, and never needs the whole budget', () => {
    // At DEFAULT_PARAMS every seed tried (1-40) lands in range on attempt 1, so the default
    // report alone can't tell a working tuner from one that never retries. A 60-bar breakout
    // lookback thins the signals enough that these seeds' first attempts fall short.
    const params = { ...DEFAULT_PARAMS, breakoutLookback: 60 }
    const reports = [3, 4, 7, 12].map((seed) => generateUniverse(seed, SESSION_NOW, params))
    expect(reports.some((r) => r.attempts > 1)).toBe(true)
    for (const r of reports) {
      expect(r.signalCount).toBeGreaterThanOrEqual(MIN_SIGNALS)
      expect(r.signalCount).toBeLessThanOrEqual(MAX_SIGNALS)
      expect(r.attempts).toBeLessThan(MAX_ATTEMPTS)
    }
  }, 120_000)

  it("the report's salt reproduces the same market on a fresh instance", async () => {
    const a = new MockMarketDataSource(DEFAULT_SEED, { mode: 'fixed', startTimestamp: SESSION_NOW })
    a.regenerateUniverse()
    a.regenerateUniverse()
    const salt = a.getDevState()
    expect(salt.regenerateEpoch).toBe(2)

    const b = new MockMarketDataSource(salt.seed, { mode: 'fixed', startTimestamp: SESSION_NOW })
    for (let i = 0; i < salt.regenerateEpoch; i++) b.regenerateUniverse()
    for (const s of [a, b]) {
      s.setFastForward(true)
      s.setFailureRate(0)
    }
    expect(b.getDevState().signalCount).toBe(salt.signalCount)
    expect(b.getDevState().attempts).toBe(salt.attempts)
    expect(await b.loadScripMaster()).toEqual(await a.loadScripMaster())
    const token = String((await a.loadScripMaster())[0].exchange_token)
    expect(await b.fetchHistoricalCandles(token, 'NSE', '5minute', 5)).toEqual(await a.fetchHistoricalCandles(token, 'NSE', '5minute', 5))

    // ...and a different salt is a different market (the check above is not vacuous).
    const c = new MockMarketDataSource(salt.seed, { mode: 'fixed', startTimestamp: SESSION_NOW })
    c.setFastForward(true)
    c.setFailureRate(0)
    expect(await c.fetchHistoricalCandles(token, 'NSE', '5minute', 5)).not.toEqual(await a.fetchHistoricalCandles(token, 'NSE', '5minute', 5))
  }, 60_000)
})
