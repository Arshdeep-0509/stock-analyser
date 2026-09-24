import { describe, expect, it } from 'vitest'
import type { Candle } from '../../types/domain'
import { deriveStrengthInputs } from '../strength'

// 09:15 IST bar-opens across four consecutive weekdays, epoch seconds.
const DAY1_OPEN = 1767588300 // 2026-01-05
const DAY2_OPEN = 1767674700 // 2026-01-06
const DAY3_OPEN = 1767761100 // 2026-01-07
const DAY4_OPEN = 1767847500 // 2026-01-08 ("today")
const BAR = 300

function candle(time: number, open: number, close: number, volume: number): Candle {
  return { time, open, high: Math.max(open, close), low: Math.min(open, close), close, volume }
}

describe('deriveStrengthInputs', () => {
  it('splits daily bars into completed closes, excluding today', () => {
    const dailyBars: Candle[] = [
      candle(DAY1_OPEN, 100, 101, 10000),
      candle(DAY2_OPEN, 101, 99, 10000),
      candle(DAY3_OPEN, 99, 103, 10000),
      candle(DAY4_OPEN, 103, 104, 4000), // today's partial bar
    ]

    const inputs = deriveStrengthInputs(dailyBars, [], 104, DAY4_OPEN)

    expect(inputs.dailyCloses).toEqual([101, 99, 103])
    expect(inputs.ltp).toBe(104)
  })

  it("derives today's volume-so-far and bar returns from intraday bars on the same IST day as `now`", () => {
    const intradayBars: Candle[] = [
      candle(DAY1_OPEN, 100, 101, 500),
      candle(DAY4_OPEN, 103, 104, 1000),
      candle(DAY4_OPEN + BAR, 104, 105, 1500),
    ]

    const inputs = deriveStrengthInputs([], intradayBars, 105, DAY4_OPEN + BAR)

    expect(inputs.volumeSoFarToday).toBe(2500)
    expect(inputs.todayBarReturns).toEqual([104 / 103 - 1, 105 / 104 - 1])
  })

  it('sums each prior session\'s volume only up to the same bar-of-day count as today, capped at the last 10 sessions', () => {
    const intradayBars: Candle[] = [
      // Day 1: three bars.
      candle(DAY1_OPEN, 100, 100, 100),
      candle(DAY1_OPEN + BAR, 100, 100, 200),
      candle(DAY1_OPEN + 2 * BAR, 100, 100, 300),
      // Day 2: three bars.
      candle(DAY2_OPEN, 100, 100, 50),
      candle(DAY2_OPEN + BAR, 100, 100, 60),
      candle(DAY2_OPEN + 2 * BAR, 100, 100, 70),
      // Today (day 3): two bars closed so far.
      candle(DAY3_OPEN, 100, 100, 10),
      candle(DAY3_OPEN + BAR, 100, 100, 20),
    ]

    const inputs = deriveStrengthInputs([], intradayBars, 100, DAY3_OPEN + BAR)

    // barsOfDaySoFar = 2 -> only each prior day's FIRST TWO bars count.
    expect(inputs.priorSessionVolumesAtSameBar).toEqual([100 + 200, 50 + 60])
  })

  it('with no prior sessions at all, priorSessionVolumesAtSameBar is empty rather than throwing', () => {
    const intradayBars: Candle[] = [candle(DAY1_OPEN, 100, 101, 500)]
    const inputs = deriveStrengthInputs([], intradayBars, 101, DAY1_OPEN)
    expect(inputs.priorSessionVolumesAtSameBar).toEqual([])
    expect(inputs.volumeSoFarToday).toBe(500)
  })
})
