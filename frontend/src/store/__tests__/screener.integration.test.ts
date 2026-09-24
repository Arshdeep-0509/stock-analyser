import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MockMarketDataSource } from '../../data/mock'
import { expiryFilterToday } from '../../lib/marketSession'
import { DEFAULT_PARAMS } from '../../strategy/constants'
import { loadFnoFuturesUniverse, loadNseEquityUniverse } from '../../strategy/universe'
import { BAR_SECONDS, makeMock, makeScreener, scanOnce, SESSION_NOW, strategyView } from '../../test-utils/realMock'
import { usePauseStore } from '../pauseStore'
import type { ScreenerStore } from '../screenerStore'

/**
 * Layer 4 — the REAL MockMarketDataSource (fixed seed, frozen clock, zero
 * simulated latency) under the REAL screener store, scans run in-thread.
 * Nothing here is a fixture: every row comes out of the generator and
 * src/strategy/ exactly as the app produces it.
 */

let store: ScreenerStore | null = null
afterEach(() => {
  store?.getState().stop()
  store = null
  usePauseStore.getState().setPaused(false)
  vi.useRealTimers()
  localStorage.clear()
})

function boot(options: Parameters<typeof makeMock>[0] = {}): { source: MockMarketDataSource; s: ScreenerStore } {
  const source = makeMock(options)
  store = makeScreener(source)
  return { source, s: store }
}

/** Moves the mock's frozen clock to `t` (as the replay transport does). */
function setClock(source: MockMarketDataSource, t: number): void {
  source.setClockMode('fixed', t)
}

describe('screener integration — first scan', () => {
  it('loadUniverse + first scan reach scanState "done" with a non-empty row set and no errors', async () => {
    const { s } = boot()
    await scanOnce(s)
    expect(s.getState().scanState).toBe('done')
    expect(s.getState().rows.length).toBeGreaterThan(0)
    expect(s.getState().errors).toEqual([])
    expect(s.getState().lastScanAt).toBe(SESSION_NOW)
    expect(s.getState().nextScanAt).toBe(SESSION_NOW + DEFAULT_PARAMS.scanEverySeconds)
  }, 30_000)

  it('the universe is exactly loadNseEquityUniverse + loadFnoFuturesUniverse, computed independently here', async () => {
    const { source, s } = boot()
    await s.getState().loadUniverse()
    const scrip = await source.loadScripMaster()
    const expected = [...loadNseEquityUniverse(scrip, DEFAULT_PARAMS), ...loadFnoFuturesUniverse(scrip, DEFAULT_PARAMS, expiryFilterToday(SESSION_NOW))]
    expect(s.getState().universe).toEqual(expected)
  })

  it('below-floor count + universe size = the unfiltered instrument count (the "Scanning X of Y" numbers)', async () => {
    const { source, s } = boot()
    await s.getState().loadUniverse()
    const scrip = await source.loadScripMaster()
    const noFloor = { ...DEFAULT_PARAMS, minPrice: 0 }
    const unfiltered = loadNseEquityUniverse(scrip, noFloor).length + loadFnoFuturesUniverse(scrip, noFloor, expiryFilterToday(SESSION_NOW)).length
    const { eligible, included } = s.getState().universeStats
    const belowFloor = eligible - included
    expect(included).toBe(s.getState().universe.length)
    expect(belowFloor + s.getState().universe.length).toBe(unfiltered)
    expect(belowFloor).toBeGreaterThan(0) // the floor really does exclude something at this seed
  })
})

describe('screener integration — determinism and merging', () => {
  it('a second scan at the same clock time produces an IDENTICAL row set', async () => {
    const { s } = boot()
    await scanOnce(s)
    const first = strategyView(s.getState().rows)
    await s.getState().runScanNow()
    expect(strategyView(s.getState().rows)).toEqual(first)
    expect(s.getState().freshIds).toEqual([])
  }, 30_000)

  it('across a bar boundary, surviving rows keep their id + firstSeenAt, and freshIds is exactly the new rows', async () => {
    const { source, s } = boot()
    await scanOnce(s)
    const before = new Map(s.getState().rows.map((r) => [`${r.symbol}:${r.signal}`, r]))

    // Walk forward bar by bar until the row set changes in both directions.
    let t = SESSION_NOW
    for (let k = 1; k <= 12; k++) {
      t = SESSION_NOW + k * BAR_SECONDS
      setClock(source, t)
      await s.getState().runScanNow()
      const keys = new Set(s.getState().rows.map((r) => `${r.symbol}:${r.signal}`))
      if (s.getState().freshIds.length > 0 && [...before.keys()].some((key) => keys.has(key))) break
    }

    const rows = s.getState().rows
    const fresh = new Set(s.getState().freshIds)
    expect(fresh.size).toBeGreaterThan(0)
    for (const row of rows) {
      const key = `${row.symbol}:${row.signal}`
      const prior = before.get(key)
      if (prior && !fresh.has(row.id)) {
        expect(row.id).toBe(prior.id)
        expect(row.firstSeenAt).toBe(prior.firstSeenAt)
      }
      if (fresh.has(row.id)) expect(row.firstSeenAt).toBe(t)
    }
  }, 60_000)

  it('a signal that stops qualifying fades on its first miss and is gone on the second', async () => {
    const { source, s } = boot()
    await scanOnce(s)
    const initialKeys = new Set(s.getState().rows.map((r) => `${r.symbol}:${r.signal}`))

    let fadedKey: string | null = null
    for (let k = 1; k <= 24 && !fadedKey; k++) {
      setClock(source, SESSION_NOW + k * BAR_SECONDS)
      await s.getState().runScanNow()
      fadedKey = s.getState().rows.find((r) => r.status === 'fading' && initialKeys.has(`${r.symbol}:${r.signal}`))?.symbol ?? null
    }
    expect(fadedKey).not.toBeNull()
    const fading = s.getState().rows.find((r) => r.status === 'fading' && r.symbol === fadedKey)
    if (!fading) throw new Error('lost the fading row')

    await s.getState().runScanNow() // same clock: still not qualifying -> expired
    expect(s.getState().rows.find((r) => r.id === fading.id)).toBeUndefined()
    expect(s.getState().history.some((h) => h.id === fading.id && h.status === 'expired')).toBe(true)
  }, 90_000)
})

describe('screener integration — failures', () => {
  it('with failureRate 1.0 the scan still completes: zero rows, one error per instrument, no throw, no hang', async () => {
    const { source, s } = boot()
    await s.getState().loadUniverse()
    source.setFailureRate(1)
    await s.getState().runScanNow()
    expect(s.getState().scanState).toBe('done')
    expect(s.getState().rows).toEqual([])
    const universe = s.getState().universe
    expect(s.getState().errors).toHaveLength(universe.length)
    expect(new Set(s.getState().errors.map((e) => e.symbol))).toEqual(new Set(universe.map((u) => u.symbol)))
  }, 30_000)

  it('with a handful of instruments failing, the rest still produce rows', async () => {
    const clean = boot()
    await scanOnce(clean.s)
    const cleanKeys = new Set(clean.s.getState().rows.map((r) => `${r.symbol}:${r.signal}`))
    clean.s.getState().stop()

    const { source, s } = boot()
    await s.getState().loadUniverse()
    source.setFailureRate(0.1)
    await s.getState().runScanNow()
    const errors = s.getState().errors
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.length).toBeLessThan(s.getState().universe.length)
    expect(s.getState().rows.length).toBeGreaterThan(0)
    // Every row that survived is a row the clean run also produced (a failure never invents or corrupts a signal).
    const failedSymbols = new Set(errors.map((e) => e.symbol))
    for (const r of s.getState().rows) {
      expect(cleanKeys.has(`${r.symbol}:${r.signal}`)).toBe(true)
      expect(failedSymbols.has(r.symbol)).toBe(false)
    }
  }, 60_000)
})

describe('screener integration — parameters', () => {
  it('setParams triggers a rescan and the row set changes', async () => {
    const { s } = boot()
    await scanOnce(s)
    const before = strategyView(s.getState().rows)
    await s.getState().setParams({ ...DEFAULT_PARAMS, rsiBuyLow: 40, rsiBuyHigh: 90 })
    expect(s.getState().params.rsiBuyLow).toBe(40)
    expect(strategyView(s.getState().rows)).not.toEqual(before)
    expect(s.getState().paramsDiff).not.toBeNull()
  }, 30_000)

  it('resetParams restores the row set byte-identical to before the edit', async () => {
    const { s } = boot()
    await scanOnce(s)
    const before = JSON.stringify(strategyView(s.getState().rows))
    await s.getState().setParams({ ...DEFAULT_PARAMS, rsiBuyLow: 40, rsiBuyHigh: 90, breakoutLookback: 10 })
    expect(JSON.stringify(strategyView(s.getState().rows))).not.toBe(before)
    await s.getState().resetParams()
    expect(s.getState().params).toEqual(DEFAULT_PARAMS)
    expect(JSON.stringify(strategyView(s.getState().rows))).toBe(before)
  }, 30_000)
})

describe('screener integration — ticks and the scheduler', () => {
  it('a tick updates the live LTP without touching rows', async () => {
    vi.useFakeTimers()
    const source = makeMock({ now: SESSION_NOW })
    source.setForceSessionOpen(true)
    store = makeScreener(source)
    await scanOnce(store)
    const rowsBefore = store.getState().rows
    expect(store.getState().liveLtp.size).toBe(0)

    vi.advanceTimersByTime(3000) // past the socket's connect delay, several tick batches
    expect(store.getState().liveLtp.size).toBeGreaterThan(0)
    expect(store.getState().rows).toBe(rowsBefore)
  }, 30_000)

  it('pausing stops the scheduler from scanning when a scan falls due; resuming lets it run', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const source = makeMock({ now: SESSION_NOW })
    store = createPolled(source)
    store.getState().start() // loads the universe and runs the initial scan itself
    await vi.waitFor(() => expect(store?.getState().lastScanAt).toBe(SESSION_NOW))
    const firstScanAt = store.getState().lastScanAt

    usePauseStore.getState().setPaused(true)
    setClock(source, SESSION_NOW + DEFAULT_PARAMS.scanEverySeconds) // a scan is now due
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.getState().lastScanAt).toBe(firstScanAt)

    usePauseStore.getState().setPaused(false)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(store?.getState().lastScanAt).toBe(SESSION_NOW + DEFAULT_PARAMS.scanEverySeconds))
  }, 30_000)
})

/** Same as makeScreener but with a real (fake-timer-driven) 250ms scheduler. */
function createPolled(source: MockMarketDataSource): ScreenerStore {
  return makeScreener(source, 250)
}
