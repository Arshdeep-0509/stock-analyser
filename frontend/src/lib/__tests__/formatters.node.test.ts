import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatINR, formatISTDate, formatISTTime, formatNumber } from '../formatters'
import { expiryFilterToday, getMarketSession } from '../marketSession'

/**
 * Every IST formatter and the session classifier must give the same answer
 * whatever timezone the HOST runs in — a CI box in UTC, a laptop in New York,
 * one in Tokyo. Node re-reads process.env.TZ at runtime, so each block below
 * really does run under a different host zone: a formatter that used local
 * getHours()/getDate() instead of an explicit Asia/Kolkata zone would fail
 * in at least one of them.
 */

// 2026-01-05 is a Monday. IST = UTC+05:30.
const MON = (h: number, m: number): Date => new Date(Date.UTC(2026, 0, 5, h, m) - 330 * 60 * 1000)
const SAT_NOON_IST = new Date(Date.UTC(2026, 0, 10, 12, 0) - 330 * 60 * 1000)
const SUN_NOON_IST = new Date(Date.UTC(2026, 0, 11, 12, 0) - 330 * 60 * 1000)

describe.each(['UTC', 'America/New_York', 'Asia/Tokyo'])('host timezone %s', (tz) => {
  let previous: string | undefined
  beforeAll(() => {
    previous = process.env.TZ
    process.env.TZ = tz
  })
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  })

  it('really is running under that host zone (guards against a vacuous parameterisation)', () => {
    // 13:00 IST on the reference Monday, as the HOST's local hour.
    const localHour = MON(13, 0).getHours()
    expect(localHour).toBe({ UTC: 7, 'America/New_York': 2, 'Asia/Tokyo': 16 }[tz])
  })

  it('formatISTTime renders the IST wall clock, 24-hour, with seconds', () => {
    expect(formatISTTime(MON(9, 15))).toBe('09:15:00')
    expect(formatISTTime(MON(15, 30))).toBe('15:30:00')
    expect(formatISTTime(MON(0, 5))).toBe('00:05:00')
  })

  it('formatISTDate renders the IST calendar date, even when it is a different day in UTC', () => {
    // 00:30 IST on Mon 5 Jan is still Sun 4 Jan in UTC and in New York.
    expect(formatISTDate(MON(0, 30))).toBe('05 Jan 2026')
  })

  it.each([
    [MON(9, 14), 'PRE-OPEN'],
    [MON(9, 15), 'OPEN'],
    [MON(15, 30), 'OPEN'],
    [MON(15, 31), 'CLOSED'],
    [SAT_NOON_IST, 'CLOSED'],
    [SUN_NOON_IST, 'CLOSED'],
  ] as const)('getMarketSession(%s) is %s', (at, expected) => {
    expect(getMarketSession(at)).toBe(expected)
  })
})

describe('formatNumber / formatINR — Indian digit grouping', () => {
  it('groups in lakhs and crores, not thousands', () => {
    expect(formatNumber(1234567.89)).toBe('12,34,567.89')
    expect(formatNumber(123456789)).toBe('12,34,56,789.00')
  })

  it('always shows two decimals by default', () => {
    expect(formatNumber(999.5)).toBe('999.50')
    expect(formatNumber(0)).toBe('0.00')
  })

  it('handles negatives', () => {
    expect(formatNumber(-1234.5)).toBe('-1,234.50')
  })

  it('formatINR prefixes the rupee sign on the same grouping', () => {
    expect(formatINR(1234567.89)).toBe('₹12,34,567.89')
    expect(formatINR(-50)).toBe('-₹50.00')
  })

  it('a non-2 decimal count uses toFixed — NO grouping (documented current behaviour)', () => {
    expect(formatNumber(1234567.891, 1)).toBe('1234567.9')
    expect(formatNumber(1.25, 0)).toBe('1')
  })

  it('non-finite values are NOT mapped to "—" here — callers must guard (they do: see the NaN checks at every call site)', () => {
    expect(formatNumber(NaN)).toBe('NaN')
    expect(formatNumber(Infinity)).toBe('∞')
  })
})

describe('expiryFilterToday — the Python Timestamp.now().normalize() for the expiry filter', () => {
  const utcMidnight = (y: number, m0: number, d: number): number => Date.UTC(y, m0, d) / 1000
  const istEpoch = (y: number, m0: number, d: number, h: number, min: number): number => Date.UTC(y, m0, d, h, min) / 1000 - 330 * 60

  it('is the same value all day long on one IST date — 00:00, 05:29, 05:30 (UTC midnight), 13:00 and 23:59 IST', () => {
    const expected = utcMidnight(2026, 0, 29)
    for (const [h, m] of [[0, 0], [5, 29], [5, 30], [13, 0], [23, 59]]) expect(expiryFilterToday(istEpoch(2026, 0, 29, h, m))).toBe(expected)
  })

  it('rolls over at IST midnight, not UTC midnight', () => {
    expect(expiryFilterToday(istEpoch(2026, 0, 30, 0, 0))).toBe(utcMidnight(2026, 0, 30))
    expect(expiryFilterToday(istEpoch(2026, 0, 29, 23, 59))).toBe(utcMidnight(2026, 0, 29))
  })

  it('never exceeds an expiry that falls on the same IST date (the defect this guards: raw clock time did, from 05:30 IST)', () => {
    const expiryDateEpoch = utcMidnight(2026, 0, 29)
    expect(expiryFilterToday(istEpoch(2026, 0, 29, 15, 30))).toBeLessThanOrEqual(expiryDateEpoch)
    expect(istEpoch(2026, 0, 29, 15, 30)).toBeGreaterThan(expiryDateEpoch)
  })
})