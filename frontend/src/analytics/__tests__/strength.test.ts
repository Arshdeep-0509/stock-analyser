import { describe, expect, it } from 'vitest'
import { breakdownFromTerms, computeStrength, computeStrengthBreakdown, strengthTone, type StrengthInputs } from '../strength'

function baseInputs(overrides: Partial<StrengthInputs> = {}): StrengthInputs {
  return {
    dailyCloses: [100, 102, 99, 101, 100, 103],
    ltp: 104,
    volumeSoFarToday: 100,
    priorSessionVolumesAtSameBar: [100, 100, 100],
    todayBarReturns: [0.005, 0.005, 0.005, 0.005],
    ...overrides,
  }
}

describe('computeStrength', () => {
  it('a flat stock (sigmaDaily === 0) returns 0, never Infinity or NaN', () => {
    const value = computeStrength(baseInputs({ dailyCloses: [100, 100, 100, 100, 100] }))
    expect(value).toBe(0)
    expect(Number.isFinite(value)).toBe(true)
  })

  it('fewer than 5 sessions of history (today + 3 or fewer completed closes) returns NaN', () => {
    const value = computeStrength(baseInputs({ dailyCloses: [100, 101, 99] }))
    expect(Number.isNaN(value)).toBe(true)
  })

  it('exactly 5 sessions of history (today + 4 completed closes) is enough to compute', () => {
    const value = computeStrength(baseInputs({ dailyCloses: [100, 101, 99, 100] }))
    expect(Number.isNaN(value)).toBe(false)
  })

  it('doubling the move roughly doubles Strength, all else equal', () => {
    const dailyCloses = [100, 102, 99, 101, 100, 103]
    const prevClose = dailyCloses[dailyCloses.length - 1]

    const s1 = computeStrength(baseInputs({ dailyCloses, ltp: prevClose * 1.01 }))
    const s2 = computeStrength(baseInputs({ dailyCloses, ltp: prevClose * 1.02 }))

    expect(s2 / s1).toBeCloseTo(2, 1)
  })

  it('quadrupling rvol roughly doubles Strength (the sqrt)', () => {
    const s1 = computeStrength(baseInputs({ volumeSoFarToday: 100, priorSessionVolumesAtSameBar: [100, 100, 100] }))
    const s2 = computeStrength(baseInputs({ volumeSoFarToday: 400, priorSessionVolumesAtSameBar: [100, 100, 100] }))

    expect(s2 / s1).toBeCloseTo(2, 1)
  })

  it('a perfectly one-directional day scores higher than a chopping day with the same net bar-return', () => {
    const oneDirectional = computeStrength(baseInputs({ todayBarReturns: [0.004, 0.004, 0.004, 0.004, 0.004] }))
    const chopping = computeStrength(baseInputs({ todayBarReturns: [0.02, -0.02, 0.02, -0.02, 0.02] }))

    // Both arrays sum to the same net (0.02); chopping's sum-of-abs is far larger, so its persistence (and Strength) is lower.
    expect(oneDirectional).toBeGreaterThan(chopping)
  })

  it('is never negative, even for a decline', () => {
    const decline = computeStrength(baseInputs({ ltp: 96 }))
    expect(decline).toBeGreaterThanOrEqual(0)

    const flat = computeStrength(baseInputs({ dailyCloses: [100, 100, 100, 100, 100] }))
    expect(flat).toBeGreaterThanOrEqual(0)

    const noVolumeYet = computeStrength(baseInputs({ volumeSoFarToday: 0, priorSessionVolumesAtSameBar: [] }))
    expect(noVolumeYet).toBeGreaterThanOrEqual(0)
  })

  it('zero prior-session volume history falls back to rvol = 0, not a division by zero', () => {
    const value = computeStrength(baseInputs({ priorSessionVolumesAtSameBar: [] }))
    expect(Number.isFinite(value)).toBe(true)
  })

  it('no closed bars yet today treats persistence as 0, not NaN', () => {
    const value = computeStrength(baseInputs({ todayBarReturns: [] }))
    expect(Number.isFinite(value)).toBe(true)
  })
})

describe('strengthTone', () => {
  it('bands at exactly 1.0, 0.5 and 0.05', () => {
    expect(strengthTone(1.0)).toBe('high')
    expect(strengthTone(0.99)).toBe('medium')

    expect(strengthTone(0.5)).toBe('medium')
    expect(strengthTone(0.49)).toBe('low')

    expect(strengthTone(0.05)).toBe('low')
    expect(strengthTone(0.049)).toBe('none')
  })

  it('handles the extremes and NaN', () => {
    expect(strengthTone(5.3)).toBe('high')
    expect(strengthTone(0)).toBe('none')
    expect(strengthTone(NaN)).toBe('none')
    expect(strengthTone(-1)).toBe('none')
  })
})

describe('breakdownFromTerms', () => {
  it("rebuilds exactly computeStrengthBreakdown()'s terms from the three values an IntradayRow stores", () => {
    for (const inputs of [baseInputs(), baseInputs({ volumeSoFarToday: 0 }), baseInputs({ todayBarReturns: [0.01, -0.01, 0.002] })]) {
      const full = computeStrengthBreakdown(inputs)
      expect(breakdownFromTerms(full)).toEqual(full)
    }
  })

  it('stays all-NaN when Strength itself is NaN', () => {
    const rebuilt = breakdownFromTerms({ strength: NaN, zMove: 1, rvol: 1, persistence: 1 })
    expect(Number.isNaN(rebuilt.sqrtRvol)).toBe(true)
    expect(Number.isNaN(rebuilt.persistenceFactor)).toBe(true)
  })
})