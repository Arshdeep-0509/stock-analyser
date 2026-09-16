import type { HistoricalCandlesResponse } from '../types/api'
import { parseCandleTimestamp } from '../types/api'
import type { Candle } from '../types/domain'
import { dropFormingCandle } from '../strategy/dropFormingCandle'

/** Mirrors pandas' pd.to_numeric on the five OHLCV columns (lines 218-219 of the Python). */
function toNumeric(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}

/**
 * Parses a raw /api/v1/charts/tdv response into normalised, closed-only
 * candles — this is the one place that exercises both parseCandleTimestamp()
 * (STRATEGY-CONTRACT.md §3.2) and the still-forming-candle drop that
 * fetch_historical_candles() applies before returning. A real
 * MarketDataSource implementation should reuse this same function rather
 * than re-deriving the coercion.
 */
export function parseHistoricalCandlesResponse(
  response: HistoricalCandlesResponse,
  intervalMinutes: number,
  now: number,
): Candle[] {
  const candles: Candle[] = response.data.candles.map(([time, open, high, low, close, volume]) => ({
    time: parseCandleTimestamp(time),
    open: toNumeric(open),
    high: toNumeric(high),
    low: toNumeric(low),
    close: toNumeric(close),
    volume: toNumeric(volume),
  }))

  candles.sort((a, b) => a.time - b.time)

  return dropFormingCandle(candles, intervalMinutes, now)
}
