import { describe, expect, it } from 'vitest'
import type { AnalyzedCandle, Candle } from '../../types/domain'
import { DEFAULT_PARAMS } from '../constants'
import { explainBreakout, explainSignal } from '../explainSignal'
import { checkBreakout, checkSignal } from '../signals'

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

describe('explainSignal', () => {
  it('decision always matches calling checkSignal() directly — no second code path', () => {
    const cases: AnalyzedCandle[][] = [
      makeSeries(['red', 'green', 'green'], 62),
      makeSeries(['red', 'green', 'green'], 59.99),
      makeSeries(['green', 'red', 'red'], 37),
      makeSeries(['green', 'green', 'green'], 62),
      makeSeries(['red', 'green', 'green'], 62, 1999.99),
      [],
      makeSeries(['green'], 62),
    ]

    for (const candles of cases) {
      expect(explainSignal(candles, DEFAULT_PARAMS).decision).toBe(checkSignal(candles, DEFAULT_PARAMS))
    }
  })

  it('every check passes for a bar that actually produces BUY', () => {
    const { decision, checks } = explainSignal(makeSeries(['red', 'green', 'green'], 62), DEFAULT_PARAMS)
    expect(decision).toBe('BUY')
    expect(checks.every((c) => c.pass)).toBe(true)

    const rsiCheck = checks.find((c) => c.key === 'rsiBand')
    expect(rsiCheck).toMatchObject({ band: 'BUY', pass: true, rsi: 62, low: 60, high: 65 })

    const colorCheck = checks.find((c) => c.key === 'haColor')
    expect(colorCheck).toMatchObject({ actual: 'green', pass: true })

    const streakCheck = checks.find((c) => c.key === 'haStreak')
    expect(streakCheck).toMatchObject({ streak: 2, pass: true })
  })

  it('reports a near-miss RSI with the correct band and value when just outside it', () => {
    const { decision, checks } = explainSignal(makeSeries(['red', 'green', 'green'], 66.2), DEFAULT_PARAMS)
    expect(decision).toBeNull()

    const rsiCheck = checks.find((c) => c.key === 'rsiBand')
    expect(rsiCheck).toMatchObject({ band: 'BUY', pass: false, rsi: 66.2, low: 60, high: 65 })
  })

  it('reports the SELL band when the bar is red, not the BUY band', () => {
    const { checks } = explainSignal(makeSeries(['green', 'red', 'red'], 37), DEFAULT_PARAMS)
    const rsiCheck = checks.find((c) => c.key === 'rsiBand')
    expect(rsiCheck).toMatchObject({ band: 'SELL', low: 35, high: 40 })
  })

  it('reports minPrice failure explicitly', () => {
    const { checks } = explainSignal(makeSeries(['red', 'green', 'green'], 62, 1999.99), DEFAULT_PARAMS)
    const minPriceCheck = checks.find((c) => c.key === 'minPrice')
    expect(minPriceCheck).toMatchObject({ pass: false, close: 1999.99, minPrice: 2000 })
  })

  it('reports notEnoughCandles when fewer than 3 candles are available', () => {
    const { decision, checks } = explainSignal([], DEFAULT_PARAMS)
    expect(decision).toBeNull()
    expect(checks).toEqual([{ key: 'notEnoughCandles', pass: false, have: 0, need: 3 }])
  })

  it('reports rsiUndefined when RSI has not warmed up yet', () => {
    const candles = makeSeries(['red', 'green', 'green'], NaN)
    const { decision, checks } = explainSignal(candles, DEFAULT_PARAMS)
    expect(decision).toBeNull()
    expect(checks).toEqual([{ key: 'rsiUndefined', pass: false }])
  })
})

describe('explainBreakout', () => {
  function makeBreakoutSeries(lastClose: number): Candle[] {
    const prior: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      time: i,
      open: 2500,
      high: 2600,
      low: 2400,
      close: 2500,
      volume: 1000,
    }))
    const last: Candle = { time: 20, open: 2500, high: lastClose, low: lastClose, close: lastClose, volume: 1000 }
    return [...prior, last]
  }

  it('result always matches calling checkBreakout() directly — no second code path', () => {
    const cases: Candle[][] = [makeBreakoutSeries(2650), makeBreakoutSeries(2600), makeBreakoutSeries(2450), []]
    for (const candles of cases) {
      expect(explainBreakout(candles, DEFAULT_PARAMS).result).toEqual(checkBreakout(candles, DEFAULT_PARAMS))
    }
  })

  it('reports a passing up-breakout with the correct level', () => {
    const { result, checks } = explainBreakout(makeBreakoutSeries(2650), DEFAULT_PARAMS)
    expect(result).toEqual({ signal: 'BREAKOUT-UP', level: 2600 })
    expect(checks).toEqual([{ key: 'breakoutRange', pass: true, direction: 'up', close: 2650, level: 2600, lookback: 20 }])
  })

  it('reports a failing near-miss against the high when the close sits inside the range but closer to the top', () => {
    const { result, checks } = explainBreakout(makeBreakoutSeries(2590), DEFAULT_PARAMS)
    expect(result).toEqual({ signal: null, level: null })
    expect(checks).toEqual([{ key: 'breakoutRange', pass: false, direction: 'up', close: 2590, level: 2600, lookback: 20 }])
  })
})
