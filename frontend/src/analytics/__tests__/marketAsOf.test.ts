import { describe, expect, it } from 'vitest'
import { computeIntradayRow, marketAsOf } from '../intraday'
import { DEFAULT_PARAMS } from '../../strategy/constants'
import type { Candle, Instrument } from '../../types/domain'

/**
 * REGRESSION: before the open (and all weekend) /intraday measured "today"
 * as today's calendar date, which has no bars yet, so every move read 0.0%,
 * the day range was blank and the meters sat at "0 up, 0 down, all flat".
 * With no live market, the page must show the last session as it stood at
 * its 15:30 close.
 */

const BAR = 300
const TUE_0915 = 1767674700 // 2026-01-06 09:15 IST
const WED_0915 = 1767761100 // 2026-01-07 09:15 IST
const WED_1525 = WED_0915 + 74 * BAR // the day's last bar
const WED_1530 = WED_1525 + BAR
const WED_1300 = WED_0915 + 45 * 60 + 3 * 3600
const WED_1900 = WED_1530 + 3.5 * 3600
const THU_0800 = WED_0915 + 24 * 3600 - 75 * 60
const SAT_1100 = WED_0915 + 3 * 24 * 3600 + 105 * 60

const instrument: Instrument = { symbol: 'RELIANCE-EQ', token: 'T1', exchange: 'NSE', instrumentName: 'EQ', companyName: 'RELIANCE', cachedClose: 100 }

const bar = (time: number, open: number, close: number): Candle => ({ time, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 })

// Tuesday closes at 100. Wednesday opens at 101 and closes the day at 110.
const candles: Candle[] = [
  bar(TUE_0915, 100, 100),
  bar(TUE_0915 + 74 * BAR, 100, 100),
  bar(WED_0915, 101, 104),
  bar(WED_0915 + BAR, 104, 106),
  bar(WED_1525, 106, 110),
]
const sessions: Candle[] = [
  { time: TUE_0915, open: 100, high: 101, low: 99, close: 100, volume: 2000 },
  { time: WED_0915, open: 101, high: 111, low: 100, close: 110, volume: 3000 },
]

const rowAt = (now: number) => computeIntradayRow({ instrument, candles, sessions, ltp: undefined, now, params: DEFAULT_PARAMS })

describe('marketAsOf', () => {
  it('is now while the market is open, even when the last bar closed a while ago (a quiet or stalled feed)', () => {
    const upTo0920 = candles.filter((c) => c.time <= WED_0915 + BAR)
    expect(marketAsOf(upTo0920, WED_1300)).toBe(WED_1300)
  })

  it.each([
    ['after the close', WED_1900],
    ['before the next open', THU_0800],
    ['on the weekend', SAT_1100],
  ])('%s it is the 15:30 close of the last session', (_label, now) => {
    expect(marketAsOf(candles, now)).toBe(WED_1530)
  })

  it('with no bars at all there is nothing to fall back to', () => {
    expect(marketAsOf([], THU_0800)).toBe(THU_0800)
  })
})

describe('/intraday rows while the market is closed show the last session at its close', () => {
  it.each([
    ['after the close', WED_1900],
    ['before the next open', THU_0800],
    ['on the weekend', SAT_1100],
  ])('%s: Wednesday vs Tuesday, not a blank Thursday', (_label, now) => {
    const row = rowAt(now)
    expect(row.cmp).toBe(110)
    expect(row.prevClose).toBe(100)
    expect(row.changePct).toBeCloseTo(10, 10)
    expect(row.dayOpen).toBe(101)
    expect(row.dayHigh).toBe(111)
    expect(row.dayLow).toBe(100)
  })

  it('pre-open gives exactly the values the page showed at 15:30 the day before', () => {
    const atClose = rowAt(WED_1530)
    const preOpen = rowAt(THU_0800)
    expect({ ...preOpen, lastTickAt: 0 }).toEqual({ ...atClose, lastTickAt: 0 })
  })
})
