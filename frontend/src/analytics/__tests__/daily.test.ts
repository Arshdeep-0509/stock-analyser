import { describe, expect, it } from 'vitest'
import type { Candle } from '../../types/domain'
import { aggregateToSessions, groupByIstDay, istDateKey } from '../daily'

// 09:15 IST on 2026-01-05 and 2026-01-06, epoch seconds.
const DAY1_OPEN = 1767588300
const DAY2_OPEN = 1767674700

function candle(time: number, open: number, high: number, low: number, close: number, volume: number): Candle {
  return { time, open, high, low, close, volume }
}

describe('aggregateToSessions', () => {
  it('collapses same-IST-day candles into one bar with OHLC/volume aggregation rules', () => {
    const candles: Candle[] = [
      candle(DAY1_OPEN, 100, 105, 99, 102, 1000),
      candle(DAY1_OPEN + 300, 102, 110, 101, 108, 1500),
      candle(DAY1_OPEN + 600, 108, 109, 95, 97, 2000),
    ]

    const sessions = aggregateToSessions(candles)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toEqual({ time: DAY1_OPEN, open: 100, high: 110, low: 95, close: 97, volume: 4500 })
  })

  it('produces one bar per distinct IST day, in order', () => {
    const candles: Candle[] = [
      candle(DAY1_OPEN, 100, 101, 99, 100, 1000),
      candle(DAY1_OPEN + 300, 100, 103, 99, 101, 1000),
      candle(DAY2_OPEN, 101, 106, 100, 105, 1200),
    ]

    const sessions = aggregateToSessions(candles)

    expect(sessions).toHaveLength(2)
    expect(sessions[0].time).toBe(DAY1_OPEN)
    expect(sessions[0].close).toBe(101)
    expect(sessions[1].time).toBe(DAY2_OPEN)
    expect(sessions[1].close).toBe(105)
  })

  it('returns an empty array for an empty input', () => {
    expect(aggregateToSessions([])).toEqual([])
  })

  it("a partial day-in-progress produces a partial bar as its last element", () => {
    const candles: Candle[] = [candle(DAY2_OPEN, 200, 202, 199, 201, 500)]
    const sessions = aggregateToSessions(candles)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toEqual({ time: DAY2_OPEN, open: 200, high: 202, low: 199, close: 201, volume: 500 })
  })
})

describe('groupByIstDay', () => {
  it('splits into one array per IST day, preserving bar order within each', () => {
    const candles: Candle[] = [
      candle(DAY1_OPEN, 100, 101, 99, 100, 1000),
      candle(DAY1_OPEN + 300, 100, 103, 99, 101, 1000),
      candle(DAY2_OPEN, 101, 106, 100, 105, 1200),
    ]
    const days = groupByIstDay(candles)
    expect(days).toHaveLength(2)
    expect(days[0].map((c) => c.time)).toEqual([DAY1_OPEN, DAY1_OPEN + 300])
    expect(days[1].map((c) => c.time)).toEqual([DAY2_OPEN])
  })
})

describe('istDateKey', () => {
  it('is equal for two timestamps on the same IST day and different across a day boundary', () => {
    expect(istDateKey(DAY1_OPEN)).toBe(istDateKey(DAY1_OPEN + 300))
    expect(istDateKey(DAY1_OPEN)).not.toBe(istDateKey(DAY2_OPEN))
  })
})
