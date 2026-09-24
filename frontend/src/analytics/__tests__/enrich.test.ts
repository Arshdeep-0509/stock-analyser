import { describe, expect, it } from 'vitest'
import type { Instrument } from '../../types/domain'
import { enrichInstrument } from '../enrich'

function makeInstrument(overrides: Partial<Instrument>): Instrument {
  return {
    symbol: 'TCS-EQ',
    token: '100001',
    exchange: 'NSE',
    instrumentName: 'EQ',
    companyName: 'TCS',
    cachedClose: 4000,
    ...overrides,
  }
}

describe('enrichInstrument', () => {
  it('decorates an instrument with its sector, keyed off companyName', () => {
    const instrument = makeInstrument({ companyName: 'TCS' })
    expect(enrichInstrument(instrument).sector).toBe('IT Software')
  })

  it('falls back to stripping "-EQ" off symbol when companyName is absent', () => {
    const instrument = makeInstrument({ symbol: 'HDFCBANK-EQ', companyName: undefined })
    expect(enrichInstrument(instrument).sector).toBe('Banks')
  })

  it('does not mutate the original instrument', () => {
    const instrument = makeInstrument({ companyName: 'INFY' })
    const enriched = enrichInstrument(instrument)
    expect(instrument).not.toHaveProperty('sector')
    expect(enriched).not.toBe(instrument)
  })

  it('defaults to Others for a company name outside the mock universe', () => {
    const instrument = makeInstrument({ companyName: 'SOME-UNKNOWN-CO' })
    expect(enrichInstrument(instrument).sector).toBe('Others')
  })
})
