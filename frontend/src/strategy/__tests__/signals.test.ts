import { describe, expect, it } from 'vitest'
import type { AnalyzedCandle, Candle, SignalRow } from '../../types/domain'
import { DEFAULT_PARAMS } from '../constants'
import { checkBreakout, checkSignal, selectVisibleRows } from '../signals'

function makeAnalyzedCandle(overrides: Partial<AnalyzedCandle> = {}): AnalyzedCandle {
  return {
    time: 0,
    open: 2500,
    high: 2500,
    low: 2500,
    close: 2500,
    volume: 1000,
    haOpen: 0,
    haHigh: 0,
    haLow: 0,
    haClose: 0,
    haColor: 'green',
    rsi: NaN,
    ...overrides,
  }
}

/** Builds a 3-candle series where only the last candle's rsi/close/colour matter to checkSignal. */
function makeSeries(colors: Array<'green' | 'red'>, rsi: number, close = 2500): AnalyzedCandle[] {
  return colors.map((color, i) =>
    makeAnalyzedCandle({
      time: i,
      haColor: color,
      close: i === colors.length - 1 ? close : 2500,
      rsi: i === colors.length - 1 ? rsi : NaN,
    }),
  )
}

describe('checkSignal', () => {
  it('BUY fires at rsi exactly 60 and exactly 65 (inclusive band)', () => {
    expect(checkSignal(makeSeries(['red', 'green', 'green'], 60), DEFAULT_PARAMS)).toBe('BUY')
    expect(checkSignal(makeSeries(['red', 'green', 'green'], 65), DEFAULT_PARAMS)).toBe('BUY')
  })

  it('BUY does not fire just outside the band', () => {
    expect(checkSignal(makeSeries(['red', 'green', 'green'], 59.99), DEFAULT_PARAMS)).toBeNull()
    expect(checkSignal(makeSeries(['red', 'green', 'green'], 65.01), DEFAULT_PARAMS)).toBeNull()
  })

  it('BUY does not fire on a streak of 1 or 3 — only exactly 2', () => {
    // streak 1: last candle's colour just flipped back from the one before it
    expect(checkSignal(makeSeries(['green', 'red', 'green'], 62), DEFAULT_PARAMS)).toBeNull()
    // streak 3: three consecutive greens
    expect(checkSignal(makeSeries(['green', 'green', 'green'], 62), DEFAULT_PARAMS)).toBeNull()
    // streak 2 with the same rsi does fire, confirming streak is the only variable above
    expect(checkSignal(makeSeries(['red', 'green', 'green'], 62), DEFAULT_PARAMS)).toBe('BUY')
  })

  it('SELL mirrors BUY at rsi exactly 35 and exactly 40', () => {
    expect(checkSignal(makeSeries(['green', 'red', 'red'], 35), DEFAULT_PARAMS)).toBe('SELL')
    expect(checkSignal(makeSeries(['green', 'red', 'red'], 40), DEFAULT_PARAMS)).toBe('SELL')
    expect(checkSignal(makeSeries(['green', 'red', 'red'], 34.99), DEFAULT_PARAMS)).toBeNull()
    expect(checkSignal(makeSeries(['green', 'red', 'red'], 40.01), DEFAULT_PARAMS)).toBeNull()
  })

  it('close 1999.99 suppresses everything; 2000.00 allows it (MIN_PRICE is inclusive)', () => {
    expect(checkSignal(makeSeries(['red', 'green', 'green'], 62, 1999.99), DEFAULT_PARAMS)).toBeNull()
    expect(checkSignal(makeSeries(['red', 'green', 'green'], 62, 2000.0), DEFAULT_PARAMS)).toBe('BUY')
  })
})

describe('checkBreakout', () => {
  function makeBreakoutSeries(lastClose: number, lastHigh = lastClose, lastLow = lastClose): Candle[] {
    const prior: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      time: i,
      open: 2500,
      high: 2600,
      low: 2400,
      close: 2500,
      volume: 1000,
    }))
    const last: Candle = { time: 20, open: 2500, high: lastHigh, low: lastLow, close: lastClose, volume: 1000 }
    return [...prior, last]
  }

  it('produces BREAKOUT-UP with level === the max high of the prior 20 bars when the 21st closes above it', () => {
    const result = checkBreakout(makeBreakoutSeries(2650, 2650), DEFAULT_PARAMS)
    expect(result).toEqual({ signal: 'BREAKOUT-UP', level: 2600 })
  })

  it('produces nothing when the 21st candle closes exactly at the prior range high', () => {
    const result = checkBreakout(makeBreakoutSeries(2600, 2600), DEFAULT_PARAMS)
    expect(result).toEqual({ signal: null, level: null })
  })
})

describe('checkSignal + checkBreakout composition', () => {
  it('one symbol can produce both a BUY and a BREAKOUT-UP row from the same candle series', () => {
    const prior: AnalyzedCandle[] = Array.from({ length: 18 }, (_, i) =>
      makeAnalyzedCandle({ time: i, high: 2550, low: 2450, close: 2500, haColor: 'red', rsi: NaN }),
    )
    // index 18 is still red; index 19 flips to green, index 20 is the
    // SECOND green (streak of exactly 2) that confirms the BUY.
    const lastRed = makeAnalyzedCandle({ time: 18, high: 2550, low: 2450, close: 2500, haColor: 'red', rsi: NaN })
    const firstGreen = makeAnalyzedCandle({ time: 19, high: 2550, low: 2450, close: 2500, haColor: 'green', rsi: NaN })
    const last = makeAnalyzedCandle({ time: 20, high: 2650, low: 2600, close: 2650, haColor: 'green', rsi: 62 })
    const series = [...prior, lastRed, firstGreen, last]

    const signal = checkSignal(series, DEFAULT_PARAMS)
    const breakout = checkBreakout(series, DEFAULT_PARAMS)

    expect(signal).toBe('BUY')
    expect(breakout.signal).toBe('BREAKOUT-UP')

    const rows: SignalRow[] = []
    if (signal) {
      rows.push({ id: 'a', symbol: 'TEST', exchange: 'NSE', signal, price: last.close, rsi: last.rsi, time: last.time })
    }
    if (breakout.signal) {
      rows.push({
        id: 'b',
        symbol: 'TEST',
        exchange: 'NSE',
        signal: breakout.signal,
        price: last.close,
        rsi: last.rsi,
        time: last.time,
        level: breakout.level ?? undefined,
      })
    }

    expect(rows).toHaveLength(2)
  })
})

describe('selectVisibleRows', () => {
  it('hides NSE rows but keeps the CE/PE rows derived from them', () => {
    const nseBuy: SignalRow = { id: '1', symbol: 'RELIANCE-EQ', exchange: 'NSE', signal: 'BUY', price: 2500, rsi: 62, time: 0 }
    const ceBuy: SignalRow = {
      id: '2',
      symbol: 'RELIANCE25JANCE2500',
      exchange: 'NFO',
      signal: 'CE Buy',
      price: 42,
      rsi: 62,
      time: 0,
      derivedFrom: 'RELIANCE-EQ',
    }
    const futuresBreakout: SignalRow = {
      id: '3',
      symbol: 'RELIANCE25JANFUT',
      exchange: 'NFO',
      signal: 'BREAKOUT-UP',
      price: 2600,
      rsi: 55,
      time: 0,
      level: 2590,
    }

    const visible = selectVisibleRows([nseBuy, ceBuy, futuresBreakout])

    expect(visible).toContainEqual(ceBuy)
    expect(visible).toContainEqual(futuresBreakout)
    expect(visible).not.toContainEqual(nseBuy)
    expect(visible).toHaveLength(2)
  })
})
