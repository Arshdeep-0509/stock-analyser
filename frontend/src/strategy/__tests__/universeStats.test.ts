import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../constants'
import { computeUniverseStats } from '../universeStats'
import type { ScripRow } from '../../types/api'

const TODAY = 1_700_000_000

function equityRow(symbol: string, closePrice: number, token: string): ScripRow {
  return {
    exchange: 'NSE',
    instrument_name: 'EQ',
    trading_symbol: symbol,
    exchange_token: token,
    close_price: closePrice,
    expiry: '',
    company_name: symbol,
    strike: '',
    option_type: '',
  }
}

function futuresRow(symbol: string, closePrice: number, token: string, companyName: string): ScripRow {
  return {
    exchange: 'NFO',
    instrument_name: 'FUTSTK',
    trading_symbol: symbol,
    exchange_token: token,
    close_price: closePrice,
    expiry: '25-Jan-2026',
    company_name: companyName,
    strike: '',
    option_type: '',
  }
}

describe('computeUniverseStats', () => {
  const rows: ScripRow[] = [
    equityRow('RELIANCE-EQ', 2500, '1'),
    equityRow('PENNYSTOCK-EQ', 50, '2'),
    futuresRow('RELIANCE26JANFUT', 2500, '3', 'RELIANCE'),
    futuresRow('CHEAPFUT26JANFUT', 100, '4', 'CHEAPCO'),
  ]

  it('equity mode: eligible counts everything before the price filter, included after', () => {
    const stats = computeUniverseStats(rows, 'equity', DEFAULT_PARAMS, TODAY, new Set())
    expect(stats.eligible).toBe(2)
    expect(stats.included).toBe(1) // PENNYSTOCK-EQ (50) drops below the default 2000 minPrice
  })

  it('futures mode mirrors the same before/after price split', () => {
    const stats = computeUniverseStats(rows, 'futures', DEFAULT_PARAMS, TODAY, new Set())
    expect(stats.eligible).toBe(2)
    expect(stats.included).toBe(1)
  })

  it('both mode sums equity + futures', () => {
    const stats = computeUniverseStats(rows, 'both', DEFAULT_PARAMS, TODAY, new Set())
    expect(stats.eligible).toBe(4)
    expect(stats.included).toBe(2)
  })

  it('a minPrice of 0 means nothing is dropped by price', () => {
    const stats = computeUniverseStats(rows, 'both', { ...DEFAULT_PARAMS, minPrice: 0 }, TODAY, new Set())
    expect(stats.eligible).toBe(stats.included)
  })

  it('watchlist mode counts only tokens present in the watchlist', () => {
    const stats = computeUniverseStats(rows, 'watchlist', DEFAULT_PARAMS, TODAY, new Set(['1', '2']))
    expect(stats.eligible).toBe(2) // both watchlist tokens exist in the pre-price-filter universe
    expect(stats.included).toBe(1) // only token '1' (RELIANCE-EQ) survives the price filter
  })

  it('an empty watchlist has nothing eligible or included', () => {
    const stats = computeUniverseStats(rows, 'watchlist', DEFAULT_PARAMS, TODAY, new Set())
    expect(stats).toEqual({ eligible: 0, included: 0 })
  })
})
