import { BASE_INTERVAL_MINUTES } from '../../strategy/resampleCandles'
import type { ScripRow, SearchResponse } from '../../types/api'
import type { Candle, Exchange, Instrument, MarketTick } from '../../types/domain'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../MarketDataSource'
import { parseHistoricalCandlesResponse } from '../parseCandles'
import { aggregateToSessions } from '../../analytics/daily'
import {
  buildIndexQuote,
  computeCapWeightedIndexSeries,
  generateIndiaVixSeries,
  type WeightedConstituent,
} from '../../analytics/indexComposite'
import { INDEX_PANELS } from '../reference/indices'
import type { ClockMode, ClockSpeed } from './clock'
import { MockClock } from './clock'
import { deriveSeed, mulberry32, randomFloat, type Rng } from './rng'
import { generateUniverse, type GeneratedUniverse } from './generateUniverse'
import { MockPrimusSocket } from './mockPrimus'

/**
 * CandleEngine's session grid is a fixed 5 TRADING days, but
 * getRawHistoricalResponse()'s `daysBack` cutoff is a wall-clock window
 * (`referenceNow - daysBack*86400`) — since trading hours are only
 * 09:15-15:30 IST, a `daysBack` of exactly 5 can fall mid-session and clip
 * 1-2 of the grid's boundary days depending on what time of day `now` is
 * (e.g. at 16:10 IST, "5 days back" lands after that day's own 15:30
 * close, silently excluding it). This buffer is generously larger than the
 * grid could ever be, so it always captures the full 5 trading days
 * regardless of time-of-day skew — CandleEngine has nothing further back
 * to return anyway, so asking for more than exists is harmless.
 */
const RAW_FETCH_DAYS_BACK = 10

/**
 * Deliberately excludes `now` — it changes every second (or faster, at
 * higher clock speeds) independent of any explicit state change, and
 * useSyncExternalStore requires getSnapshot() to return a referentially
 * stable value when nothing has changed. Read the live clock via getNow()
 * directly in the render body instead (the devtools panel already re-renders
 * once a second on its own timer for exactly this).
 */
export interface MockDevState {
  seed: number
  regenerateEpoch: number
  clockMode: ClockMode
  clockSpeed: ClockSpeed
  forceSessionOpen: boolean
  connection: ConnectionState
  signalCount: number
  attempts: number
  universeSize: number
  /** Bounds of the generated 5-day session grid — for a replay scrubber. */
  sessionStart: number
  sessionEnd: number
}

export const DEFAULT_SEED = 424242
/** Share of requests that fail with a simulated error — the mock's standing "real network is flaky" behaviour. */
export const DEFAULT_FAILURE_RATE = 0.02

/**
 * A fake Master Trust that is indistinguishable from the real one at the
 * type level: implements MarketDataSource exactly (no extra methods on
 * this interface, no leaked internals). Every number a consumer sees comes
 * out of generateUniverse() -> src/strategy/, run over generated candles —
 * nothing here is a hardcoded output. Swapping to a real backend later is a
 * one-line change: whatever constructs this instance constructs a real
 * MarketDataSource implementation instead.
 *
 * Extra methods below the interface boundary (setSeed, setSpeed,
 * forceDisconnect, ...) are dev-only controls for the devtools panel — they
 * are only ever called against the concrete class, never through the
 * MarketDataSource type consumers actually use.
 */
export class MockMarketDataSource implements MarketDataSource {
  private seed: number
  private regenerateEpoch = 0
  private readonly clock: MockClock
  private universe: GeneratedUniverse
  private scripRowByToken: Map<string, ScripRow>
  private readonly primus: MockPrimusSocket
  private runtimeRng: Rng
  private forceNextError = false
  private failureRate = DEFAULT_FAILURE_RATE
  private fastForward = false
  private readonly devListeners = new Set<() => void>()
  private lastDevState: MockDevState | null = null

  constructor(seed: number = DEFAULT_SEED, clockOptions?: ConstructorParameters<typeof MockClock>[0]) {
    this.seed = seed
    this.clock = new MockClock(clockOptions)
    this.runtimeRng = mulberry32(deriveSeed(seed, 'runtime'))
    this.universe = this.buildUniverse()
    this.scripRowByToken = this.indexScripRows(this.universe.scripMaster.rows)

    this.primus = new MockPrimusSocket(
      this.clock,
      () => this.universe.candleEngine,
      (token) => this.startPriceFor(token),
      (token) => this.exchangeFor(token),
      this.seed,
    )
    this.primus.onStateChange(() => this.notifyDevListeners())
  }

  // ---------------------------------------------------------------------
  // MarketDataSource — the exact interface, nothing more.
  // ---------------------------------------------------------------------

  async searchSymbol(keyword: string): Promise<SearchResponse> {
    await this.delay(150, 400)
    const needle = keyword.trim().toUpperCase()
    const result = this.universe.scripMaster.rows
      .filter((row) => row.trading_symbol.toUpperCase().includes(needle))
      .slice(0, 50)
      .map((row) => ({ exchange: row.exchange, trading_symbol: row.trading_symbol, token: row.exchange_token }))
    return { error: null, result }
  }

  // `interval` is part of the MarketDataSource contract (a real backend
  // would honour it directly) but this mock's CandleEngine only ever
  // produces a 5-minute base series — see the comment below.
  async fetchHistoricalCandles(token: string, exchange: Exchange, _interval: string, daysBack: number): Promise<Candle[]> {
    await this.delay(80, 250)

    if (this.shouldFail()) {
      throw new Error(`fetchHistoricalCandles: simulated failure for token=${token} exchange=${exchange}`)
    }

    const startPrice = this.startPriceFor(token)
    const raw = this.universe.candleEngine.getRawHistoricalResponse(token, startPrice, daysBack)
    // The mock's CandleEngine only ever generates a 5-minute base series —
    // `interval` is the CALLER's desired granularity (which src/strategy/
    // resampleCandles() aggregates up to afterwards), not this fetch's own.
    // The still-forming-bar cutoff must always match the data's true native
    // interval, never the caller's target, or a coarser target interval
    // would wrongly keep several already-closed 5-minute bars "forming".
    return parseHistoricalCandlesResponse(raw, BASE_INTERVAL_MINUTES, this.clock.now())
  }

  async loadScripMaster(): Promise<ScripRow[]> {
    await this.delay(600, 1200)
    return this.universe.scripMaster.rows
  }

  subscribeTicks(tokens: string[], onTick: (tick: MarketTick) => void, opts?: { priority?: string[] }): () => void {
    return this.primus.subscribe(
      tokens,
      (tick) => {
        onTick({
          token: String(tick.token),
          exchange: tick.exchange === 'NFO' ? 'NFO' : 'NSE',
          ltp: tick.ltp,
          time: tick.ltt,
          volume: tick.volume,
          open: tick.o,
          high: tick.h,
          low: tick.l,
          close: tick.c,
        })
      },
      opts,
    )
  }

  getConnectionState(): ConnectionState {
    return this.primus.getState()
  }

  async fetchIndexQuotes(keys: IndexQuoteKey[]): Promise<IndexQuote[]> {
    await this.delay(80, 250)

    if (this.shouldFail()) {
      throw new Error(`fetchIndexQuotes: simulated failure for keys=${keys.join(',')}`)
    }

    const now = this.clock.now()
    const niftySeries = this.compositeSeriesFor('NIFTY_50', now)

    return keys.map((key) => {
      if (key === 'INDIAVIX') {
        const rng = mulberry32(deriveSeed(this.seed, 'india-vix'))
        const vixSeries = generateIndiaVixSeries(
          niftySeries,
          { baseline: 13, reversionStrength: 0.05, volPerBar: 0.15, antiCorrelation: 0.6 },
          rng,
        )
        return buildIndexQuote('INDIAVIX', 'India VIX', vixSeries, now)
      }

      if (key === 'BANKNIFTY') {
        return buildIndexQuote('BANKNIFTY', 'BANK NIFTY', this.compositeSeriesFor('BANK_NIFTY', now), now)
      }

      return buildIndexQuote('NIFTY', 'NIFTY 50', niftySeries, now)
    })
  }

  async fetchDailyBars(instrument: Pick<Instrument, 'token' | 'exchange'>, days: number): Promise<Candle[]> {
    await this.delay(80, 250)

    if (this.shouldFail()) {
      throw new Error(`fetchDailyBars: simulated failure for token=${instrument.token}`)
    }

    const startPrice = this.startPriceFor(instrument.token)
    const raw = this.universe.candleEngine.getRawHistoricalResponse(instrument.token, startPrice, RAW_FETCH_DAYS_BACK)
    const closed = parseHistoricalCandlesResponse(raw, BASE_INTERVAL_MINUTES, this.clock.now())
    return aggregateToSessions(closed).slice(-days)
  }

  // ---------------------------------------------------------------------
  // Dev-only controls — NOT part of MarketDataSource. Only the devtools
  // panel should ever import this class directly to reach these.
  // ---------------------------------------------------------------------

  /**
   * TEST HOOK (dev-only, not on MarketDataSource): the share of requests, 0..1,
   * that throw a simulated failure. 1 = every request fails, 0 = none.
   */
  setFailureRate(rate: number): void {
    this.failureRate = Math.min(1, Math.max(0, rate))
  }

  setSeed(seed: number): void {
    this.seed = seed
    this.regenerateEpoch = 0
    this.runtimeRng = mulberry32(deriveSeed(seed, 'runtime'))
    this.rebuildUniverse()
  }

  regenerateUniverse(): void {
    this.regenerateEpoch += 1
    this.rebuildUniverse()
  }

  setClockMode(mode: ClockMode, startTimestamp?: number): void {
    this.clock.setMode(mode, startTimestamp)
    this.notifyDevListeners()
  }

  setSpeed(speed: ClockSpeed): void {
    this.clock.setSpeed(speed)
    this.notifyDevListeners()
  }

  setForceSessionOpen(force: boolean): void {
    this.clock.setForceSessionOpen(force)
    this.notifyDevListeners()
  }

  forceDisconnect(): void {
    this.primus.forceDisconnect()
  }

  /** The next fetchHistoricalCandles() call fails, regardless of the random 2% rate. */
  forceNextRequestError(): void {
    this.forceNextError = true
  }

  /**
   * Skips the artificial network-latency wait (not the RNG draw that
   * decides its duration, so the runtime RNG stream stays identical either
   * way — only the real setTimeout is skipped). Used by the replay
   * transport's "jump to next signal" search, which drives this same mock
   * through many back-to-back scans and would otherwise pay the simulated
   * per-request latency dozens of times over.
   */
  setFastForward(enabled: boolean): void {
    this.fastForward = enabled
  }

  /**
   * useSyncExternalStore requires getSnapshot() to return a referentially
   * stable value when nothing has actually changed — otherwise React
   * re-renders, calls getSnapshot() again, sees "another" new object, and
   * loops forever. So this only allocates a new object when a field
   * actually differs from the last one returned.
   */
  getDevState(): MockDevState {
    const clockState = this.clock.getState()
    const sessionBounds = this.universe.candleEngine.getSessionBounds()
    const next: MockDevState = {
      seed: this.seed,
      regenerateEpoch: this.regenerateEpoch,
      clockMode: clockState.mode,
      clockSpeed: clockState.speed,
      forceSessionOpen: clockState.forceSessionOpen,
      connection: this.getConnectionState(),
      signalCount: this.universe.signalCount,
      attempts: this.universe.attempts,
      universeSize: this.universe.results.length,
      sessionStart: sessionBounds.start,
      sessionEnd: sessionBounds.end,
    }

    const prev = this.lastDevState
    if (
      prev &&
      prev.seed === next.seed &&
      prev.regenerateEpoch === next.regenerateEpoch &&
      prev.clockMode === next.clockMode &&
      prev.clockSpeed === next.clockSpeed &&
      prev.forceSessionOpen === next.forceSessionOpen &&
      prev.connection === next.connection &&
      prev.signalCount === next.signalCount &&
      prev.attempts === next.attempts &&
      prev.universeSize === next.universeSize &&
      prev.sessionStart === next.sessionStart &&
      prev.sessionEnd === next.sessionEnd
    ) {
      return prev
    }

    this.lastDevState = next
    return next
  }

  /** The live simulated clock reading, epoch seconds — read directly in render, not via useSyncExternalStore. */
  getNow(): number {
    return this.clock.now()
  }

  subscribeDevState(listener: () => void): () => void {
    this.devListeners.add(listener)
    return () => this.devListeners.delete(listener)
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private buildUniverse(): GeneratedUniverse {
    const effectiveSeed = deriveSeed(this.seed, `epoch:${this.regenerateEpoch}`)
    return generateUniverse(effectiveSeed, this.clock.now())
  }

  private rebuildUniverse(): void {
    this.universe = this.buildUniverse()
    this.scripRowByToken = this.indexScripRows(this.universe.scripMaster.rows)
    this.notifyDevListeners()
  }

  private indexScripRows(rows: ScripRow[]): Map<string, ScripRow> {
    const map = new Map<string, ScripRow>()
    for (const row of rows) {
      map.set(String(row.exchange_token), row)
    }
    return map
  }

  /** Base symbol (company_name, always the base symbol per scripMaster.ts) -> its NSE EQ token + cachedClose. */
  private baseSymbolIndex(): Map<string, { token: string; cachedClose: number }> {
    const map = new Map<string, { token: string; cachedClose: number }>()
    for (const row of this.universe.scripMaster.rows) {
      if (row.exchange !== 'NSE' || row.instrument_name !== 'EQ') continue
      const price = Number(row.close_price)
      if (Number.isNaN(price)) continue
      map.set(row.company_name, { token: String(row.exchange_token), cachedClose: price })
    }
    return map
  }

  /**
   * Builds a capitalisation-weighted composite series for a named index
   * panel (src/data/reference/indices.ts) from its constituents' own closed
   * candles — the same closed-candle pipeline fetchHistoricalCandles() uses,
   * so an index quote is never a separate random walk from what the
   * screener shows for the same stocks.
   */
  private compositeSeriesFor(panelKey: 'NIFTY_50' | 'BANK_NIFTY', now: number): Candle[] {
    const panel = INDEX_PANELS.find((p) => p.key === panelKey)
    if (!panel) throw new Error(`compositeSeriesFor: unknown panel ${panelKey}`)

    const bySymbol = this.baseSymbolIndex()
    const constituents: WeightedConstituent[] = []

    for (const symbol of panel.constituents) {
      const entry = bySymbol.get(symbol)
      if (!entry) continue

      const raw = this.universe.candleEngine.getRawHistoricalResponse(entry.token, entry.cachedClose, RAW_FETCH_DAYS_BACK)
      const closed = parseHistoricalCandlesResponse(raw, BASE_INTERVAL_MINUTES, now)
      if (closed.length === 0) continue

      constituents.push({ weight: entry.cachedClose, series: closed })
    }

    return computeCapWeightedIndexSeries(constituents)
  }

  private startPriceFor(token: string): number {
    const row = this.scripRowByToken.get(token)
    if (!row) return 2500
    const price = Number(row.close_price)
    return Number.isNaN(price) ? 2500 : price
  }

  private exchangeFor(token: string): Exchange {
    const row = this.scripRowByToken.get(token)
    return row?.exchange === 'NFO' ? 'NFO' : 'NSE'
  }

  private shouldFail(): boolean {
    if (this.forceNextError) {
      this.forceNextError = false
      return true
    }
    // Always draw, whatever the rate, so changing the rate never shifts the rest of the seeded runtime sequence.
    return this.runtimeRng() < this.failureRate
  }

  private delay(minMs: number, maxMs: number): Promise<void> {
    const ms = randomFloat(this.runtimeRng, minMs, maxMs)
    if (this.fastForward) return Promise.resolve()
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private notifyDevListeners(): void {
    this.devListeners.forEach((listener) => listener())
  }
}
