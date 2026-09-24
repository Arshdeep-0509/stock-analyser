import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../../../strategy/constants'
import { loadFnoFuturesUniverse } from '../../../strategy/universe'
import type { ScripRow } from '../../../types/api'
import { buildSessionGrid, recentTradingDays } from '../candleEngine'
import { formatExpiry, lastThursday } from '../scripMaster'

// Spec name mapping: sessionBars -> buildSessionGrid (one trading day =
// buildSessionGrid(now, 1)); fmtExpiry -> formatExpiry; parseExpiry is
// private to the parity-locked src/strategy/universe.ts, so its half of the
// round-trip is exercised through loadFnoFuturesUniverse.

const IST_OFFSET = 330 * 60
/** Epoch seconds for an IST wall-clock time. */
const ist = (y: number, m1: number, d: number, h: number, min: number): number => Date.UTC(y, m1 - 1, d, h, min) / 1000 - IST_OFFSET
const istHm = (epoch: number): string => new Date((epoch + IST_OFFSET) * 1000).toISOString().slice(11, 16)
const istYmd = (epoch: number): string => new Date((epoch + IST_OFFSET) * 1000).toISOString().slice(0, 10)

describe('buildSessionGrid (sessionBars)', () => {
  it('one trading day is exactly 75 five-minute bars, first at 09:15, last at 15:25 IST', () => {
    const bars = buildSessionGrid(ist(2026, 1, 5, 13, 0), 1)
    expect(bars).toHaveLength(75)
    expect(istHm(bars[0])).toBe('09:15')
    expect(istHm(bars[74])).toBe('15:25')
    for (let i = 1; i < bars.length; i++) expect(bars[i] - bars[i - 1]).toBe(300)
  })

  it('five days is 375 bars, oldest first, each day starting at 09:15', () => {
    const bars = buildSessionGrid(ist(2026, 1, 9, 13, 0), 5)
    expect(bars).toHaveLength(375)
    for (let d = 0; d < 5; d++) expect(istHm(bars[d * 75])).toBe('09:15')
    expect([...bars].sort((a, b) => a - b)).toEqual(bars)
  })
})

describe('buildSessionGrid before the open', () => {
  // REGRESSION: pre-open, the grid used to include today's 75 bars, all still in
  // the future, so the history held 4 completed sessions and Strength (which needs
  // 5) went blank on /intraday until the market opened.
  it('at 08:00 on a Monday it is the five sessions up to Friday, not four plus a day that has not started', () => {
    const bars = buildSessionGrid(ist(2026, 1, 12, 8, 0), 5)
    expect(bars).toHaveLength(375)
    expect(bars[bars.length - 1]).toBe(ist(2026, 1, 9, 15, 25))
    expect(bars[0]).toBe(ist(2026, 1, 5, 9, 15))
  })

  it('from 09:15 today is one of them', () => {
    const bars = buildSessionGrid(ist(2026, 1, 12, 9, 15), 5)
    expect(bars[bars.length - 1]).toBe(ist(2026, 1, 12, 15, 25))
  })
})

describe('recentTradingDays', () => {
  it('skips weekends: from a Monday, the previous five trading days span the prior week', () => {
    const days = recentTradingDays(ist(2026, 1, 12, 10, 0), 5) // Monday 12 Jan 2026
    expect(days.map((d) => `${d.year}-${d.month0 + 1}-${d.day}`)).toEqual(['2026-1-6', '2026-1-7', '2026-1-8', '2026-1-9', '2026-1-12'])
  })

  it('asked on a Saturday, the most recent trading day is the Friday before', () => {
    const [latest] = recentTradingDays(ist(2026, 1, 10, 12, 0), 1) // Saturday 10 Jan
    expect(latest).toEqual({ year: 2026, month0: 0, day: 9 })
  })

  it('uses the IST calendar date, not the UTC one (00:30 IST Monday is still Sunday in UTC)', () => {
    const [latest] = recentTradingDays(ist(2026, 1, 12, 0, 30), 1)
    expect(latest).toEqual({ year: 2026, month0: 0, day: 12 })
  })
})

describe('lastThursday', () => {
  it('a month whose last day IS a Thursday returns that day (April 2026 ends Thu 30th)', () => {
    expect(lastThursday(2026, 3)).toEqual({ year: 2026, month0: 3, day: 30 })
  })

  it('a month that ends on a Friday returns the day before (July 2026 ends Fri 31st)', () => {
    expect(lastThursday(2026, 6)).toEqual({ year: 2026, month0: 6, day: 30 })
  })

  it('always lands on a Thursday within the last week of the month', () => {
    for (let month0 = 0; month0 < 12; month0++) {
      const { day } = lastThursday(2026, month0)
      expect(new Date(Date.UTC(2026, month0, day)).getUTCDay()).toBe(4)
      expect(new Date(Date.UTC(2026, month0 + 1, 0)).getUTCDate() - day).toBeLessThan(7)
    }
  })
})

describe('formatExpiry / parseExpiry round-trip (through loadFnoFuturesUniverse)', () => {
  it('formats DD-Mon-YYYY with a zero-padded day', () => {
    expect(formatExpiry(2026, 0, 5)).toBe('05-Jan-2026')
    expect(formatExpiry(2026, 11, 31)).toBe('31-Dec-2026')
  })

  function futuresRow(expiry: string): ScripRow {
    return {
      exchange: 'NFO',
      instrument_name: 'FUTSTK',
      trading_symbol: 'TESTFUT',
      exchange_token: '777',
      close_price: '5000',
      expiry,
      company_name: 'TEST',
      strike: '',
      option_type: '',
    }
  }

  it('every formatted expiry parses: the contract is accepted on its expiry date and rejected the day after', () => {
    for (const [y, m0] of [[2026, 0], [2026, 3], [2026, 6], [2026, 11]] as const) {
      const { day } = lastThursday(y, m0)
      const row = futuresRow(formatExpiry(y, m0, day))
      const expiryMidnightUtc = Date.UTC(y, m0, day) / 1000
      // The loader compares against the start of "today" (the Python's Timestamp.now().normalize()).
      expect(loadFnoFuturesUniverse([row], DEFAULT_PARAMS, expiryMidnightUtc)).toHaveLength(1)
      expect(loadFnoFuturesUniverse([row], DEFAULT_PARAMS, expiryMidnightUtc + 86_400)).toHaveLength(0)
      expect(istYmd(expiryMidnightUtc + IST_OFFSET)).toBe(`${y}-${String(m0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    }
  })

  it('an unparseable expiry is dropped, never treated as "not expired"', () => {
    expect(loadFnoFuturesUniverse([futuresRow('2026-01-29')], DEFAULT_PARAMS, 0)).toHaveLength(0)
    expect(loadFnoFuturesUniverse([futuresRow('29-Foo-2026')], DEFAULT_PARAMS, 0)).toHaveLength(0)
  })
})
