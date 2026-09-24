import { describe, expect, it } from 'vitest'
import type { Candle } from '../../types/domain'
import { buildIndexQuote, computeCapWeightedIndexSeries, generateIndiaVixSeries, lastAndPrevClose, type WeightedConstituent } from '../indexComposite'
import { mulberry32 } from '../../data/mock/rng'

const DAY1_OPEN = 1767588300 // 09:15 IST, 2026-01-05
const DAY2_OPEN = 1767674700 // 09:15 IST, 2026-01-06

function series(times: number[], closes: number[]): Candle[] {
  return times.map((time, i) => ({ time, open: closes[i], high: closes[i] + 1, low: closes[i] - 1, close: closes[i], volume: 1000 }))
}

describe('computeCapWeightedIndexSeries', () => {
  it('weights each constituent by its `weight`, not an equal split', () => {
    const heavy: WeightedConstituent = { weight: 900, series: series([DAY1_OPEN], [100]) }
    const light: WeightedConstituent = { weight: 100, series: series([DAY1_OPEN], [200]) }

    const [bar] = computeCapWeightedIndexSeries([heavy, light])

    // 0.9*100 + 0.1*200 = 110 — close to the heavy constituent's own price, not the midpoint (150).
    expect(bar.close).toBeCloseTo(110, 6)
  })

  it('the composite sign agrees with the majority of constituents when weights and move sizes are comparable', () => {
    const up1: WeightedConstituent = { weight: 100, series: series([DAY1_OPEN, DAY2_OPEN], [100, 101]) }
    const up2: WeightedConstituent = { weight: 100, series: series([DAY1_OPEN, DAY2_OPEN], [100, 101.5]) }
    const down: WeightedConstituent = { weight: 100, series: series([DAY1_OPEN, DAY2_OPEN], [100, 99]) }

    const composite = computeCapWeightedIndexSeries([up1, up2, down])
    const { last, prevClose } = lastAndPrevClose(composite)

    expect(last).toBeGreaterThan(prevClose)
  })

  it('ignores zero-weight or empty-series constituents', () => {
    const valid: WeightedConstituent = { weight: 100, series: series([DAY1_OPEN], [50]) }
    const zeroWeight: WeightedConstituent = { weight: 0, series: series([DAY1_OPEN], [99999]) }
    const empty: WeightedConstituent = { weight: 100, series: [] }

    const [bar] = computeCapWeightedIndexSeries([valid, zeroWeight, empty])
    expect(bar.close).toBe(50)
  })

  it('returns an empty series when there is nothing to weight', () => {
    expect(computeCapWeightedIndexSeries([])).toEqual([])
  })
})

describe('lastAndPrevClose', () => {
  it('reads `last` off the most recent closed bar and `prevClose` off the prior session', () => {
    const s = series([DAY1_OPEN, DAY1_OPEN + 300, DAY2_OPEN], [100, 105, 110])
    expect(lastAndPrevClose(s)).toEqual({ last: 110, prevClose: 105 })
  })

  it('falls back to the single available session when there is only one', () => {
    const s = series([DAY1_OPEN, DAY1_OPEN + 300], [100, 103])
    expect(lastAndPrevClose(s)).toEqual({ last: 103, prevClose: 103 })
  })

  it('is NaN/NaN for an empty series rather than throwing', () => {
    const { last, prevClose } = lastAndPrevClose([])
    expect(Number.isNaN(last)).toBe(true)
    expect(Number.isNaN(prevClose)).toBe(true)
  })
})

describe('generateIndiaVixSeries', () => {
  const params = { baseline: 13, reversionStrength: 0.05, volPerBar: 0.15, antiCorrelation: 0.6 }

  it('is anti-correlated with NIFTY: a strongly rising Nifty pulls VIX below baseline on average', () => {
    const risingNifty = series(
      Array.from({ length: 50 }, (_, i) => DAY1_OPEN + i * 300),
      Array.from({ length: 50 }, (_, i) => 100 * Math.exp(i * 0.01)),
    )
    const rng = mulberry32(1)
    const vix = generateIndiaVixSeries(risingNifty, params, rng)

    const meanVix = vix.reduce((sum, c) => sum + c.close, 0) / vix.length
    expect(meanVix).toBeLessThan(params.baseline)
  })

  it('produces exactly one bar per NIFTY bar, sharing its timestamps', () => {
    const nifty = series([DAY1_OPEN, DAY1_OPEN + 300, DAY1_OPEN + 600], [100, 101, 99])
    const vix = generateIndiaVixSeries(nifty, params, mulberry32(7))
    expect(vix.map((c) => c.time)).toEqual(nifty.map((c) => c.time))
  })

  it('is deterministic for the same inputs and rng seed', () => {
    const nifty = series([DAY1_OPEN, DAY1_OPEN + 300], [100, 98])
    const a = generateIndiaVixSeries(nifty, params, mulberry32(42))
    const b = generateIndiaVixSeries(nifty, params, mulberry32(42))
    expect(a).toEqual(b)
  })

  it('never drops below the floor of 5', () => {
    const crashingNifty = series(
      Array.from({ length: 30 }, (_, i) => DAY1_OPEN + i * 300),
      Array.from({ length: 30 }, (_, i) => 100 * Math.exp(i * 0.05)),
    )
    const vix = generateIndiaVixSeries(crashingNifty, { ...params, antiCorrelation: 5 }, mulberry32(3))
    expect(vix.every((c) => c.close >= 5)).toBe(true)
  })
})

describe('buildIndexQuote', () => {
  it('computes changePct from last vs prevClose', () => {
    const s = series([DAY1_OPEN, DAY1_OPEN + 300, DAY2_OPEN], [100, 100, 110])
    const quote = buildIndexQuote('NIFTY', 'NIFTY 50', s, DAY2_OPEN)
    expect(quote).toEqual({ key: 'NIFTY', label: 'NIFTY 50', last: 110, prevClose: 100, changePct: 10, time: DAY2_OPEN })
  })
})
