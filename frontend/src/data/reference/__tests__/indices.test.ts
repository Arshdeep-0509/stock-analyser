import { describe, expect, it } from 'vitest'
import { NSE_SYMBOLS } from '../../mock/nseSymbols'
import { INDEX_PANELS } from '../indices'

const ALL_SYMBOLS = new Set(NSE_SYMBOLS.map((s) => s.symbol))

describe('indices', () => {
  it('every panel constituent exists in NSE_SYMBOLS', () => {
    for (const panel of INDEX_PANELS) {
      for (const symbol of panel.constituents) {
        expect(ALL_SYMBOLS.has(symbol)).toBe(true)
      }
    }
  })

  it('no panel is empty', () => {
    for (const panel of INDEX_PANELS) {
      expect(panel.constituents.length).toBeGreaterThan(0)
    }
  })

  it('OTHERS is disjoint from every named index', () => {
    const others = INDEX_PANELS.find((p) => p.key === 'OTHERS')
    expect(others).toBeDefined()
    const othersSet = new Set(others!.constituents)

    for (const panel of INDEX_PANELS) {
      if (panel.key === 'OTHERS') continue
      for (const symbol of panel.constituents) {
        expect(othersSet.has(symbol)).toBe(false)
      }
    }
  })

  it('OTHERS covers exactly the symbols absent from every named panel', () => {
    const named = new Set<string>()
    for (const panel of INDEX_PANELS) {
      if (panel.key === 'OTHERS') continue
      for (const symbol of panel.constituents) named.add(symbol)
    }
    const others = INDEX_PANELS.find((p) => p.key === 'OTHERS')!
    const expected = NSE_SYMBOLS.map((s) => s.symbol).filter((symbol) => !named.has(symbol))

    expect([...others.constituents].sort()).toEqual([...expected].sort())
  })

  it('renders panels in the documented dashboard order', () => {
    expect(INDEX_PANELS.map((p) => p.key)).toEqual([
      'NIFTY_50',
      'BANK_NIFTY',
      'METAL',
      'PHARMA',
      'PSU_BANK',
      'PVT_BANK',
      'AUTO',
      'FINANCIAL',
      'FMCG',
      'IT',
      'REALTY',
      'OTHERS',
    ])
  })

  it('BANK NIFTY and FINANCIAL overlap (many-to-many, not a single field)', () => {
    const bankNifty = new Set(INDEX_PANELS.find((p) => p.key === 'BANK_NIFTY')!.constituents)
    const financial = INDEX_PANELS.find((p) => p.key === 'FINANCIAL')!.constituents
    expect(financial.some((symbol) => bankNifty.has(symbol))).toBe(true)
  })
})
