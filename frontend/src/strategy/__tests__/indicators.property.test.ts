import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Candle } from '../../types/domain'
import { computeHeikinAshi, computeRsi, haStreakLength } from '../indicators'

// 500 seeded runs at size 'max' take ~1-2s alone but ~6s when the whole suite shares the CPU;
// the default 5s would make these fail on load, not on behaviour.
const PROPERTY_TIMEOUT_MS = 30_000

/**
 * Property-based checks on the parity-locked indicators. These don't compare
 * against Python (scripts/parityDiff.ts does that on fixed fixtures) — they
 * pin down invariants that must hold for ANY valid candle series, so a port
 * change that happens to survive the fixtures still gets caught.
 *
 * Seeded: a failure prints its seed + path and reproduces exactly.
 *
 * size: 'max' matters: fast-check's default size ('small') caps generated
 * arrays at ~10 items regardless of maxLength, which would never get past the
 * 14-bar RSI warm-up — the warm-up properties would pass vacuously.
 */
const RUNS = { numRuns: 500, seed: 424242 }
const PERIOD = 14
const MIN_PRICE = 0.01
const MAX_PRICE = 500_000

const price = fc.double({ min: MIN_PRICE, max: MAX_PRICE, noNaN: true, noDefaultInfinity: true })

/** A valid bar: high >= max(open, close), low <= min(open, close), everything inside [0.01, 500000]. */
const candleArb = fc
  .record({ open: price, close: price, up: fc.double({ min: 0, max: 1, noNaN: true }), down: fc.double({ min: 0, max: 1, noNaN: true }), volume: fc.nat(10_000_000) })
  .map(({ open, close, up, down, volume }) => {
    const top = Math.max(open, close)
    const bottom = Math.min(open, close)
    return {
      open,
      close,
      high: Math.min(MAX_PRICE, top + (MAX_PRICE - top) * up * 0.01),
      low: Math.max(MIN_PRICE, bottom - (bottom - MIN_PRICE) * down * 0.01),
      volume,
    }
  })

const seriesArb = fc
  .array(candleArb, { minLength: 1, maxLength: 300, size: 'max' })
  .map((bars): Candle[] => bars.map((b, i) => ({ time: 1767584700 + i * 300, ...b })))

/** Series whose closes are often identical run to run — exercises the 0/0 (flat) path the random prices almost never hit. */
const sometimesFlatArb = fc
  .tuple(fc.array(fc.constantFrom(100, 100, 100, 101, 99), { minLength: 1, maxLength: 300, size: 'max' }))
  .map(([closes]): Candle[] => closes.map((c, i) => ({ time: 1767584700 + i * 300, open: c, high: c + 1, low: c - 1, close: c, volume: 1 })))

/** Every close identical, any length — the 0/0 path. Random prices essentially never produce 15+ equal closes in a row. */
const flatArb = fc
  .tuple(fc.integer({ min: 1, max: 300 }), price)
  .map(([n, p]): Candle[] => Array.from({ length: n }, (_, i) => ({ time: 1767584700 + i * 300, open: p, high: p, low: p, close: p, volume: 1 })))

/** Strictly rising or strictly falling closes — the extremes (avgLoss = 0 -> RSI exactly 100; avgGain = 0 -> exactly 0) a random walk almost never reaches. */
const monotonicArb = fc
  .tuple(fc.integer({ min: 1, max: 300 }), fc.boolean(), fc.double({ min: 1, max: 1000, noNaN: true }))
  .map(([n, rising, start]): Candle[] =>
    Array.from({ length: n }, (_, i) => {
      const close = rising ? start + i : start + n - i
      return { time: 1767584700 + i * 300, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1 }
    }),
  )

const anySeries = fc.oneof(seriesArb, sometimesFlatArb, flatArb, monotonicArb)

describe('computeRsi — properties', { timeout: PROPERTY_TIMEOUT_MS }, () => {
  it('the generators really do produce series past the RSI warm-up (guards against vacuous properties)', () => {
    const lengths = fc.sample(seriesArb, { numRuns: 200, seed: 424242 }).map((s) => s.length)
    expect(lengths.filter((n) => n > PERIOD).length).toBeGreaterThan(150)
    expect(Math.max(...lengths)).toBeGreaterThan(200)
  })

  it('returns an array exactly as long as its input', () => {
    fc.assert(
      fc.property(anySeries, (candles) => {
        expect(computeRsi(candles, PERIOD)).toHaveLength(candles.length)
      }),
      RUNS,
    )
  })

  it('every value is NaN or within [0, 100]', () => {
    fc.assert(
      fc.property(anySeries, (candles) => {
        return computeRsi(candles, PERIOD).every((v) => Number.isNaN(v) || (v >= 0 && v <= 100))
      }),
      RUNS,
    )
  })

  it('is NaN for every index < period', () => {
    fc.assert(
      fc.property(anySeries, (candles) => {
        return computeRsi(candles, PERIOD).slice(0, PERIOD).every((v) => Number.isNaN(v))
      }),
      RUNS,
    )
  })

  it('after the warm-up, is NaN exactly when every close so far is identical (avgGain = avgLoss = 0, i.e. 0/0)', () => {
    fc.assert(
      fc.property(anySeries, (candles) => {
        const rsi = computeRsi(candles, PERIOD)
        let allEqualSoFar = true
        for (let i = 1; i < candles.length; i++) {
          if (candles[i].close !== candles[0].close) allEqualSoFar = false
          if (i >= PERIOD && Number.isNaN(rsi[i]) !== allEqualSoFar) return false
        }
        return true
      }),
      RUNS,
    )
  })

  it('strictly rising closes give exactly 100 after the warm-up, strictly falling exactly 0', () => {
    fc.assert(
      fc.property(monotonicArb, (candles) => {
        const rsi = computeRsi(candles, PERIOD)
        const rising = candles.length > 1 && candles[1].close > candles[0].close
        return rsi.slice(PERIOD).every((v) => v === (rising ? 100 : 0))
      }),
      RUNS,
    )
  })

  it('a completely flat series is NaN at every index (0/0 is never coerced to a number)', () => {
    fc.assert(
      fc.property(flatArb, (candles) => computeRsi(candles, PERIOD).every((v) => Number.isNaN(v))),
      RUNS,
    )
  })

  it('is pure: same input -> identical output, and the input is not mutated', () => {
    fc.assert(
      fc.property(anySeries, (candles) => {
        const snapshot = structuredClone(candles)
        const first = computeRsi(candles, PERIOD)
        const second = computeRsi(candles, PERIOD)
        expect(second).toEqual(first)
        expect(candles).toEqual(snapshot)
      }),
      RUNS,
    )
  })
})

describe('computeHeikinAshi — properties', { timeout: PROPERTY_TIMEOUT_MS }, () => {
  it('haHigh >= max(haOpen, haClose, high) and haLow <= min(haOpen, haClose, low) for every bar', () => {
    fc.assert(
      fc.property(anySeries, (candles) => {
        return computeHeikinAshi(candles).every(
          (ha, i) => ha.haHigh >= Math.max(ha.haOpen, ha.haClose, candles[i].high) && ha.haLow <= Math.min(ha.haOpen, ha.haClose, candles[i].low),
        )
      }),
      RUNS,
    )
  })

  it("haColor is 'green' exactly when haClose >= haOpen (ties go green)", () => {
    fc.assert(
      fc.property(anySeries, (candles) => {
        return computeHeikinAshi(candles).every((ha) => ha.haColor === (ha.haClose >= ha.haOpen ? 'green' : 'red'))
      }),
      RUNS,
    )
  })

  it('is pure: same input -> identical output, and the input is not mutated', () => {
    fc.assert(
      fc.property(anySeries, (candles) => {
        const snapshot = structuredClone(candles)
        expect(computeHeikinAshi(candles)).toEqual(computeHeikinAshi(candles))
        expect(candles).toEqual(snapshot)
      }),
      RUNS,
    )
  })
})

describe('haStreakLength — properties', { timeout: PROPERTY_TIMEOUT_MS }, () => {
  it('is never < 1 and never > idx + 1, and every bar in the streak shares the returned colour', () => {
    fc.assert(
      fc.property(
        anySeries.chain((candles) => fc.tuple(fc.constant(candles), fc.nat(candles.length - 1))),
        ([candles, idx]) => {
          const ha = computeHeikinAshi(candles)
          const { streak, color } = haStreakLength(ha, idx)
          if (streak < 1 || streak > idx + 1) return false
          for (let i = idx - streak + 1; i <= idx; i++) if (ha[i].haColor !== color) return false
          return idx - streak < 0 || ha[idx - streak].haColor !== color
        },
      ),
      RUNS,
    )
  })
})
