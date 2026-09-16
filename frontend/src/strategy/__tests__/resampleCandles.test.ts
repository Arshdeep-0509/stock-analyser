import { describe, expect, it } from 'vitest'
import type { Candle } from '../../types/domain'
import { resampleCandles } from '../resampleCandles'

// 6 consecutive 5-minute bars on the same IST trading day, starting 09:15 IST (time 1767584700).
function makeBars(n: number, startTime = 1767584700): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: startTime + i * 300,
    open: 100 + i,
    high: 105 + i,
    low: 95 + i,
    close: 102 + i,
    volume: 1000 + i * 10,
  }))
}

describe('resampleCandles', () => {
  it('returns the input unchanged when the target equals the base interval', () => {
    const bars = makeBars(6)
    expect(resampleCandles(bars, 5)).toEqual(bars)
  })

  it('aggregates open/high/low/close/volume correctly across a clean bucket', () => {
    const bars = makeBars(6) // -> two 15-minute buckets of 3 bars each
    const result = resampleCandles(bars, 15)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      time: bars[0].time,
      open: bars[0].open,
      high: Math.max(bars[0].high, bars[1].high, bars[2].high),
      low: Math.min(bars[0].low, bars[1].low, bars[2].low),
      close: bars[2].close,
      volume: bars[0].volume + bars[1].volume + bars[2].volume,
    })
    expect(result[1].time).toBe(bars[3].time)
    expect(result[1].close).toBe(bars[5].close)
  })

  it('leaves a shorter trailing bucket when the day does not divide evenly', () => {
    const bars = makeBars(5) // 5 bars into 15-min (3-bar) buckets -> [3, 2]
    const result = resampleCandles(bars, 15)

    expect(result).toHaveLength(2)
    expect(result[1].close).toBe(bars[4].close) // trailing bucket still closes on the last real bar
  })

  it('never merges bars across a trading-day boundary', () => {
    const day1 = makeBars(3, 1767584700) // day 1, 09:15 IST start
    const day2 = makeBars(2, 1767671100) // next calendar day, 09:15 IST start
    const result = resampleCandles([...day1, ...day2], 15)

    // 3 bars (one full bucket) + 2 bars (one short bucket) — never combined into one 5-bar bucket.
    expect(result).toHaveLength(2)
    expect(result[0].close).toBe(day1[2].close)
    expect(result[1].time).toBe(day2[0].time)
  })

  it('rejects a target interval that is not a clean multiple of the 5-minute base', () => {
    expect(() => resampleCandles(makeBars(3), 7)).toThrow()
  })
})
