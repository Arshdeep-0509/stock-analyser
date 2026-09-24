import { describe, expect, it } from 'vitest'
import { NSE_SYMBOLS } from '../../mock/nseSymbols'
import { SECTORS, SYMBOL_SECTOR, SYMBOL_SECTOR_FALLBACKS, getSector } from '../sectors'

describe('sectors', () => {
  it('maps every base symbol in NSE_SYMBOLS to one of the declared sectors', () => {
    for (const { symbol } of NSE_SYMBOLS) {
      expect(SYMBOL_SECTOR[symbol]).toBeDefined()
      expect(SECTORS).toContain(SYMBOL_SECTOR[symbol])
    }
  })

  it('has zero unmapped symbols falling back to Others', () => {
    expect(SYMBOL_SECTOR_FALLBACKS).toEqual([])
  })

  it('getSector defaults to Others for a symbol outside the mock universe', () => {
    expect(getSector('NOT-A-REAL-SYMBOL')).toBe('Others')
  })

  it('getSector matches SYMBOL_SECTOR for a known symbol', () => {
    expect(getSector('TCS')).toBe('IT Software')
    expect(SYMBOL_SECTOR['TCS']).toBe('IT Software')
  })
})
