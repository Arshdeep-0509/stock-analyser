import type { Candle } from '../types/domain'

/**
 * Transliteration of the trailing-candle drop in fetch_historical_candles()
 * (mastertrust_rsi_ha_screener.py lines 222–226): the API includes the
 * still-forming current candle as the last row, so it's dropped before any
 * indicator is computed on the series. Every caller must run this before
 * computeRsi()/computeHeikinAshi() — see STRATEGY-CONTRACT.md §3.2.
 *
 * `now` is epoch seconds, passed explicitly rather than read from Date.now()
 * so the function stays pure and deterministic.
 */
export function dropFormingCandle(candles: Candle[], intervalMinutes: number, now: number): Candle[] {
  const intervalSeconds = intervalMinutes * 60
  return candles.filter((candle) => candle.time + intervalSeconds <= now)
}
