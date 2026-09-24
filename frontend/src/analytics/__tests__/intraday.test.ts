import { describe, expect, it } from 'vitest'
import { computeIntradayRow } from '../intraday'
import { computeStrengthBreakdown, deriveStrengthInputs } from '../strength'
import { computeHeikinAshi } from '../../strategy/indicators'
import { checkBreakout } from '../../strategy/signals'
import { DEFAULT_PARAMS } from '../../strategy/constants'
import type { Candle, Instrument } from '../../types/domain'

// Four consecutive weekdays' 09:15 IST bar-opens, epoch seconds (no weekend in between).
const DAY1_OPEN = 1767588300 // 2026-01-05 (Mon)
const DAY2_OPEN = 1767674700 // 2026-01-06 (Tue)
const DAY3_OPEN = 1767761100 // 2026-01-07 (Wed)
const DAY4_OPEN = 1767847500 // 2026-01-08 (Thu) — "today"
const BAR = 300

function candle(time: number, open: number, high: number, low: number, close: number, volume: number): Candle {
  return { time, open, high, low, close, volume }
}

function dailyBar(time: number, close: number): Candle {
  return { time, open: close, high: close, low: close, close, volume: 0 }
}

const instrument: Instrument = {
  symbol: 'RELIANCE-EQ',
  token: 'T1',
  exchange: 'NSE',
  instrumentName: 'EQ',
  companyName: 'RELIANCE',
  cachedClose: 100,
}

describe('computeIntradayRow', () => {
  it('produces known values for every simple field from a hand-computed fixture', () => {
    const sessions: Candle[] = [
      dailyBar(DAY1_OPEN, 100),
      dailyBar(DAY2_OPEN, 105),
      dailyBar(DAY3_OPEN, 98), // most recent COMPLETED session -> prevClose
      dailyBar(DAY4_OPEN, 999), // today's partial bar — must be excluded, not used anywhere
    ]

    const candles: Candle[] = [
      candle(DAY1_OPEN, 100, 101, 99, 100, 500),
      candle(DAY1_OPEN + BAR, 100, 101, 99, 100, 500),
      candle(DAY2_OPEN, 100, 101, 99, 100, 800),
      candle(DAY2_OPEN + BAR, 100, 101, 99, 100, 800),
      candle(DAY3_OPEN, 100, 101, 99, 100, 1200),
      candle(DAY3_OPEN + BAR, 100, 101, 99, 100, 1200),
      // Today: exactly 2 closed bars, both green, hand-computable OHLCV.
      candle(DAY4_OPEN, 100, 104, 99, 102, 1000),
      candle(DAY4_OPEN + BAR, 102, 106, 101, 104, 2000),
    ]

    const now = DAY4_OPEN + BAR + 60 // a little after the 2nd bar closes, still today

    const row = computeIntradayRow({
      instrument,
      candles,
      sessions,
      ltp: undefined, // forces cmp to fall back to the last closed candle's close
      now,
      params: DEFAULT_PARAMS,
    })

    expect(row.symbol).toBe('RELIANCE-EQ')
    expect(row.baseSymbol).toBe('RELIANCE')
    expect(row.token).toBe('T1')
    expect(row.exchange).toBe('NSE')
    expect(row.sector).toBe('Refineries')
    expect(row.indices).toEqual(['NIFTY_50'])

    // cmp falls back to the last closed 5-min candle's close (104), not any daily bar.
    expect(row.cmp).toBe(104)
    expect(row.lastTickAt).toBe(DAY4_OPEN + BAR)

    expect(row.prevClose).toBe(98)
    expect(row.changePct).toBeCloseTo((104 / 98 - 1) * 100, 10)
    // 3 sessions back from today = day1's close (100); exactly 3 completed sessions is enough.
    expect(row.change3dPct).toBeCloseTo((104 / 100 - 1) * 100, 10)

    expect(row.dayOpen).toBe(100)
    expect(row.dayHigh).toBe(106)
    expect(row.dayLow).toBe(99)
    // Σ(typicalPrice×volume)/Σvolume = (305/3*1000 + 311/3*2000) / 3000 = 309000/3000 = 103.
    expect(row.vwap).toBeCloseTo(103, 10)

    expect(row.starred).toBe(false)
    expect(row.cachedClose).toBe(100) // carried straight from Instrument.cachedClose
  })

  it('reuses strength.ts exactly — the row\'s strength/zMove/rvol/persistence match calling it directly', () => {
    const sessions: Candle[] = [dailyBar(DAY1_OPEN, 100), dailyBar(DAY2_OPEN, 105), dailyBar(DAY3_OPEN, 98)]
    const candles: Candle[] = [
      candle(DAY1_OPEN, 100, 101, 99, 100, 500),
      candle(DAY2_OPEN, 100, 101, 99, 100, 800),
      candle(DAY3_OPEN, 100, 101, 99, 100, 1200),
      candle(DAY4_OPEN, 100, 104, 99, 102, 1000),
      candle(DAY4_OPEN + BAR, 102, 106, 101, 104, 2000),
    ]
    const now = DAY4_OPEN + BAR + 60

    const row = computeIntradayRow({ instrument, candles, sessions, ltp: undefined, now, params: DEFAULT_PARAMS })

    const expectedInputs = deriveStrengthInputs(sessions, candles, row.cmp, now)
    const expectedBreakdown = computeStrengthBreakdown(expectedInputs)

    expect(row.strength).toBe(expectedBreakdown.strength)
    expect(row.zMove).toBe(expectedBreakdown.zMove)
    expect(row.rvol).toBe(expectedBreakdown.rvol)
    expect(row.persistence).toBe(expectedBreakdown.persistence)
  })

  it('breakout agrees with a direct call to checkBreakout on the same candles', () => {
    // 24 flat bars (at/above DEFAULT_PARAMS.minPrice), then one that closes
    // far above the prior 20's range -> BREAKOUT-UP.
    const candles: Candle[] = Array.from({ length: 24 }, (_, i) => candle(DAY1_OPEN + i * BAR, 2500, 2510, 2490, 2500, 1000))
    candles.push(candle(DAY1_OPEN + 24 * BAR, 2500, 3000, 2500, 3000, 1000))

    const now = candles[candles.length - 1].time

    const row = computeIntradayRow({ instrument, candles, sessions: [], ltp: undefined, now, params: DEFAULT_PARAMS })
    const direct = checkBreakout(candles, DEFAULT_PARAMS)

    expect(direct.signal).toBe('BREAKOUT-UP')
    expect(row.breakout).toBe(direct.signal)
    expect(row.breakoutLevel).toBe(direct.level)
  })

  it('intradayDir matches the last closed Heikin-Ashi candle\'s colour', () => {
    const candles: Candle[] = [
      candle(DAY1_OPEN, 100, 101, 99, 100, 1000),
      candle(DAY1_OPEN + BAR, 100, 110, 99, 108, 1000), // a strong green close
    ]
    const now = candles[candles.length - 1].time

    const row = computeIntradayRow({ instrument, candles, sessions: [], ltp: undefined, now, params: DEFAULT_PARAMS })
    const ha = computeHeikinAshi(candles)
    const expectedDir = ha[ha.length - 1].haColor === 'green' ? 'up' : 'down'

    expect(row.intradayDir).toBe(expectedDir)
  })

  it('propagates NaN rather than 0 when there is not enough session history and no bars yet today', () => {
    const sessions: Candle[] = [dailyBar(DAY1_OPEN, 100)] // only 1 completed session
    const candles: Candle[] = [candle(DAY1_OPEN, 100, 101, 99, 100, 500)] // nothing for "today" (DAY4)
    const now = DAY4_OPEN

    const row = computeIntradayRow({ instrument, candles, sessions, ltp: undefined, now, params: DEFAULT_PARAMS })

    expect(Number.isNaN(row.prevClose)).toBe(false) // 1 completed session IS enough for prevClose/changePct
    expect(row.prevClose).toBe(100)
    expect(Number.isNaN(row.change3dPct)).toBe(true) // but not enough for "3 sessions back"

    expect(Number.isNaN(row.dayOpen)).toBe(true)
    expect(Number.isNaN(row.dayHigh)).toBe(true)
    expect(Number.isNaN(row.dayLow)).toBe(true)
    expect(Number.isNaN(row.vwap)).toBe(true)

    // Strength itself needs 4 completed sessions — only 1 is available here.
    expect(Number.isNaN(row.strength)).toBe(true)
    expect(Number.isNaN(row.zMove)).toBe(true)
    expect(Number.isNaN(row.rvol)).toBe(true)
    expect(Number.isNaN(row.persistence)).toBe(true)

    // cmp/lastTickAt still fall back to the last (non-today) closed candle — that history isn't "today's", but it exists.
    expect(row.cmp).toBe(100)
    expect(row.lastTickAt).toBe(DAY1_OPEN)
    expect(row.breakout).toBeNull()
    expect(row.breakoutLevel).toBeNull()
  })

  it('with no candles and no live ltp, cmp/lastTickAt are NaN rather than throwing', () => {
    const row = computeIntradayRow({ instrument, candles: [], sessions: [], ltp: undefined, now: DAY1_OPEN, params: DEFAULT_PARAMS })
    expect(Number.isNaN(row.cmp)).toBe(true)
    expect(Number.isNaN(row.lastTickAt)).toBe(true)
    expect(row.intradayDir).toBe('up')
    expect(row.breakout).toBeNull()
  })

  it('cmp prefers a live ltp over the last closed candle, and lastTickAt becomes `now`', () => {
    const candles: Candle[] = [candle(DAY1_OPEN, 100, 101, 99, 100, 500)]
    const now = DAY1_OPEN + 600

    const row = computeIntradayRow({ instrument, candles, sessions: [], ltp: 123.45, now, params: DEFAULT_PARAMS })

    expect(row.cmp).toBe(123.45)
    expect(row.lastTickAt).toBe(now)
  })

  it('honours an explicit `starred` input', () => {
    const row = computeIntradayRow({
      instrument,
      candles: [candle(DAY1_OPEN, 100, 101, 99, 100, 500)],
      sessions: [],
      ltp: undefined,
      now: DAY1_OPEN,
      params: DEFAULT_PARAMS,
      starred: true,
    })
    expect(row.starred).toBe(true)
  })
})
