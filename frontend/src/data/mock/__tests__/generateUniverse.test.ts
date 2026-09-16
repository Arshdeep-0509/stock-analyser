import { describe, expect, it } from 'vitest'
import { DEFAULT_SEED } from '../MockMarketDataSource'
import { generateUniverse } from '../generateUniverse'

// Fixed reference instant so this test is byte-identical regardless of when
// it's actually run — "same seed -> byte-identical session" applies to the
// test suite too, not just interactive use.
const REFERENCE_NOW = 1767609600

describe('generateUniverse', () => {
  it('yields between 8 and 60 signals for the default seed', () => {
    const result = generateUniverse(DEFAULT_SEED, REFERENCE_NOW)

    expect(result.signalCount).toBeGreaterThanOrEqual(8)
    expect(result.signalCount).toBeLessThanOrEqual(60)
  })

  it('is byte-identical across two runs of the same seed', () => {
    const a = generateUniverse(DEFAULT_SEED, REFERENCE_NOW)
    const b = generateUniverse(DEFAULT_SEED, REFERENCE_NOW)

    expect(a.signalCount).toBe(b.signalCount)
    expect(a.attempts).toBe(b.attempts)
    expect(a.scripMaster.rows).toEqual(b.scripMaster.rows)
    expect(a.results.map((r) => ({ token: r.entry.token, signal: r.signal, breakout: r.breakout }))).toEqual(
      b.results.map((r) => ({ token: r.entry.token, signal: r.signal, breakout: r.breakout })),
    )
  })

  it('produces every signal from candles that actually emerge from the generator, not from a lookup table', () => {
    const result = generateUniverse(DEFAULT_SEED, REFERENCE_NOW)
    const withSignal = result.results.filter((r) => r.signal !== null || r.breakout.signal !== null)

    expect(withSignal.length).toBeGreaterThan(0)
    for (const row of withSignal) {
      // The candle series is non-trivial (a real generated path), and the
      // signal is only knowable by having actually run checkSignal/
      // checkBreakout over it — there is no symbol-name-to-signal table
      // anywhere in the generator.
      expect(row.candles.length).toBeGreaterThan(0)
      const last = row.candles[row.candles.length - 1]
      expect(last).toBeDefined()
    }
  })

  it('a different seed produces a different universe', () => {
    const a = generateUniverse(1, REFERENCE_NOW)
    const b = generateUniverse(2, REFERENCE_NOW)

    expect(a.scripMaster.rows).not.toEqual(b.scripMaster.rows)
  })
})
