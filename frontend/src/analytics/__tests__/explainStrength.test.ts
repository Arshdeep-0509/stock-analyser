import { describe, expect, it } from 'vitest'
import { computeStrength } from '../strength'
import { explainStrength } from '../explainStrength'
import type { StrengthInputs } from '../strength'

const inputs: StrengthInputs = {
  dailyCloses: [100, 102, 99, 101, 100, 103],
  ltp: 104,
  volumeSoFarToday: 400,
  priorSessionVolumesAtSameBar: [100, 100, 100],
  todayBarReturns: [0.01, 0.01, -0.002, 0.01],
}

describe('explainStrength', () => {
  it('never drifts from computeStrength — same inputs, same headline number', () => {
    const explanation = explainStrength(inputs)
    expect(explanation.strength).toBe(computeStrength(inputs))
  })

  it('the three factors multiply back to the headline value', () => {
    const explanation = explainStrength(inputs)
    expect(explanation.zMove * explanation.sqrtRvol * explanation.persistenceFactor).toBeCloseTo(explanation.strength, 10)
  })

  it('formats a one-decimal summary line naming all three factors', () => {
    const explanation = explainStrength(inputs)
    expect(explanation.summary).toMatch(/^Strength -?\d+\.\d = zMove -?\d+\.\d × √rvol \d+\.\d × persistence-factor \d+\.\d$/)
  })

  it('explains the NaN case with a readable message instead of "Strength NaN"', () => {
    const explanation = explainStrength({ ...inputs, dailyCloses: [100, 101, 99] })
    expect(Number.isNaN(explanation.strength)).toBe(true)
    expect(explanation.summary).not.toContain('NaN')
    expect(explanation.summary.toLowerCase()).toContain('not enough')
  })
})
