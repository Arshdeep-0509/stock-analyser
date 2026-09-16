import type { Candle, HaCandle } from '../types/domain'

/**
 * Transliteration of compute_rsi() from mastertrust_rsi_ha_screener.py
 * (lines 232–242). This is Wilder's smoothing via
 * `.ewm(alpha=1/period, min_periods=period, adjust=False)` — NOT a
 * SMA-seeded classic Wilder RSI. See STRATEGY-CONTRACT.md.
 *
 * PARITY: the EWM recursion is computed in full for every index from the
 * first non-NaN observation onward, and `min_periods` masking is applied
 * as a separate pass afterwards — mirroring how pandas actually does it
 * internally. Division uses plain JS float division (never guarded), so
 * 0/0 -> NaN and x/0 -> Infinity fall out identically to numpy.
 */
export function computeRsi(candles: Candle[], period = 14): number[] {
  const n = candles.length
  const rsi = new Array<number>(n).fill(NaN)
  if (n === 0) return rsi

  const delta = new Array<number>(n).fill(NaN)
  for (let i = 1; i < n; i++) {
    delta[i] = candles[i].close - candles[i - 1].close
  }

  const gain = new Array<number>(n).fill(NaN)
  const loss = new Array<number>(n).fill(NaN)
  for (let i = 1; i < n; i++) {
    gain[i] = Math.max(delta[i], 0)
    loss[i] = Math.max(-delta[i], 0)
  }

  const alpha = 1 / period
  const avgGain = new Array<number>(n).fill(NaN)
  const avgLoss = new Array<number>(n).fill(NaN)

  if (n > 1) {
    avgGain[1] = gain[1]
    avgLoss[1] = loss[1]
    for (let i = 2; i < n; i++) {
      avgGain[i] = avgGain[i - 1] + alpha * (gain[i] - avgGain[i - 1])
      avgLoss[i] = avgLoss[i - 1] + alpha * (loss[i] - avgLoss[i - 1])
    }
  }

  for (let i = 1; i < n; i++) {
    const rs = avgGain[i] / avgLoss[i]
    rsi[i] = 100 - 100 / (1 + rs)
  }

  // min_periods = period: gain/loss have their first non-NaN observation at
  // index 1, so the i-th index has seen exactly `i` observations. Masked
  // (NaN) until that count reaches `period`, i.e. indices 0..period-1.
  for (let i = 0; i < Math.min(period, n); i++) {
    rsi[i] = NaN
  }

  return rsi
}

/**
 * Transliteration of compute_heikin_ashi() (lines 245–262). Exact formulas,
 * including the recursive haOpen seed and the >= tie-break on haColor (a
 * tie goes to 'green', not 'red').
 */
export function computeHeikinAshi(candles: Candle[]): HaCandle[] {
  const n = candles.length
  if (n === 0) return []

  const haClose = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const c = candles[i]
    haClose[i] = (c.open + c.high + c.low + c.close) / 4
  }

  const haOpen = new Array<number>(n)
  haOpen[0] = (candles[0].open + candles[0].close) / 2
  for (let i = 1; i < n; i++) {
    haOpen[i] = (haOpen[i - 1] + haClose[i - 1]) / 2
  }

  const haCandles: HaCandle[] = []
  for (let i = 0; i < n; i++) {
    const c = candles[i]
    const haHigh = Math.max(c.high, haOpen[i], haClose[i])
    const haLow = Math.min(c.low, haOpen[i], haClose[i])
    const haColor: 'green' | 'red' = haClose[i] >= haOpen[i] ? 'green' : 'red'

    haCandles.push({
      ...c,
      haOpen: haOpen[i],
      haHigh,
      haLow,
      haClose: haClose[i],
      haColor,
    })
  }

  return haCandles
}

export interface HaStreak {
  streak: number
  color: 'green' | 'red'
}

/**
 * Transliteration of ha_streak_length() (lines 265–273): how many
 * consecutive candles ending at `idx` share the same HA color.
 */
export function haStreakLength(candles: HaCandle[], idx: number): HaStreak {
  const color = candles[idx].haColor
  let streak = 1
  let i = idx - 1
  while (i >= 0 && candles[i].haColor === color) {
    streak += 1
    i -= 1
  }
  return { streak, color }
}
