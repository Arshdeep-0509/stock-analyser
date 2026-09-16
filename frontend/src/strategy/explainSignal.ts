import type { AnalyzedCandle, Candle } from '../types/domain'
import type { StrategyParams } from './constants'
import {
  checkBreakout,
  checkSignal,
  evaluateBreakoutPredicates,
  evaluateSignalPredicates,
  type BreakoutResult,
  type SignalDecision,
} from './signals'

/**
 * One evaluated predicate, as plain numbers/booleans — no formatted text,
 * no currency symbols, no rounding. That's a UI concern; this stays the
 * same regardless of locale or display precision. `pass` is exactly the
 * boolean checkSignal()/checkBreakout() themselves branch on.
 */
export type PredicateCheck =
  | { key: 'notEnoughCandles'; pass: false; have: number; need: number }
  | { key: 'rsiUndefined'; pass: false }
  | { key: 'minPrice'; pass: boolean; close: number; minPrice: number }
  | { key: 'rsiBand'; pass: boolean; band: 'BUY' | 'SELL'; rsi: number; low: number; high: number }
  | { key: 'haColor'; pass: boolean; actual: 'green' | 'red'; expected: 'green' | 'red' }
  | { key: 'haStreak'; pass: boolean; streak: number }
  | { key: 'breakoutNotEnoughCandles'; pass: false; have: number; need: number }
  | { key: 'breakoutMinPrice'; pass: boolean; close: number; minPrice: number }
  | { key: 'breakoutRange'; pass: boolean; direction: 'up' | 'down'; close: number; level: number; lookback: number }

export interface SignalExplanation {
  decision: SignalDecision
  checks: PredicateCheck[]
}

export interface BreakoutExplanation {
  result: BreakoutResult
  checks: PredicateCheck[]
}

/**
 * Renders check_signal()'s own guards as a checklist for one bar. This is a
 * thin wrapper: `decision` comes from calling checkSignal() itself (never
 * re-derived), and every check's `pass` value comes from the SAME
 * SignalPredicates object checkSignal() evaluates internally
 * (evaluateSignalPredicates(), exported from signals.ts) — there is no
 * second copy of the RSI-band / streak / colour comparisons here.
 *
 * The RSI band shown is whichever one the bar's actual HA colour makes
 * relevant (green -> BUY band, red -> SELL band) — checkSignal() can only
 * ever produce a signal from that one path for this bar, so showing the
 * other band would just be restating that colour already disqualifies it.
 */
export function explainSignal(candles: AnalyzedCandle[], params: StrategyParams): SignalExplanation {
  const decision = checkSignal(candles, params)
  const p = evaluateSignalPredicates(candles, params)

  if (!p) {
    return { decision, checks: [{ key: 'notEnoughCandles', pass: false, have: candles.length, need: 3 }] }
  }

  if (!p.rsiDefined) {
    return { decision, checks: [{ key: 'rsiUndefined', pass: false }] }
  }

  const band: 'BUY' | 'SELL' = p.color === 'green' ? 'BUY' : 'SELL'
  const bandPass = band === 'BUY' ? p.buyBandPass : p.sellBandPass
  const bandLow = band === 'BUY' ? params.rsiBuyLow : params.rsiSellLow
  const bandHigh = band === 'BUY' ? params.rsiBuyHigh : params.rsiSellHigh

  const checks: PredicateCheck[] = [
    { key: 'minPrice', pass: p.minPriceOk, close: p.last.close, minPrice: params.minPrice },
    { key: 'rsiBand', pass: bandPass, band, rsi: p.last.rsi, low: bandLow, high: bandHigh },
    { key: 'haColor', pass: true, actual: p.color, expected: p.color },
    { key: 'haStreak', pass: p.is2nd, streak: p.streak },
  ]

  return { decision, checks }
}

/**
 * Same contract as explainSignal(), for check_breakout(). `result` comes
 * from calling checkBreakout() itself; the check's `pass` comes from the
 * same BreakoutPredicates checkBreakout() evaluates internally.
 */
export function explainBreakout(candles: Candle[], params: StrategyParams): BreakoutExplanation {
  const result = checkBreakout(candles, params)
  const p = evaluateBreakoutPredicates(candles, params)

  if (!p) {
    return { result, checks: [{ key: 'breakoutNotEnoughCandles', pass: false, have: candles.length, need: params.breakoutLookback + 1 }] }
  }

  if (!p.minPriceOk) {
    return { result, checks: [{ key: 'breakoutMinPrice', pass: false, close: p.last.close, minPrice: params.minPrice }] }
  }

  // Whichever direction actually fired wins. If neither did, show whichever
  // side the close is nearer to — the more informative near-miss.
  let direction: 'up' | 'down'
  if (p.aboveHigh) {
    direction = 'up'
  } else if (p.belowLow) {
    direction = 'down'
  } else {
    direction = p.rangeHigh - p.last.close <= p.last.close - p.rangeLow ? 'up' : 'down'
  }
  const level = direction === 'up' ? p.rangeHigh : p.rangeLow
  const pass = direction === 'up' ? p.aboveHigh : p.belowLow

  return {
    result,
    checks: [{ key: 'breakoutRange', pass, direction, close: p.last.close, level, lookback: params.breakoutLookback }],
  }
}
