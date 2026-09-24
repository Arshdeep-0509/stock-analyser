import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../data/MarketDataSource'
import { DEFAULT_SEED, MockMarketDataSource } from '../../data/mock'
import type { ScripRow, SearchResponse } from '../../types/api'
import type { Candle, Instrument, IntradayRow, MarketTick } from '../../types/domain'
import { assertBarBoundaryInvariant, createIntradayStore, type IntradayStore } from '../intradayStore'
import { usePauseStore } from '../pauseStore'
import { useStarredStore } from '../starredStore'

const REFERENCE_NOW = 1767609600

// Four consecutive weekdays' 09:15 IST bar-opens, epoch seconds — same fixture shape as src/analytics/__tests__/intraday.test.ts.
const DAY1_OPEN = 1767588300
const DAY2_OPEN = 1767674700
const DAY3_OPEN = 1767761100
const DAY4_OPEN = 1767847500
const BAR = 300
const NOW = DAY4_OPEN + BAR + 60

function candle(time: number, open: number, high: number, low: number, close: number, volume: number): Candle {
  return { time, open, high, low, close, volume }
}
function dailyBar(time: number, close: number): Candle {
  return { time, open: close, high: close, low: close, close, volume: 0 }
}

const FUTSTK_ROW: ScripRow = {
  exchange: 'NFO',
  instrument_name: 'FUTSTK',
  trading_symbol: 'RELIANCE26JANFUT',
  exchange_token: 'F1',
  close_price: '2500',
  expiry: '29-Jan-2099', // far future — always "not yet expired" regardless of `now`
  company_name: 'RELIANCE',
  strike: '',
  option_type: '',
}

const SESSIONS: Candle[] = [dailyBar(DAY1_OPEN, 2400), dailyBar(DAY2_OPEN, 2450), dailyBar(DAY3_OPEN, 2420), dailyBar(DAY4_OPEN, 2999)]
const CANDLES: Candle[] = [
  candle(DAY1_OPEN, 2400, 2410, 2390, 2400, 500),
  candle(DAY2_OPEN, 2400, 2460, 2390, 2450, 800),
  candle(DAY3_OPEN, 2450, 2430, 2410, 2420, 1200),
  candle(DAY4_OPEN, 2420, 2510, 2415, 2480, 1000),
  candle(DAY4_OPEN + BAR, 2480, 2520, 2470, 2500, 2000),
]

class FakeIntradayDataSource implements MarketDataSource {
  fetchHistoricalCandlesCallCount = 0
  fetchDailyBarsCallCount = 0
  loadScripMasterCallCount = 0
  tickListener: ((tick: MarketTick) => void) | null = null
  throwOnLoadScripMaster = false
  scripRows: ScripRow[]
  candlesByToken: Map<string, Candle[]>
  dailyBarsByToken: Map<string, Candle[]>

  constructor(scripRows: ScripRow[], candlesByToken: Map<string, Candle[]>, dailyBarsByToken: Map<string, Candle[]>) {
    this.scripRows = scripRows
    this.candlesByToken = candlesByToken
    this.dailyBarsByToken = dailyBarsByToken
  }

  async searchSymbol(): Promise<SearchResponse> {
    return { error: null, result: [] }
  }

  async loadScripMaster(): Promise<ScripRow[]> {
    this.loadScripMasterCallCount++
    if (this.throwOnLoadScripMaster) throw new Error('loadScripMaster should not have been called — a cached scrip master was available')
    return this.scripRows
  }

  async fetchHistoricalCandles(token: string): Promise<Candle[]> {
    this.fetchHistoricalCandlesCallCount++
    return this.candlesByToken.get(token) ?? []
  }

  async fetchDailyBars(instrument: Pick<Instrument, 'token' | 'exchange'>): Promise<Candle[]> {
    this.fetchDailyBarsCallCount++
    return this.dailyBarsByToken.get(instrument.token) ?? []
  }

  subscribeTicks(_tokens: string[], onTick: (tick: MarketTick) => void): () => void {
    this.tickListener = onTick
    return () => {
      this.tickListener = null
    }
  }

  getConnectionState(): ConnectionState {
    return 'connected'
  }

  async fetchIndexQuotes(keys: IndexQuoteKey[]): Promise<IndexQuote[]> {
    return keys.map((key) => ({ key, label: key, last: 100, prevClose: 100, changePct: 0, time: NOW }))
  }

  emitTick(tick: MarketTick): void {
    this.tickListener?.(tick)
  }
}

function makeFake(): FakeIntradayDataSource {
  return new FakeIntradayDataSource([FUTSTK_ROW], new Map([['F1', CANDLES]]), new Map([['F1', SESSIONS]]))
}

let activeStore: IntradayStore | null = null

afterEach(() => {
  activeStore?.getState().stop()
  activeStore = null
  usePauseStore.getState().setPaused(false)
  useStarredStore.setState({ tokens: new Set() })
  localStorage.clear()
})

describe('intradayStore — acceptance', () => {
  it('reaches ready with non-empty rows and every meter populated, using the real mock at the default seed', async () => {
    const dataSource = new MockMarketDataSource(DEFAULT_SEED, { mode: 'fixed', startTimestamp: REFERENCE_NOW })
    dataSource.setFastForward(true)

    activeStore = createIntradayStore({ dataSource, now: () => dataSource.getNow() })

    const startedAt = Date.now()
    await activeStore.getState().init()
    const elapsedMs = Date.now() - startedAt

    const state = activeStore.getState()
    expect(state.loadState).toBe('ready')
    expect(state.rows.length).toBeGreaterThan(0)
    expect(Object.keys(state.bySector).length).toBeGreaterThan(0)
    expect(state.indexQuotes).toHaveLength(3)

    expect(state.meters.marketMeter).toEqual(expect.objectContaining({ upPct: expect.any(Number), downPct: expect.any(Number) }))
    expect(state.meters.indexMeter.length).toBeGreaterThan(0)
    expect(state.meters.sectorStrength.length).toBeGreaterThan(0)
    expect(state.meters.intradayIndex.length).toBeGreaterThan(0)
    expect(state.meters.headerCounts).toEqual(
      expect.objectContaining({ breakoutUpCount: expect.any(Number), breakoutDownCount: expect.any(Number) }),
    )

    // Not a strict CI timing guarantee (this is a real "under 2s in the browser"
    // acceptance claim), but with the mock's artificial latency skipped via
    // setFastForward, this should be comfortably fast — a generous ceiling
    // here just catches an actual regression (e.g. accidental unbounded
    // concurrency or a forgotten await-in-a-loop), not real load time.
    expect(elapsedMs).toBeLessThan(10000)
  }, 20000)
})

describe('intradayStore — lifecycle', () => {
  it('reuses a cached scrip master instead of calling loadScripMaster()', async () => {
    const fake = makeFake()
    fake.throwOnLoadScripMaster = true

    activeStore = createIntradayStore({ dataSource: fake, now: () => NOW, getCachedScripRows: () => fake.scripRows })
    await activeStore.getState().init()

    expect(activeStore.getState().loadState).toBe('ready')
    expect(fake.loadScripMasterCallCount).toBe(0)
    expect(activeStore.getState().rows).toHaveLength(1)
  })

  it('StrictMode-style init → stop → init runs ONE load pipeline and ONE tick subscription', async () => {
    const fake = makeFake()
    let subscribeCalls = 0
    const originalSubscribe = fake.subscribeTicks.bind(fake)
    fake.subscribeTicks = (tokens, onTick) => {
      subscribeCalls += 1
      return originalSubscribe(tokens, onTick)
    }
    activeStore = createIntradayStore({ dataSource: fake, now: () => NOW })

    const first = activeStore.getState().init()
    activeStore.getState().stop()
    const second = activeStore.getState().init()
    await Promise.all([first, second])

    expect(fake.loadScripMasterCallCount).toBe(1)
    expect(fake.fetchHistoricalCandlesCallCount).toBe(1) // one instrument, fetched once — not once per init()
    expect(subscribeCalls).toBe(1)
    expect(activeStore.getState().loadState).toBe('ready')
  })

  it('a refreshAll() racing an in-flight load shares it rather than starting a second pipeline', async () => {
    const fake = makeFake()
    activeStore = createIntradayStore({ dataSource: fake, now: () => NOW })
    await Promise.all([activeStore.getState().init(), activeStore.getState().refreshAll()])
    expect(fake.loadScripMasterCallCount).toBe(1)
  })

  it('falls back to loadScripMaster() when nothing is cached', async () => {
    const fake = makeFake()
    activeStore = createIntradayStore({ dataSource: fake, now: () => NOW })
    await activeStore.getState().init()

    expect(fake.loadScripMasterCallCount).toBe(1)
    expect(activeStore.getState().loadState).toBe('ready')
  })
})

describe('intradayStore — live updates', () => {
  it('a tick updates cmp/changePct but never strength/breakout/intradayDir', async () => {
    const fake = makeFake()
    activeStore = createIntradayStore({ dataSource: fake, now: () => NOW, scheduleFrame: (flush) => flush() })
    await activeStore.getState().init()

    const before = activeStore.getState().rows.find((r) => r.token === 'F1')!
    const fetchCountBefore = fake.fetchHistoricalCandlesCallCount

    // Same bar (no bar-start advance) — must NOT trigger a recompute.
    fake.emitTick({ token: 'F1', exchange: 'NFO', ltp: 2600, time: DAY4_OPEN + BAR + 30 })

    const after = activeStore.getState().rows.find((r) => r.token === 'F1')!
    expect(after.cmp).toBe(2600)
    expect(after.changePct).toBeCloseTo((2600 / after.prevClose - 1) * 100, 10)

    expect(after.strength).toBe(before.strength)
    expect(after.breakout).toBe(before.breakout)
    expect(after.intradayDir).toBe(before.intradayDir)
    expect(fake.fetchHistoricalCandlesCallCount).toBe(fetchCountBefore) // no extra fetch from a mere tick
  })

  it('a bar close re-fetches and recomputes the full row for that instrument', async () => {
    const fake = makeFake()
    activeStore = createIntradayStore({ dataSource: fake, now: () => NOW })
    await activeStore.getState().init()

    const fetchCountBefore = fake.fetchHistoricalCandlesCallCount

    // First tick establishes the current bar bucket...
    fake.emitTick({ token: 'F1', exchange: 'NFO', ltp: 2600, time: DAY4_OPEN + BAR + 30 })
    // ...second tick lands in the NEXT bar -> bar-close detected.
    fake.emitTick({ token: 'F1', exchange: 'NFO', ltp: 2610, time: DAY4_OPEN + 2 * BAR + 10 })

    await vi.waitFor(() => {
      expect(fake.fetchHistoricalCandlesCallCount).toBeGreaterThan(fetchCountBefore)
    })
  })

  it('coalesces every tick in a frame into ONE store write, keeping only the latest price per token', async () => {
    const fake = makeFake()
    const frames: (() => void)[] = []
    activeStore = createIntradayStore({ dataSource: fake, now: () => NOW, scheduleFrame: (flush) => frames.push(flush) })
    await activeStore.getState().init()

    let writes = 0
    const unsubscribe = activeStore.subscribe(() => {
      writes += 1
    })
    const versionBefore = activeStore.getState().rowsVersion

    fake.emitTick({ token: 'F1', exchange: 'NFO', ltp: 2600, time: DAY4_OPEN + BAR + 10 })
    fake.emitTick({ token: 'F1', exchange: 'NFO', ltp: 2610, time: DAY4_OPEN + BAR + 20 })
    fake.emitTick({ token: 'F1', exchange: 'NFO', ltp: 2620, time: DAY4_OPEN + BAR + 30 })

    expect(writes).toBe(0) // nothing written until the frame fires
    expect(frames).toHaveLength(1) // three ticks, one scheduled frame
    frames[0]()

    expect(activeStore.getState().rows[0].cmp).toBe(2620)
    expect(activeStore.getState().rowsVersion).toBe(versionBefore + 1)
    // One write for the tick flush; the leading-edge meter throttle may add at most one more (it's a separate 1s cadence).
    expect(writes).toBeLessThanOrEqual(2)
    unsubscribe()
  })

  it('meterRows stays on its 1s snapshot while ticks move rows', async () => {
    const fake = makeFake()
    activeStore = createIntradayStore({ dataSource: fake, now: () => NOW, scheduleFrame: (flush) => flush() })
    await activeStore.getState().init()

    // First flush consumes the throttle's leading edge...
    fake.emitTick({ token: 'F1', exchange: 'NFO', ltp: 2600, time: DAY4_OPEN + BAR + 10 })
    const meterVersionAfterFirst = activeStore.getState().metersVersion
    // ...so a second flush inside the same second must NOT re-snapshot meters.
    fake.emitTick({ token: 'F1', exchange: 'NFO', ltp: 2700, time: DAY4_OPEN + BAR + 20 })

    expect(activeStore.getState().rows[0].cmp).toBe(2700)
    expect(activeStore.getState().metersVersion).toBe(meterVersionAfterFirst)
    expect(activeStore.getState().meterRows[0].cmp).not.toBe(2700)
  })

  it('pause suppresses the bar-close recompute', async () => {
    const fake = makeFake()
    activeStore = createIntradayStore({ dataSource: fake, now: () => NOW })
    await activeStore.getState().init()

    usePauseStore.getState().setPaused(true)
    const fetchCountBefore = fake.fetchHistoricalCandlesCallCount

    fake.emitTick({ token: 'F1', exchange: 'NFO', ltp: 2600, time: DAY4_OPEN + BAR + 30 })
    fake.emitTick({ token: 'F1', exchange: 'NFO', ltp: 2610, time: DAY4_OPEN + 2 * BAR + 10 })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fake.fetchHistoricalCandlesCallCount).toBe(fetchCountBefore)
  })
})

describe('assertBarBoundaryInvariant', () => {
  const locked = { strength: 3, breakout: 'BREAKOUT-UP' as const, breakoutLevel: 100, intradayDir: 'up' as const }
  function row(overrides: Partial<IntradayRow>): IntradayRow {
    return {
      symbol: 'X-EQ', baseSymbol: 'X', token: 'T', exchange: 'NSE', sector: 'Others', indices: [],
      cmp: 1, prevClose: 1, changePct: 0, change3dPct: 0, dayOpen: 1, dayHigh: 1, dayLow: 1, vwap: 1,
      strength: 3, strengthTone: 'medium', intradayDir: 'up', breakout: 'BREAKOUT-UP', breakoutLevel: 100,
      rvol: 1, zMove: 0, persistence: 0, cachedClose: 1, lastTickAt: 0, starred: false,
      ...overrides,
    }
  }

  it('passes when only tick-driven fields moved', () => {
    expect(() => assertBarBoundaryInvariant([row({ cmp: 999, changePct: 5 })], new Map([['T', locked]]))).not.toThrow()
  })

  it('treats NaN strength as equal to NaN', () => {
    expect(() => assertBarBoundaryInvariant([row({ strength: NaN })], new Map([['T', { ...locked, strength: NaN }]]))).not.toThrow()
  })

  it.each([
    ['strength', { strength: 4 }],
    ['breakout', { breakout: null }],
    ['breakoutLevel', { breakoutLevel: 101 }],
    ['intradayDir', { intradayDir: 'down' as const }],
  ])('throws when %s changes between bar boundaries', (_name, patch) => {
    expect(() => assertBarBoundaryInvariant([row(patch)], new Map([['T', locked]]))).toThrow(/bar-boundary invariant/)
  })
})

describe('intradayStore — starring', () => {
  it('toggleStar flips the row\'s starred flag and the starred array', async () => {
    const fake = makeFake()
    activeStore = createIntradayStore({ dataSource: fake, now: () => NOW })
    await activeStore.getState().init()

    expect(activeStore.getState().rows[0].starred).toBe(false)
    expect(activeStore.getState().starred).toEqual([])

    activeStore.getState().toggleStar('F1')

    expect(activeStore.getState().rows[0].starred).toBe(true)
    expect(activeStore.getState().starred).toEqual(['F1'])
  })
})

describe('intradayStore — filters', () => {
  it('setFilters merges into the existing filters rather than replacing them', () => {
    const fake = makeFake()
    activeStore = createIntradayStore({ dataSource: fake, now: () => NOW })

    activeStore.getState().setFilters({ sector: 'Refineries' })
    activeStore.getState().setFilters({ minStrength: 2 })

    expect(activeStore.getState().filters).toEqual(
      expect.objectContaining({ sector: 'Refineries', minStrength: 2, direction: 'all', breakoutOnly: false }),
    )
  })
})
