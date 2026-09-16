import { describe, expect, it } from 'vitest'
import type { Candle, HaCandle } from '../../types/domain'
import { computeHeikinAshi, computeRsi, haStreakLength } from '../indicators'
import { dropFormingCandle } from '../dropFormingCandle'
import fixtureCandles from './fixtures/candles-60.json'

const candles = fixtureCandles as Candle[]

/** Rounds for stable cross-run/cross-language comparison; NaN passes through untouched. */
function round8(value: number): number {
  return Number.isNaN(value) ? value : Number(value.toFixed(8))
}

function makeCandle(overrides: Partial<Candle> = {}): Candle {
  return { time: 0, open: 100, high: 100, low: 100, close: 100, volume: 1000, ...overrides }
}

function makeHaCandle(color: 'green' | 'red'): HaCandle {
  return { ...makeCandle(), haOpen: 0, haHigh: 0, haLow: 0, haClose: 0, haColor: color }
}

describe('computeRsi', () => {
  const rsi = computeRsi(candles)

  it('matches the committed snapshot to 8 decimal places (parity with parity_check.py)', () => {
    expect(rsi.map(round8)).toMatchSnapshot()
  })

  it('is NaN for indices 0..13 and first defined at index 14 (14-period RSI, min_periods=14)', () => {
    for (let i = 0; i < 14; i++) {
      expect(Number.isNaN(rsi[i])).toBe(true)
    }
    expect(Number.isFinite(rsi[14])).toBe(true)
  })

  it('is exactly 100 for a monotonically rising series (avgLoss === 0)', () => {
    const rising: Candle[] = Array.from({ length: 20 }, (_, i) => makeCandle({ time: i, open: 100 + i, high: 100 + i, low: 100 + i, close: 100 + i }))
    const risingRsi = computeRsi(rising)
    expect(risingRsi[19]).toBe(100)
  })

  it('is NaN — not 0, not 50 — for a flat series (avgGain === 0 && avgLoss === 0)', () => {
    const flat: Candle[] = Array.from({ length: 20 }, (_, i) => makeCandle({ time: i }))
    const flatRsi = computeRsi(flat)
    expect(Number.isNaN(flatRsi[19])).toBe(true)
    expect(flatRsi[19]).not.toBe(0)
    expect(flatRsi[19]).not.toBe(50)
  })
})

describe('computeHeikinAshi', () => {
  const haCandles = computeHeikinAshi(candles)

  it('matches the committed snapshot to 8 decimal places (parity with parity_check.py)', () => {
    expect(haCandles.map((c) => round8(c.haOpen))).toMatchSnapshot('haOpen')
    expect(haCandles.map((c) => round8(c.haClose))).toMatchSnapshot('haClose')
    expect(haCandles.map((c) => c.haColor)).toMatchSnapshot('haColor')
  })

  it('marks a tie (haClose === haOpen exactly) as green', () => {
    const [ha] = computeHeikinAshi([makeCandle()])
    expect(ha).toBeDefined()
    expect(ha?.haClose).toBe(ha?.haOpen)
    expect(ha?.haColor).toBe('green')
  })
})

describe('haStreakLength', () => {
  it('is 1 for a single candle', () => {
    expect(haStreakLength([makeHaCandle('green')], 0)).toEqual({ streak: 1, color: 'green' })
  })

  it('is 3 for three consecutive greens', () => {
    const streakCandles = [makeHaCandle('green'), makeHaCandle('green'), makeHaCandle('green')]
    expect(haStreakLength(streakCandles, 2)).toEqual({ streak: 3, color: 'green' })
  })

  it('resets to 1 right after a colour flip', () => {
    const flipCandles = [makeHaCandle('green'), makeHaCandle('green'), makeHaCandle('red')]
    expect(haStreakLength(flipCandles, 2)).toEqual({ streak: 1, color: 'red' })
  })
})

describe('dropFormingCandle', () => {
  const intervalMinutes = 5
  const bars: Candle[] = [makeCandle({ time: 0 }), makeCandle({ time: 300 }), makeCandle({ time: 600 })]

  it('removes exactly the last candle when now is mid-bar', () => {
    // last bar spans [600, 900) - 750 is mid-bar, so it is still forming.
    const result = dropFormingCandle(bars, intervalMinutes, 750)
    expect(result.map((c) => c.time)).toEqual([0, 300])
  })

  it('removes nothing when now is exactly on a bar boundary', () => {
    // last bar closes exactly at 900 - candle_end <= now keeps it.
    const result = dropFormingCandle(bars, intervalMinutes, 900)
    expect(result.map((c) => c.time)).toEqual([0, 300, 600])
  })
})
