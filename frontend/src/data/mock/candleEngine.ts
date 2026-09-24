import type { HistoricalCandlesResponse, RawCandleRow } from '../../types/api'
import type { Candle } from '../../types/domain'
import { deriveSeed, mulberry32, randomFloat, randomGaussian, randomInt, type Rng } from './rng'

const BARS_PER_DAY = 75
const BAR_MINUTES = 5
const MARKET_OPEN_MINUTES = 9 * 60 + 15 // 09:15 IST

function toIstParts(epochSeconds: number): { year: number; month0: number; day: number; weekday: number } {
  const istMs = epochSeconds * 1000 + (5 * 60 + 30) * 60 * 1000
  const d = new Date(istMs)
  return { year: d.getUTCFullYear(), month0: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay() }
}

/** IST calendar date (Y/M0/D) + minutes-since-midnight (IST) -> epoch seconds. */
function istToEpochSeconds(year: number, month0: number, day: number, minutesSinceMidnight: number): number {
  const utcMs = Date.UTC(year, month0, day, 0, minutesSinceMidnight, 0) - (5 * 60 + 30) * 60 * 1000
  return Math.floor(utcMs / 1000)
}

/** The most recent `count` weekday (Mon-Fri) IST calendar dates at or before `referenceNow`, oldest first. */
export function recentTradingDays(referenceNow: number, count: number): Array<{ year: number; month0: number; day: number }> {
  const days: Array<{ year: number; month0: number; day: number }> = []
  let cursorEpoch = referenceNow

  while (days.length < count) {
    const parts = toIstParts(cursorEpoch)
    if (parts.weekday !== 0 && parts.weekday !== 6) {
      days.push({ year: parts.year, month0: parts.month0, day: parts.day })
    }
    cursorEpoch -= 24 * 60 * 60
  }

  return days.reverse()
}

/**
 * All 375 (5 days x 75 bars) bar-start epoch-second timestamps, oldest first:
 * the last `daysBack` sessions that have STARTED by `referenceNow`. Before
 * 09:15 today's session hasn't begun, so it isn't one of them; the history
 * then holds five completed sessions, as a real API's would, not four plus
 * a day of bars that haven't happened yet.
 */
export function buildSessionGrid(referenceNow: number, daysBack = 5): number[] {
  const beforeOpen = istMinutesOfDay(referenceNow) < MARKET_OPEN_MINUTES
  const days = recentTradingDays(beforeOpen ? referenceNow - 24 * 60 * 60 : referenceNow, daysBack)
  const times: number[] = []
  for (const day of days) {
    for (let bar = 0; bar < BARS_PER_DAY; bar++) {
      times.push(istToEpochSeconds(day.year, day.month0, day.day, MARKET_OPEN_MINUTES + bar * BAR_MINUTES))
    }
  }
  return times
}

export interface GenParams {
  startPrice: number
  /** Stdev of per-bar log-return. */
  volPerBar: number
  /** Mean per-bar log-return. */
  drift: number
  /** 0..1ish pull-back-to-fair-value strength; keeps RSI oscillating instead of pinning. */
  reversionStrength: number
  gapProbability: number
  gapMaxPct: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function volumeForBar(barIndexInDay: number, rng: Rng): number {
  const distFromEdge = Math.min(barIndexInDay, BARS_PER_DAY - 1 - barIndexInDay)
  const uShapeBoost = 1 + Math.max(0, 6 - distFromEdge) * 0.15
  return Math.round(randomInt(rng, 8000, 60000) * uShapeBoost)
}

/**
 * Generates one closed candle series for a token: a GBM random walk with a
 * light mean-reverting pull (so RSI actually oscillates through the
 * 60-65 / 35-40 bands instead of pinning at extremes) and occasional
 * gap-up/gap-down at each day's open. Nothing here targets a specific
 * signal outcome — only the aggregate vol/drift/reversion parameters are
 * ever tuned (see generateUniverse.ts), never individual candle values.
 */
export function generateCandleSeries(barTimes: readonly number[], params: GenParams, rng: Rng): Candle[] {
  const candles: Candle[] = []
  let price = params.startPrice
  let fairValue = params.startPrice
  let previousDayIndex = -1

  barTimes.forEach((time, i) => {
    const dayIndex = Math.floor(i / BARS_PER_DAY)
    const barIndexInDay = i % BARS_PER_DAY

    if (dayIndex !== previousDayIndex) {
      previousDayIndex = dayIndex
      if (rng() < params.gapProbability) {
        const gapPct = randomFloat(rng, -params.gapMaxPct, params.gapMaxPct)
        price = price * (1 + gapPct)
        fairValue = price
      }
    }

    const open = price
    const reversion = params.reversionStrength * ((fairValue - price) / fairValue)
    const shock = randomGaussian(rng) * params.volPerBar
    const logReturn = params.drift + reversion + shock
    const close = open * Math.exp(logReturn)

    const wickUp = Math.abs(randomGaussian(rng)) * params.volPerBar * 0.6
    const wickDown = Math.abs(randomGaussian(rng)) * params.volPerBar * 0.6
    const high = Math.max(open, close) * (1 + wickUp)
    const low = Math.min(open, close) * (1 - wickDown)

    candles.push({
      time,
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      volume: volumeForBar(barIndexInDay, rng),
    })

    price = close
    fairValue = fairValue + (price - fairValue) * 0.02
  })

  return candles
}

/** Default generation parameters, derived deterministically from (seed, token). */
export function defaultGenParams(seed: number, token: string, startPrice: number): GenParams {
  const rng = mulberry32(deriveSeed(seed, `genparams:${token}`))
  return {
    startPrice,
    volPerBar: randomFloat(rng, 0.0009, 0.0035),
    drift: randomFloat(rng, -0.00015, 0.00015),
    reversionStrength: randomFloat(rng, 0.03, 0.12),
    gapProbability: 0.35,
    gapMaxPct: randomFloat(rng, 0.002, 0.012),
  }
}

function toRawRow(candle: Candle): RawCandleRow {
  return [String(candle.time), String(candle.open), String(candle.high), String(candle.low), String(candle.close), String(candle.volume)]
}

/**
 * Holds the generated closed-candle series per token in memory, and is the
 * single source of truth both fetchHistoricalCandles() and the mock
 * WebSocket read from/append to — a tick and a candle for the same symbol
 * can never disagree, because they share this state.
 */
export class CandleEngine {
  private readonly seed: number
  private readonly referenceNow: number
  private readonly sessionGrid: number[]
  private readonly seriesByToken = new Map<string, Candle[]>()
  private readonly genParamsByToken = new Map<string, GenParams>()

  constructor(seed: number, referenceNow: number) {
    this.seed = seed
    this.referenceNow = referenceNow
    this.sessionGrid = buildSessionGrid(referenceNow, 5)
  }

  /** The first and last bar-start times of the generated 5-day session grid — for building a replay scrubber. */
  getSessionBounds(): { start: number; end: number } {
    const first = this.sessionGrid[0]
    const last = this.sessionGrid[this.sessionGrid.length - 1]
    return { start: first, end: last }
  }

  private ensureSeries(token: string, startPrice: number): Candle[] {
    let series = this.seriesByToken.get(token)
    if (!series) {
      const params = defaultGenParams(this.seed, token, startPrice)
      this.genParamsByToken.set(token, params)
      const rng = mulberry32(deriveSeed(this.seed, `candles:${token}`))
      series = generateCandleSeries(this.sessionGrid, params, rng)
      this.seriesByToken.set(token, series)
    }
    return series
  }

  /** Overrides a token's generation parameters and clears any cached series (used by the retry-tuning loop). */
  setGenParams(token: string, params: GenParams): void {
    this.genParamsByToken.set(token, params)
    const rng = mulberry32(deriveSeed(this.seed, `candles:${token}`))
    this.seriesByToken.set(token, generateCandleSeries(this.sessionGrid, params, rng))
  }

  getClosedCandles(token: string, startPrice: number): Candle[] {
    return this.ensureSeries(token, startPrice).slice()
  }

  getGenParams(token: string, startPrice: number): GenParams {
    this.ensureSeries(token, startPrice)
    const params = this.genParamsByToken.get(token)
    if (!params) throw new Error(`CandleEngine: no genParams for token ${token}`)
    return params
  }

  /** Raw wire-shape response, numbers encoded as strings, sliced to the last `daysBack` days. */
  getRawHistoricalResponse(token: string, startPrice: number, daysBack: number): HistoricalCandlesResponse {
    const series = this.ensureSeries(token, startPrice)
    const cutoff = this.referenceNow - daysBack * 24 * 60 * 60
    const slice = series.filter((c) => c.time >= cutoff)
    return { data: { candles: slice.map(toRawRow) } }
  }

  getLastPrice(token: string, startPrice: number): number {
    const series = this.ensureSeries(token, startPrice)
    const last = series[series.length - 1]
    return last ? last.close : startPrice
  }

  /**
   * Advances the live tick/candle state for a token to `now` and returns the
   * tick — or null when no bar is forming (the market is closed), because a
   * real feed is silent then: nothing moves and nothing is invented, so the
   * screen holds the 15:30 close until the next session opens.
   *
   * The bar containing `now` either already exists (today's bars are
   * generated up front, so the closed-candle history is seed-deterministic
   * and independent of how often anything ticked) or is rolled on here —
   * session bars only (09:15-15:25 bar starts, Mon-Fri), backfilling any a
   * long-running tab or sped-up clock skipped so the series stays gap-free.
   * The tick is that bar's state `elapsed` of the way through it: a seeded
   * path from its open to its close that never leaves its high/low, so a
   * tick and the candle it belongs to can never disagree, and the bar the
   * history returns once it closes is exactly the bar the ticks showed.
   *
   * `allowOffSession` is the devtools "Force OPEN" override: bars are rolled
   * on every 5 minutes whatever the time, so the demo runs after hours.
   */
  advanceLiveTick(token: string, startPrice: number, now: number, allowOffSession = false): { price: number; candle: Candle } | null {
    const barSeconds = BAR_MINUTES * 60
    const barStart = Math.floor(now / barSeconds) * barSeconds
    if (!allowOffSession && !isSessionBar(barStart)) return null

    const series = this.ensureSeries(token, startPrice)
    const params = this.genParamsByToken.get(token) ?? defaultGenParams(this.seed, token, startPrice)

    let last = series[series.length - 1]
    if (!last) {
      const rng = mulberry32(deriveSeed(this.seed, `tick:${token}:${barStart}`))
      last = { time: barStart, open: startPrice, high: startPrice, low: startPrice, close: startPrice, volume: volumeForBar(0, rng) }
      series.push(last)
    }

    while (barStart > last.time) {
      const nextTime = allowOffSession ? last.time + barSeconds : nextSessionBar(last.time)
      if (nextTime > barStart) break
      const rng = mulberry32(deriveSeed(this.seed, `tick:${token}:${nextTime}`))
      const open = last.close
      const shock = randomGaussian(rng) * params.volPerBar
      const close = round2(open * Math.exp(params.drift + shock))
      const wickUp = Math.abs(randomGaussian(rng)) * params.volPerBar * 0.6
      const wickDown = Math.abs(randomGaussian(rng)) * params.volPerBar * 0.6
      const candle: Candle = {
        time: nextTime,
        open,
        high: round2(Math.max(open, close) * (1 + wickUp)),
        low: round2(Math.min(open, close) * (1 - wickDown)),
        close,
        volume: volumeForBar(barIndexInDay(nextTime), rng),
      }
      series.push(candle)
      last = candle
    }

    const bar = findBar(series, barStart)
    if (!bar) return null
    const elapsed = Math.min(1, Math.max(0, (now - barStart) / barSeconds))
    const forming = formingState(bar, elapsed, mulberry32(deriveSeed(this.seed, `tick:${token}:${now}`)))
    return { price: forming.close, candle: forming }
  }
}

/** True when `barStart` is one of a trading day's 75 bar starts (09:15-15:25 IST, Mon-Fri). */
export function isSessionBar(barStart: number): boolean {
  const parts = toIstParts(barStart)
  if (parts.weekday === 0 || parts.weekday === 6) return false
  const minutes = istMinutesOfDay(barStart)
  return minutes >= MARKET_OPEN_MINUTES && minutes < MARKET_OPEN_MINUTES + BARS_PER_DAY * BAR_MINUTES
}

/** The first session bar start strictly after `time`. */
export function nextSessionBar(time: number): number {
  const barSeconds = BAR_MINUTES * 60
  let t = Math.floor(time / barSeconds) * barSeconds + barSeconds
  if (isSessionBar(t)) return t
  // Jump to the next weekday's 09:15 instead of walking every overnight slot.
  for (;;) {
    const p = toIstParts(t)
    const open = istToEpochSeconds(p.year, p.month0, p.day, MARKET_OPEN_MINUTES)
    t = open > t ? open : istToEpochSeconds(p.year, p.month0, p.day + 1, MARKET_OPEN_MINUTES)
    if (isSessionBar(t)) return t
  }
}

function istMinutesOfDay(epochSeconds: number): number {
  const d = new Date((epochSeconds + (5 * 60 + 30) * 60) * 1000)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

function barIndexInDay(barStart: number): number {
  return Math.floor((istMinutesOfDay(barStart) - MARKET_OPEN_MINUTES) / BAR_MINUTES)
}

function findBar(series: readonly Candle[], time: number): Candle | undefined {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].time === time) return series[i]
    if (series[i].time < time) return undefined
  }
  return undefined
}

/**
 * A bar's state `elapsed` (0..1) of the way through it: price on a line from
 * open to close plus seeded noise that fades to zero at the close, clamped to
 * the bar's range; high/low are the extremes reached so far (they grow
 * toward the bar's own, reaching them at the close); volume accrues linearly.
 * At elapsed = 1 it returns the bar itself, value for value.
 */
export function formingState(bar: Candle, elapsed: number, rng: Rng): Candle {
  if (elapsed >= 1) return { ...bar }
  const noise = randomGaussian(rng) * (bar.high - bar.low) * 0.25 * Math.sqrt(elapsed * (1 - elapsed))
  const close = round2(Math.min(bar.high, Math.max(bar.low, bar.open + (bar.close - bar.open) * elapsed + noise)))
  const high = round2(Math.max(close, bar.open + (bar.high - bar.open) * elapsed))
  const low = round2(Math.min(close, bar.open - (bar.open - bar.low) * elapsed))
  return { time: bar.time, open: bar.open, high, low, close, volume: Math.round(bar.volume * elapsed) }
}
