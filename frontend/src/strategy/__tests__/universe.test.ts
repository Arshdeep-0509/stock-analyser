import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../constants'
import { loadFnoAtmOptions, loadFnoFuturesUniverse, loadNseEquityUniverse } from '../universe'
import type { ScripRow } from '../../types/api'

const TODAY = Date.UTC(2026, 0, 1) / 1000 // 1-Jan-2026, matches the "%d-%b-%Y" expiry fixtures below

function equityRow(symbol: string, closePrice: number | string, token: string): ScripRow {
  return {
    exchange: 'NSE',
    instrument_name: 'EQ',
    trading_symbol: symbol,
    exchange_token: token,
    close_price: closePrice,
    expiry: '',
    company_name: symbol.replace('-EQ', ''),
    strike: '',
    option_type: '',
  }
}

function futuresRow(symbol: string, closePrice: number, token: string, companyName: string, expiry: string): ScripRow {
  return {
    exchange: 'NFO',
    instrument_name: 'FUTSTK',
    trading_symbol: symbol,
    exchange_token: token,
    close_price: closePrice,
    expiry,
    company_name: companyName,
    strike: '',
    option_type: '',
  }
}

function optionRow(symbol: string, token: string, companyName: string, expiry: string, strike: number, optionType: 'CE' | 'PE'): ScripRow {
  return {
    exchange: 'NFO',
    instrument_name: 'OPTSTK',
    trading_symbol: symbol,
    exchange_token: token,
    close_price: 0,
    expiry,
    company_name: companyName,
    strike,
    option_type: optionType,
  }
}

describe('loadNseEquityUniverse', () => {
  it('drops non-NSE and non-EQ rows, then filters by minPrice', () => {
    const rows: ScripRow[] = [
      equityRow('RELIANCE-EQ', 2500, '1'),
      equityRow('PENNY-EQ', 100, '2'),
      { ...equityRow('SOMEFUT', 5000, '3'), exchange: 'NFO', instrument_name: 'FUTSTK' },
    ]
    expect(loadNseEquityUniverse(rows, DEFAULT_PARAMS)).toEqual([{ symbol: 'RELIANCE-EQ', token: '1', exchange: 'NSE' }])
  })

  it('coerces a string close_price and drops unparseable ones (NaN < any minPrice)', () => {
    const rows: ScripRow[] = [equityRow('A-EQ', '2500.50', '1'), equityRow('B-EQ', 'not-a-number', '2')]
    expect(loadNseEquityUniverse(rows, DEFAULT_PARAMS)).toEqual([{ symbol: 'A-EQ', token: '1', exchange: 'NSE' }])
  })
})

describe('loadFnoFuturesUniverse', () => {
  it('dedupes to the nearest-expiry contract per company, filtering price AFTER dedupe', () => {
    const rows: ScripRow[] = [
      futuresRow('RELIANCE26FEBFUT', 2500, '1', 'RELIANCE', '25-Feb-2026'),
      futuresRow('RELIANCE26JANFUT', 2500, '2', 'RELIANCE', '25-Jan-2026'), // nearer expiry, same company
      futuresRow('TCS26JANFUT', 100, '3', 'TCS', '25-Jan-2026'), // below minPrice, but only checked after dedupe
    ]
    const result = loadFnoFuturesUniverse(rows, DEFAULT_PARAMS, TODAY)
    expect(result).toEqual([{ symbol: 'RELIANCE26JANFUT', token: '2', exchange: 'NFO' }])
  })

  it('excludes already-expired contracts', () => {
    const rows: ScripRow[] = [futuresRow('OLD26JANFUT', 2500, '1', 'OLDCO', '25-Dec-2025')]
    expect(loadFnoFuturesUniverse(rows, DEFAULT_PARAMS, TODAY)).toEqual([])
  })

  it('excludes rows with an unparseable expiry or price', () => {
    const rows: ScripRow[] = [
      futuresRow('BAD1FUT', 2500, '1', 'BAD1', 'not-a-date'),
      futuresRow('BAD2FUT', NaN, '2', 'BAD2', '25-Jan-2026'),
    ]
    expect(loadFnoFuturesUniverse(rows, DEFAULT_PARAMS, TODAY)).toEqual([])
  })
})

describe('loadFnoAtmOptions', () => {
  it('picks the strike closest to spot (the cached equity close_price) and pairs CE+PE', () => {
    const rows: ScripRow[] = [
      equityRow('RELIANCE-EQ', 2500, '1'),
      optionRow('RELIANCE26JAN2400CE', '10', 'RELIANCE', '25-Jan-2026', 2400, 'CE'),
      optionRow('RELIANCE26JAN2400PE', '11', 'RELIANCE', '25-Jan-2026', 2400, 'PE'),
      optionRow('RELIANCE26JAN2600CE', '12', 'RELIANCE', '25-Jan-2026', 2600, 'CE'), // further from spot
      optionRow('RELIANCE26JAN2600PE', '13', 'RELIANCE', '25-Jan-2026', 2600, 'PE'),
    ]
    const atmMap = loadFnoAtmOptions(rows, DEFAULT_PARAMS, TODAY)
    expect(atmMap).toEqual({
      RELIANCE: { CE: ['RELIANCE26JAN2400CE', '10'], PE: ['RELIANCE26JAN2400PE', '11'] },
    })
  })

  it('skips a company whose spot is below minPrice', () => {
    const rows: ScripRow[] = [
      equityRow('PENNY-EQ', 100, '1'),
      optionRow('PENNY26JAN100CE', '10', 'PENNY', '25-Jan-2026', 100, 'CE'),
      optionRow('PENNY26JAN100PE', '11', 'PENNY', '25-Jan-2026', 100, 'PE'),
    ]
    expect(loadFnoAtmOptions(rows, DEFAULT_PARAMS, TODAY)).toEqual({})
  })

  it('skips a company with no equity spot price at all', () => {
    const rows: ScripRow[] = [optionRow('NOSPOT26JAN100CE', '10', 'NOSPOT', '25-Jan-2026', 100, 'CE')]
    expect(loadFnoAtmOptions(rows, DEFAULT_PARAMS, TODAY)).toEqual({})
  })

  it('skips a company missing either leg of the pair (CE with no matching PE)', () => {
    const rows: ScripRow[] = [equityRow('RELIANCE-EQ', 2500, '1'), optionRow('RELIANCE26JAN2500CE', '10', 'RELIANCE', '25-Jan-2026', 2500, 'CE')]
    expect(loadFnoAtmOptions(rows, DEFAULT_PARAMS, TODAY)).toEqual({})
  })

  it('uses only the nearest-expiry chain per company when multiple expiries exist', () => {
    const rows: ScripRow[] = [
      equityRow('RELIANCE-EQ', 2500, '1'),
      optionRow('RELIANCE26FEB2500CE', '20', 'RELIANCE', '25-Feb-2026', 2500, 'CE'),
      optionRow('RELIANCE26FEB2500PE', '21', 'RELIANCE', '25-Feb-2026', 2500, 'PE'),
      optionRow('RELIANCE26JAN2500CE', '10', 'RELIANCE', '25-Jan-2026', 2500, 'CE'),
      optionRow('RELIANCE26JAN2500PE', '11', 'RELIANCE', '25-Jan-2026', 2500, 'PE'),
    ]
    const atmMap = loadFnoAtmOptions(rows, DEFAULT_PARAMS, TODAY)
    expect(atmMap.RELIANCE).toEqual({ CE: ['RELIANCE26JAN2500CE', '10'], PE: ['RELIANCE26JAN2500PE', '11'] })
  })

  it('excludes already-expired option chains', () => {
    const rows: ScripRow[] = [
      equityRow('RELIANCE-EQ', 2500, '1'),
      optionRow('OLDCE', '10', 'RELIANCE', '25-Dec-2025', 2500, 'CE'),
      optionRow('OLDPE', '11', 'RELIANCE', '25-Dec-2025', 2500, 'PE'),
    ]
    expect(loadFnoAtmOptions(rows, DEFAULT_PARAMS, TODAY)).toEqual({})
  })
})
