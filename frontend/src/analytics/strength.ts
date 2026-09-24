/**
 * "Strength" — OUR OWN metric, not a port of anything in
 * mastertrust_rsi_ha_screener.py and NOT a reproduction of the "Strength"
 * column shown on AshishChadha.com or any other commercial dashboard. That
 * formula is proprietary and unknown to us. Rather than guess at it and
 * present the guess as theirs, we define our own and are explicit about it
 * everywhere it's shown — see docs/STRENGTH.md and StrengthInfo.tsx's
 * in-product disclosure.
 *
 * Formula:
 *
 *   sigmaDaily  = stdev of the last 20 daily log returns          (volatility)
 *   move        = (ltp / prevClose) - 1                           (today's move)
 *   zMove       = |move| / sigmaDaily                             (how unusual)
 *   rvol        = volumeSoFarToday
 *                 / medianVolumeToSameTimeOfDay(last 10 sessions) (participation)
 *   persistence = |Σ barReturn| / Σ|barReturn|   over today's closed 5-min bars
 *                                                                 (0..1, direction efficiency)
 *   Strength    = zMove × sqrt(max(rvol, 0.01)) × (0.5 + 0.5 × persistence)
 *
 * Why each term:
 *   - zMove normalises a 2% move in a sleepy FMCG name against a 2% move in
 *     a high-beta metal — the same raw % move means very different things
 *     depending on how much that stock usually moves.
 *   - sqrt(rvol) rewards genuine participation (real volume behind the move)
 *     without letting one freak volume spike 10x the metric — the square
 *     root compresses the tail.
 *   - persistence separates a clean trend (bar after bar in the same
 *     direction) from a name that covered the same net distance by
 *     chopping sideways all day; it's a direction-efficiency ratio in
 *     [0, 1], so the (0.5 + 0.5 × persistence) factor only ever HALVES
 *     Strength at worst (a maximally choppy day), never zeroes it out —
 *     a big, unusual, well-participated move still counts for something
 *     even on a choppy tape.
 *
 * Strength is UNSIGNED — it measures conviction/how remarkable a move is,
 * never its direction. Direction is the separate Intraday arrow/sign shown
 * alongside it.
 */
import type { Candle } from '../types/domain'
import { groupByIstDay, istDateKey } from './daily'

/**
 * "Fewer than 5 SESSIONS of history -> NaN" counts today's in-progress
 * session too (its partial data lives in `ltp`/`volumeSoFarToday`/
 * `todayBarReturns`, not in `dailyCloses`) — so the floor on `dailyCloses`
 * (completed sessions only) is one less than 5. Below this, sigmaDaily
 * would rest on too few log returns to mean anything, so Strength is
 * undefined rather than a guess.
 */
export const MIN_COMPLETED_DAILY_CLOSES = 4

/** The formula wants "the last 20 daily log returns" — this is a cap, not a requirement; however many are actually available (down to the MIN_COMPLETED_DAILY_CLOSES floor) get used. */
export const SIGMA_LOOKBACK_SESSIONS = 20

/** rvol's participation floor — see the sqrt(max(rvol, 0.01)) term above: a session with ~zero volume so far never collapses Strength all the way to 0 on that factor alone. */
export const MIN_RVOL = 0.01

export interface StrengthInputs {
  /**
   * Daily closing prices, oldest first, up to the last SIGMA_LOOKBACK_SESSIONS
   * — and explicitly NOT including today (today is still in progress; its
   * partial bar belongs in `volumeSoFarToday`/`todayBarReturns` instead).
   * The last element is `prevClose`.
   */
  dailyCloses: readonly number[]
  /** Today's last traded price. */
  ltp: number
  /** Sum of today's closed 5-minute bars' volume so far. */
  volumeSoFarToday: number
  /**
   * For each of up to the last 10 prior sessions, that session's cumulative
   * volume from open up to the SAME bar-of-day as "now" — however many
   * sessions are actually available (fewer than 10 is fine; the median is
   * taken over whatever's given).
   */
  priorSessionVolumesAtSameBar: readonly number[]
  /**
   * Each of today's closed 5-minute bars' own open-to-close return
   * (close/open - 1), oldest first. Empty before the first bar of the day
   * closes.
   */
  todayBarReturns: readonly number[]
}

function stdev(values: readonly number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * The terms behind a Strength value, for src/analytics/explainStrength.ts to
 * present as a breakdown and for src/analytics/intraday.ts's IntradayRow to
 * expose (`rvol`/`zMove`/`persistence`) for its own drill-down —
 * computeStrength() is just `.strength` off of this. Keeping one function
 * that does the real arithmetic means neither consumer can drift out of
 * sync with the number it's explaining. `rvol` and `persistence` are the
 * raw ratios; `sqrtRvol` and `persistenceFactor` are what actually get
 * multiplied into Strength (see the formula in this file's top comment).
 */
export interface StrengthBreakdown {
  strength: number
  zMove: number
  rvol: number
  sqrtRvol: number
  persistence: number
  persistenceFactor: number
}

/** The √rvol term, with its participation floor — the one place it's computed. */
export function sqrtRvolOf(rvol: number): number {
  return Math.sqrt(Math.max(rvol, MIN_RVOL))
}

/** The (0.5 + 0.5 × persistence) term — the one place it's computed. */
export function persistenceFactorOf(persistence: number): number {
  return 0.5 + 0.5 * persistence
}

/**
 * Rebuilds the full breakdown from the three raw terms an IntradayRow already
 * stores (zMove, vol, persistence) plus its strength — so a drill-down
 * can explain the row's OWN value instead of re-deriving inputs (and
 * possibly a different number) from a fresh fetch.
 */
export function breakdownFromTerms(terms: { strength: number; zMove: number; rvol: number; persistence: number }): StrengthBreakdown {
  if (Number.isNaN(terms.strength)) {
    return { strength: NaN, zMove: NaN, rvol: NaN, sqrtRvol: NaN, persistence: NaN, persistenceFactor: NaN }
  }
  return {
    strength: terms.strength,
    zMove: terms.zMove,
    rvol: terms.rvol,
    sqrtRvol: sqrtRvolOf(terms.rvol),
    persistence: terms.persistence,
    persistenceFactor: persistenceFactorOf(terms.persistence),
  }
}

/**
 * Guards:
 *  - Fewer than 5 sessions of history (4 completed closes + today) ->
 *    everything NaN. The UI must render a pale/blank dot for NaN, never a
 *    fake 0 — a 0 would claim "we checked and there's no conviction," when
 *    the truth is "we don't have enough history to check at all."
 *  - sigmaDaily === 0 (a perfectly flat stock) -> strength/zMove both 0,
 *    never Infinity/NaN from a division by zero. sqrtRvol/persistenceFactor
 *    are still computed and shown — a flat *price* history doesn't mean
 *    today's volume or bar-direction data is unavailable.
 */
export function computeStrengthBreakdown(inputs: StrengthInputs): StrengthBreakdown {
  const { dailyCloses, ltp, volumeSoFarToday, priorSessionVolumesAtSameBar, todayBarReturns } = inputs

  if (dailyCloses.length < MIN_COMPLETED_DAILY_CLOSES) {
    return { strength: NaN, zMove: NaN, rvol: NaN, sqrtRvol: NaN, persistence: NaN, persistenceFactor: NaN }
  }

  const recentCloses = dailyCloses.slice(-(SIGMA_LOOKBACK_SESSIONS + 1))
  const dailyLogReturns: number[] = []
  for (let i = 1; i < recentCloses.length; i++) {
    dailyLogReturns.push(Math.log(recentCloses[i] / recentCloses[i - 1]))
  }
  const sigmaDaily = stdev(dailyLogReturns)

  const medianVolume = median(priorSessionVolumesAtSameBar)
  const rvol = medianVolume > 0 ? volumeSoFarToday / medianVolume : 0
  const sqrtRvol = sqrtRvolOf(rvol)

  const sumAbsBarReturns = todayBarReturns.reduce((sum, r) => sum + Math.abs(r), 0)
  // No closed bars yet today (or a genuinely zero-movement day so far) ->
  // no evidence of directional efficiency either way -> 0, not NaN: zMove
  // and rvol can still be meaningful before the first intraday bar closes.
  const persistence = sumAbsBarReturns === 0 ? 0 : Math.abs(todayBarReturns.reduce((sum, r) => sum + r, 0)) / sumAbsBarReturns
  const persistenceFactor = persistenceFactorOf(persistence)

  if (sigmaDaily === 0) {
    return { strength: 0, zMove: 0, rvol, sqrtRvol, persistence, persistenceFactor }
  }

  const prevClose = dailyCloses[dailyCloses.length - 1]
  const move = ltp / prevClose - 1
  const zMove = Math.abs(move) / sigmaDaily

  return { strength: zMove * sqrtRvol * persistenceFactor, zMove, rvol, sqrtRvol, persistence, persistenceFactor }
}

/** Computes Strength, full precision (round only for display — e.g. formatNumber(value, 1)). See computeStrengthBreakdown() for the individual terms. */
export function computeStrength(inputs: StrengthInputs): number {
  return computeStrengthBreakdown(inputs).strength
}

export type StrengthTone = 'high' | 'medium' | 'low' | 'none'

/**
 * Colour bands — the ONE place these thresholds live. Derived from the
 * reference screenshots: 5.3 and 1.1 are green, 0.9 and 0.6 orange, 0.4 and
 * 0.1 yellow, blank is pale. Boundaries are inclusive on their lower edge.
 */
export const STRENGTH_TONE_THRESHOLDS = { low: 0.05, medium: 0.5, high: 1.0 } as const

export function strengthTone(value: number): StrengthTone {
  if (!Number.isFinite(value) || value < STRENGTH_TONE_THRESHOLDS.low) return 'none'
  if (value < STRENGTH_TONE_THRESHOLDS.medium) return 'low'
  if (value < STRENGTH_TONE_THRESHOLDS.high) return 'medium'
  return 'high'
}

// ---------------------------------------------------------------------------
// Deriving StrengthInputs from raw candle history
// ---------------------------------------------------------------------------

/**
 * Builds StrengthInputs from what a MarketDataSource implementation already
 * returns: `dailyBars` from fetchDailyBars() (may include today as a
 * trailing partial bar) and `intradayBars` from fetchHistoricalCandles()
 * covering at least the last (up to) 10 sessions, both closed-only. This is
 * the one place "today" is identified and split out from completed
 * history — everything else in this file stays a pure function of already-
 * separated inputs.
 */
export function deriveStrengthInputs(dailyBars: readonly Candle[], intradayBars: readonly Candle[], ltp: number, now: number): StrengthInputs {
  const todayKey = istDateKey(now)

  const intradayDays = groupByIstDay(intradayBars)
  const todayIndex = intradayDays.findIndex((day) => istDateKey(day[0].time) === todayKey)
  const todayBars = todayIndex >= 0 ? intradayDays[todayIndex] : []
  const priorIntradayDays = todayIndex >= 0 ? intradayDays.slice(0, todayIndex) : intradayDays

  const barsOfDaySoFar = todayBars.length
  const priorSessionVolumesAtSameBar = priorIntradayDays
    .slice(-10)
    .map((day) => day.slice(0, barsOfDaySoFar).reduce((sum, bar) => sum + bar.volume, 0))

  const volumeSoFarToday = todayBars.reduce((sum, bar) => sum + bar.volume, 0)
  const todayBarReturns = todayBars.map((bar) => bar.close / bar.open - 1)

  const completedDailyCloses = dailyBars.filter((bar) => istDateKey(bar.time) !== todayKey).map((bar) => bar.close)

  return {
    dailyCloses: completedDailyCloses,
    ltp,
    volumeSoFarToday,
    priorSessionVolumesAtSameBar,
    todayBarReturns,
  }
}
