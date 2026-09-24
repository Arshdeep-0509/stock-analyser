import { describe, expect, it } from 'vitest'
import { DEFAULT_FAILURE_RATE, DEFAULT_SEED } from '../../data/mock'
import { failureRateFromEnv, seedFromEnv } from '../dataSource'

describe('build-time test hooks', () => {
  it('seedFromEnv: an integer pins the seed; unset, blank or junk falls back to the default', () => {
    expect(seedFromEnv('424242')).toBe(424242)
    expect(seedFromEnv('7')).toBe(7)
    for (const raw of [undefined, '', '  ', 'abc', '1.5', '1e400']) expect(seedFromEnv(raw)).toBe(DEFAULT_SEED)
  })

  it('failureRateFromEnv: 0..1 sets the rate; unset, out of range or junk keeps the standing rate', () => {
    expect(failureRateFromEnv('0')).toBe(0)
    expect(failureRateFromEnv('1')).toBe(1)
    expect(failureRateFromEnv('0.25')).toBe(0.25)
    for (const raw of [undefined, '', 'x', '-0.1', '1.01', 'NaN', 'Infinity']) expect(failureRateFromEnv(raw)).toBe(DEFAULT_FAILURE_RATE)
  })
})
