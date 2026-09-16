import type { Candle } from '../types/domain'

/**
 * NOT a port of anything in mastertrust_rsi_ha_screener.py — the Python
 * only ever used 5-minute candles, so there's no original behaviour to
 * stay faithful to here. This is new capability so the "candle interval"
 * parameter is genuinely functional rather than cosmetic: the mock always
 * generates a 5-minute base series, so any coarser interval is built by
 * aggregating that base series, aligned to each trading day's own bars
 * (not to absolute epoch boundaries) so a bucket never spans a session gap.
 */
export const BASE_INTERVAL_MINUTES = 5

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

function istDateKey(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000 + IST_OFFSET_MS)
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`
}

/**
 * Aggregates consecutive base candles into `targetIntervalMinutes` bars:
 * open = first bar's open, high/low = max/min across the bucket, close =
 * last bar's close, volume = summed. `targetIntervalMinutes` must be a
 * whole multiple of the 5-minute base. A trading day whose bar count isn't
 * evenly divisible by the bucket size (e.g. 75 bars / 60min = 12 buckets of
 * 6 with 3 left over) ends that day with one shorter trailing bar — the
 * same way a real 60-minute chart's last bar of the day is often short,
 * since 09:15-15:30 isn't a clean multiple of 60 minutes either.
 */
export function resampleCandles(candles: readonly Candle[], targetIntervalMinutes: number): Candle[] {
  if (targetIntervalMinutes === BASE_INTERVAL_MINUTES) return candles.slice()
  if (targetIntervalMinutes % BASE_INTERVAL_MINUTES !== 0 || targetIntervalMinutes < BASE_INTERVAL_MINUTES) {
    throw new Error(`resampleCandles: target interval ${targetIntervalMinutes} must be a positive multiple of ${BASE_INTERVAL_MINUTES}`)
  }

  const barsPerBucket = targetIntervalMinutes / BASE_INTERVAL_MINUTES

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

  const result: Candle[] = []
  for (const day of days) {
    for (let i = 0; i < day.length; i += barsPerBucket) {
      const bucket = day.slice(i, i + barsPerBucket)
      const first = bucket[0]
      const last = bucket[bucket.length - 1]
      result.push({
        time: first.time,
        open: first.open,
        high: Math.max(...bucket.map((c) => c.high)),
        low: Math.min(...bucket.map((c) => c.low)),
        close: last.close,
        volume: bucket.reduce((sum, c) => sum + c.volume, 0),
      })
    }
  }
  return result
}
