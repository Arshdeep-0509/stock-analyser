/**
 * NOT a port of anything in mastertrust_rsi_ha_screener.py — the Python
 * never requests a daily bar (see DAILY_DATA_DURATION_MINUTES_GUESS,
 * src/types/api.ts). This is the ONE function that turns closed intraday
 * candles into daily session bars, so that swapping to a real day-level
 * endpoint later touches whichever MarketDataSource.fetchDailyBars()
 * implementation is active, not this function's callers.
 */
import type { Candle } from '../types/domain'

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

/** A string key that's equal for two epoch-second timestamps iff they fall on the same IST calendar day. Exported for callers (e.g. src/analytics/strength.ts) that need to test day-equality directly rather than via groupByIstDay(). */
export function istDateKey(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000 + IST_OFFSET_MS)
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
}

/**
 * Splits a candle series into one array per IST calendar day, in order.
 * Candles must already be sorted ascending by time (as every
 * MarketDataSource candle series is). Exported so callers that need
 * per-bar access within a day (e.g. src/analytics/strength.ts's rvol and
 * persistence, which need "today's bars so far" and "each prior day's bars
 * up to the same point") don't have to re-derive this grouping themselves.
 */
export function groupByIstDay(candles: readonly Candle[]): Candle[][] {
  const days: Candle[][] = []
  let currentDay: Candle[] = []
  let currentDayKey: string | null = null

  for (const candle of candles) {
    const dayKey = istDateKey(candle.time)
    if (dayKey !== currentDayKey) {
      if (currentDay.length > 0) days.push(currentDay)
      currentDay = []
      currentDayKey = dayKey
    }
    currentDay.push(candle)
  }
  if (currentDay.length > 0) days.push(currentDay)

  return days
}

/**
 * Aggregates intraday candles into one bar per IST calendar day: open = the
 * day's first candle's open, high/low = max/min across the day, close = the
 * day's last candle's close, volume = summed. A day still in progress (the
 * caller passed only its closed-so-far bars) simply produces a partial bar
 * for "today" as its last element.
 */
export function aggregateToSessions(candles: readonly Candle[]): Candle[] {
  return groupByIstDay(candles).map((day) => {
    const first = day[0]
    const last = day[day.length - 1]
    return {
      time: first.time,
      open: first.open,
      high: Math.max(...day.map((c) => c.high)),
      low: Math.min(...day.map((c) => c.low)),
      close: last.close,
      volume: day.reduce((sum, c) => sum + c.volume, 0),
    }
  })
}
