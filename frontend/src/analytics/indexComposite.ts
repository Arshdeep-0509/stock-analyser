/**
 * NOT a port of anything in mastertrust_rsi_ha_screener.py — the Python
 * never computes an index level at all. This module is what makes NIFTY /
 * BANK NIFTY / India VIX genuinely derived from the same generated
 * constituent candles the screener already shows, rather than a second,
 * disconnected random walk: an index quote's sign must agree with the
 * majority of its constituents, or the demo is dead on arrival.
 *
 * Deliberately takes no dependency on src/data/mock/ — every function here
 * is a pure transform over Candle[] (plus an injected RNG function for the
 * one place randomness is needed), so MockMarketDataSource depends on this
 * module, never the other way around.
 */
import type { Candle } from '../types/domain'
import { aggregateToSessions } from './daily'
import type { IndexQuote, IndexQuoteKey } from '../data/MarketDataSource'

/** A structural PRNG — deliberately not importing data/mock/rng's Rng type; any () => number in [0,1) satisfies this. */
export type RandomSource = () => number

export interface WeightedConstituent {
  /** cachedClose, used as a capitalisation stand-in — see docs/SECTOR-DATA.md's sibling caveat in indices.ts. */
  weight: number
  /** Closed candles, aligned to the same bar timestamps as every other constituent (same CandleEngine session grid). */
  series: readonly Candle[]
}

/**
 * Capitalisation-weighted (by `weight`, a cachedClose stand-in) mean of
 * every constituent's OHLCV at each shared bar index. Assumes all series
 * share identical bar timestamps in order (true for anything generated off
 * the same CandleEngine session grid); uses the shortest series' length as
 * a defensive bound rather than assuming they're exactly equal.
 */
export function computeCapWeightedIndexSeries(constituents: readonly WeightedConstituent[]): Candle[] {
  const withWeight = constituents.filter((c) => c.weight > 0 && c.series.length > 0)
  if (withWeight.length === 0) return []

  const totalWeight = withWeight.reduce((sum, c) => sum + c.weight, 0)
  const length = Math.min(...withWeight.map((c) => c.series.length))

  const result: Candle[] = []
  for (let i = 0; i < length; i++) {
    let open = 0
    let high = 0
    let low = 0
    let close = 0
    let volume = 0

    for (const constituent of withWeight) {
      const bar = constituent.series[i]
      const w = constituent.weight / totalWeight
      open += bar.open * w
      high += bar.high * w
      low += bar.low * w
      close += bar.close * w
      volume += bar.volume
    }

    result.push({ time: withWeight[0].series[i].time, open, high, low, close, volume })
  }

  return result
}

/** The most recent closed level, and the prior trading session's close (for change%). */
export function lastAndPrevClose(series: readonly Candle[]): { last: number; prevClose: number } {
  if (series.length === 0) return { last: NaN, prevClose: NaN }

  const sessions = aggregateToSessions(series)
  const last = series[series.length - 1].close
  const prevSession = sessions.length >= 2 ? sessions[sessions.length - 2] : sessions[0]
  return { last, prevClose: prevSession.close }
}

export interface VixParams {
  /** The level VIX reverts toward. */
  baseline: number
  /** 0..1ish pull-back-to-baseline strength per bar. */
  reversionStrength: number
  /** Stdev of per-bar noise, in VIX points. */
  volPerBar: number
  /** How strongly a NIFTY return moves VIX in the opposite direction. */
  antiCorrelation: number
}

/**
 * A mean-reverting series anti-correlated with NIFTY's own per-bar return —
 * generated bar-by-bar over NIFTY's own timestamps so it is a genuine
 * series (not a single-shot formula), and so a rising NIFTY structurally
 * pulls VIX down and vice versa, the same way the real India VIX behaves
 * relative to Nifty. Represented as a flat OHLC (open=high=low=close) since
 * VIX has no independent intrabar range here — only its level matters.
 */
export function generateIndiaVixSeries(niftySeries: readonly Candle[], params: VixParams, rng: RandomSource): Candle[] {
  const result: Candle[] = []
  let level = params.baseline
  let prevNiftyClose = niftySeries[0]?.close ?? params.baseline

  for (const bar of niftySeries) {
    const niftyReturn = prevNiftyClose > 0 ? (bar.close - prevNiftyClose) / prevNiftyClose : 0
    const reversion = params.reversionStrength * (params.baseline - level)
    // Box-Muller standard normal, inline so this module has no RNG-library dependency of its own.
    const u1 = Math.max(rng(), Number.EPSILON)
    const u2 = rng()
    const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    const shock = gaussian * params.volPerBar
    const antiMove = -params.antiCorrelation * niftyReturn * 100

    level = Math.max(5, level + reversion + shock + antiMove)
    result.push({ time: bar.time, open: level, high: level, low: level, close: level, volume: 0 })
    prevNiftyClose = bar.close
  }

  return result
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Assembles the IndexQuote shape (last/prevClose/changePct, rounded) from a computed series. */
export function buildIndexQuote(key: IndexQuoteKey, label: string, series: readonly Candle[], time: number): IndexQuote {
  const { last, prevClose } = lastAndPrevClose(series)
  const changePct = prevClose !== 0 ? ((last - prevClose) / prevClose) * 100 : 0
  return { key, label, last: round2(last), prevClose: round2(prevClose), changePct: round2(changePct), time }
}
