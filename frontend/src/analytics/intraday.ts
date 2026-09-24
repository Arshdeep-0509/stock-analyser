/**
 * The single function that turns one instrument's candles into every field
 * the /intraday dashboard shows for it. Pure: no React, no data-source
 * imports — every input is already-fetched data (candles, sessions, a live
 * LTP if one exists), and the caller (a hook/store sitting on top of
 * MarketDataSource) is responsible for fetching that data and for the one
 * genuinely stateful field (`starred`, persisted in src/store/starredStore.ts).
 *
 * REUSES, never reimplements, the parity-locked engine:
 *  - `intradayDir` is the colour of the LAST CLOSED Heikin-Ashi candle
 *    (src/strategy/indicators.ts computeHeikinAshi) — the same signal the
 *    /rsi-ha HA column shows, so the two pages agree by construction.
 *  - `breakout`/`breakoutLevel` come from src/strategy/signals.ts
 *    checkBreakout(), called with whatever StrategyParams the caller
 *    passes in (DEFAULT_PARAMS.breakoutLookback = 20 unless overridden) —
 *    not a second breakout rule.
 *  - `strength`/`strengthTone`/`rvol`/`zMove`/`persistence` come from
 *    src/analytics/strength.ts, via deriveStrengthInputs() +
 *    computeStrengthBreakdown().
 *
 * `candles` must already be closed-only (the forming bar dropped via
 * src/strategy/dropFormingCandle.ts, exactly as the screener does) — this
 * function does not drop it again.
 */
import { baseSymbolOf } from './enrich'
import { computeStrengthBreakdown, deriveStrengthInputs, strengthTone } from './strength'
import { groupByIstDay, istDateKey } from './daily'
import { getSector } from '../data/reference/sectors'
import { getMarketSession } from '../lib/marketSession'
import { indicesForSymbol } from '../data/reference/indices'
import { computeHeikinAshi } from '../strategy/indicators'
import { checkBreakout } from '../strategy/signals'
import type { StrategyParams } from '../strategy/constants'
import type { Candle, Instrument, IntradayRow } from '../types/domain'

export interface ComputeIntradayRowInput {
  instrument: Instrument
  /** Closed 5-minute candles, forming bar already dropped, oldest first. */
  candles: Candle[]
  /** Daily bars; may include today as a trailing partial bar (it's identified and excluded from "completed sessions" internally, exactly like deriveStrengthInputs). */
  sessions: Candle[]
  /** Live LTP, if a tick has arrived yet — cmp falls back to the last closed candle's close when this is undefined. */
  ltp: number | undefined
  /** Epoch seconds — the single source of "now" (STRATEGY-CONTRACT.md discipline: never Date.now() inside a pure function). */
  now: number
  params: StrategyParams
  /** The user's own marker — see IntradayRow.starred. Defaults to false. */
  starred?: boolean
}

function typicalPrice(candle: Candle): number {
  return (candle.high + candle.low + candle.close) / 3
}

function vwapOf(bars: readonly Candle[]): number {
  if (bars.length === 0) return NaN
  let numerator = 0
  let volume = 0
  for (const bar of bars) {
    numerator += typicalPrice(bar) * bar.volume
    volume += bar.volume
  }
  return volume > 0 ? numerator / volume : NaN
}

const BAR_SECONDS = 5 * 60

/**
 * The instant the day-scoped analytics stand at. While the market is open,
 * `now`. Otherwise the close of the last bar the feed produced: after 15:30
 * that is today's close; before 09:15 and on weekends it is the previous
 * session's, so "today" is the last session and the page shows its 15:30
 * values (as a broker terminal does until the open), never a day with no
 * bars, where every move would read 0% and every day range would be blank.
 */
export function marketAsOf(candles: readonly Candle[], now: number): number {
  const last = candles.length > 0 ? candles[candles.length - 1] : null
  if (last === null || getMarketSession(new Date(now * 1000)) === 'OPEN') return now
  return Math.min(now, last.time + BAR_SECONDS)
}

export function computeIntradayRow(input: ComputeIntradayRowInput): IntradayRow {
  const { instrument, candles, sessions, ltp, params, starred = false } = input
  const now = marketAsOf(candles, input.now)

  const baseSymbol = baseSymbolOf(instrument)
  const sector = instrument.sector ?? getSector(baseSymbol)
  const indices = indicesForSymbol(baseSymbol)

  const lastClosedCandle = candles.length > 0 ? candles[candles.length - 1] : null
  const cmp = ltp ?? lastClosedCandle?.close ?? NaN
  const lastTickAt = ltp !== undefined ? input.now : (lastClosedCandle?.time ?? NaN)

  // Today's closed bars, for dayOpen/dayHigh/dayLow/vwap. Reuses the same
  // day-splitting groupByIstDay() strength.ts's deriveStrengthInputs()
  // uses, so "today" can never be identified differently in the two places.
  const todayKey = istDateKey(now)
  const todayBars = groupByIstDay(candles).find((day) => istDateKey(day[0].time) === todayKey) ?? []

  const dayOpen = todayBars.length > 0 ? todayBars[0].open : NaN
  const dayHigh = todayBars.length > 0 ? Math.max(...todayBars.map((c) => c.high)) : NaN
  const dayLow = todayBars.length > 0 ? Math.min(...todayBars.map((c) => c.low)) : NaN
  const vwap = vwapOf(todayBars)

  // prevClose / change3dPct: reuse the exact same completed-session close
  // list Strength's sigmaDaily is built from — "3 sessions back" means the
  // 3rd-from-last entry here, never a 72-hour lookback (weekends don't
  // shift it, because these are SESSION closes, not calendar days).
  const strengthInputs = deriveStrengthInputs(sessions, candles, cmp, now)
  const completedCloses = strengthInputs.dailyCloses
  const prevClose = completedCloses.length > 0 ? completedCloses[completedCloses.length - 1] : NaN
  const changePct = Number.isNaN(prevClose) ? NaN : (cmp / prevClose - 1) * 100
  // "Fewer than 4 sessions of history" = fewer than 3 completed + today, matching strength.ts's own convention.
  const change3dPct = completedCloses.length < 3 ? NaN : (cmp / completedCloses[completedCloses.length - 3] - 1) * 100

  const breakdown = computeStrengthBreakdown(strengthInputs)

  // intradayDir: the LAST CLOSED HA candle's colour, over the FULL passed-in
  // series (not day-scoped) — exactly what /rsi-ha's HA column reads, so
  // the arrow here means the same thing there. computeHeikinAshi() on an
  // empty series has nothing to report; 'up' is an arbitrary but harmless
  // default for a state no real (already-fetched) instrument reaches.
  const haCandles = computeHeikinAshi(candles)
  const lastHa = haCandles.length > 0 ? haCandles[haCandles.length - 1] : null
  const intradayDir: 'up' | 'down' = lastHa === null || lastHa.haColor === 'green' ? 'up' : 'down'

  const breakoutResult = checkBreakout(candles, params)

  return {
    symbol: instrument.symbol,
    baseSymbol,
    token: instrument.token,
    exchange: instrument.exchange,
    sector,
    indices,

    cmp,
    prevClose,
    changePct,
    change3dPct,

    dayOpen,
    dayHigh,
    dayLow,
    vwap,

    strength: breakdown.strength,
    strengthTone: strengthTone(breakdown.strength),

    intradayDir,

    breakout: breakoutResult.signal,
    breakoutLevel: breakoutResult.level,

    rvol: breakdown.rvol,
    zMove: breakdown.zMove,
    persistence: breakdown.persistence,

    cachedClose: instrument.cachedClose,

    lastTickAt,
    starred,
  }
}
