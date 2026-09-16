import { describe, expect, it } from 'vitest'
import { DEFAULT_SEED } from '../MockMarketDataSource'
import { generateScripMaster } from '../scripMaster'

const REFERENCE_NOW = 1767609600
const SEED = DEFAULT_SEED

describe('generateScripMaster', () => {
  const result = generateScripMaster({ seed: SEED, referenceNow: REFERENCE_NOW })

  it('generates roughly 180 NSE equity rows', () => {
    const equityRows = result.rows.filter((r) => r.exchange === 'NSE' && r.instrument_name === 'EQ')
    expect(equityRows.length).toBeGreaterThan(150)
    expect(equityRows.length).toBeLessThan(200)
  })

  it('roughly 60% of equity rows are priced at or above MIN_PRICE (2000)', () => {
    const equityRows = result.rows.filter((r) => r.exchange === 'NSE' && r.instrument_name === 'EQ')
    const atOrAbove = equityRows.filter((r) => Number(r.close_price) >= 2000)
    const fraction = atOrAbove.length / equityRows.length

    expect(fraction).toBeGreaterThan(0.5)
    expect(fraction).toBeLessThan(0.7)
  })

  it('gives futures-eligible underlyings three expiries, and includes some already-expired contracts', () => {
    const futuresRows = result.rows.filter((r) => r.exchange === 'NFO' && r.instrument_name === 'FUTSTK')
    expect(futuresRows.length).toBeGreaterThan(0)

    const expired = futuresRows.filter((r) => {
      const [day, mon, year] = r.expiry.split('-')
      const parsed = Date.parse(`${mon} ${day}, ${year} UTC`)
      return parsed < REFERENCE_NOW * 1000
    })
    expect(expired.length).toBeGreaterThan(0)
  })

  it('deliberately drops the PE leg at the ATM strike for exactly one options company', () => {
    expect(result.missingPeCompany).not.toBeNull()

    const company = result.missingPeCompany as string
    const optionRows = result.rows.filter(
      (r) => r.exchange === 'NFO' && r.instrument_name === 'OPTSTK' && r.company_name === company,
    )
    const nearestExpiry = optionRows.reduce<string | null>((min, r) => (min === null || r.expiry < min ? r.expiry : min), null)
    const atmChain = optionRows.filter((r) => r.expiry === nearestExpiry)

    const strikesWithBothLegs = new Map<string, Set<string>>()
    for (const row of atmChain) {
      const set = strikesWithBothLegs.get(row.strike as string) ?? new Set<string>()
      set.add(row.option_type)
      strikesWithBothLegs.set(row.strike as string, set)
    }

    const hasAnIncompleteStrike = Array.from(strikesWithBothLegs.values()).some((types) => types.size < 2)
    expect(hasAnIncompleteStrike).toBe(true)
  })

  it('is byte-identical for the same seed', () => {
    const again = generateScripMaster({ seed: SEED, referenceNow: REFERENCE_NOW })
    expect(again.rows).toEqual(result.rows)
  })
})
