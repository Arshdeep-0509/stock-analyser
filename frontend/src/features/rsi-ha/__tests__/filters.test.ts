import { describe, expect, it } from 'vitest'
import type { ScreenerRow } from '../../../store/types'
import type { SignalKind } from '../../../types/domain'
import { rowsToCsv } from '../exportRows'
import { getInstrumentType } from '../rowHelpers'
import { applyFilters, fuzzyMatch, type TableFilters } from '../useTableFilters'

// NaN-last sorting in both directions and multi-key ordering are covered in
// useSort.test.ts; this file covers filtering and CSV output.

const NO_FILTERS: TableFilters = { search: '', signals: [], exchanges: [], instrumentTypes: [], rsiMin: 0, rsiMax: 100, minPrice: 0 }

let n = 0
function row(overrides: Partial<ScreenerRow> = {}): ScreenerRow {
  n += 1
  return {
    id: `r${n}`,
    symbol: `SYM${n}-EQ`,
    exchange: 'NSE',
    signal: 'BUY',
    price: 2500,
    rsi: 62,
    time: 1767598200,
    status: 'active',
    firstSeenAt: 1767598200,
    lastSeenAt: 1767598200,
    pinned: false,
    ...overrides,
  }
}

const filter = (rows: ScreenerRow[], patch: Partial<TableFilters>): ScreenerRow[] => applyFilters(rows, { ...NO_FILTERS, ...patch }, getInstrumentType)
const symbols = (rows: ScreenerRow[]): string[] => rows.map((r) => r.symbol)

describe('fuzzyMatch', () => {
  it('matches an in-order subsequence, case as given', () => {
    expect(fuzzyMatch('REL', 'RELIANCE24SEPFUT')).toBe(true)
    expect(fuzzyMatch('RSF', 'RELIANCE24SEPFUT')).toBe(true)
    expect(fuzzyMatch('FSR', 'RELIANCE24SEPFUT')).toBe(false)
    expect(fuzzyMatch('', 'ANYTHING')).toBe(true)
  })
})

describe('applyFilters', () => {
  it('search is fuzzy and case-insensitive: "rel" finds RELIANCE24SEPFUT', () => {
    const rows = [row({ symbol: 'RELIANCE24SEPFUT', exchange: 'NFO' }), row({ symbol: 'TCS-EQ' })]
    expect(symbols(filter(rows, { search: 'rel' }))).toEqual(['RELIANCE24SEPFUT'])
    expect(symbols(filter(rows, { search: '  rel  ' }))).toEqual(['RELIANCE24SEPFUT'])
  })

  it('signal chips keep only the selected kinds; none selected keeps all', () => {
    const kinds: SignalKind[] = ['BUY', 'SELL', 'BREAKOUT-UP', 'CE Buy']
    const rows = kinds.map((signal) => row({ signal }))
    expect(filter(rows, { signals: ['SELL', 'CE Buy'] }).map((r) => r.signal)).toEqual(['SELL', 'CE Buy'])
    expect(filter(rows, {})).toHaveLength(4)
  })

  it('exchange and instrument kind filter independently', () => {
    const rows = [row({ exchange: 'NSE', signal: 'BUY' }), row({ exchange: 'NFO', signal: 'BUY' }), row({ exchange: 'NFO', signal: 'CE Buy' })]
    expect(filter(rows, { exchanges: ['NFO'] })).toHaveLength(2)
    expect(filter(rows, { instrumentTypes: ['FUT'] }).map(getInstrumentType)).toEqual(['FUT'])
    expect(filter(rows, { instrumentTypes: ['EQ', 'CE'] }).map(getInstrumentType)).toEqual(['EQ', 'CE'])
  })

  it('the price floor is inclusive', () => {
    const rows = [row({ price: 1999.99 }), row({ price: 2000 }), row({ price: 2500 })]
    expect(filter(rows, { minPrice: 2000 }).map((r) => r.price)).toEqual([2000, 2500])
  })

  it('the RSI range is inclusive at both ends', () => {
    const rows = [row({ rsi: 59.99 }), row({ rsi: 60 }), row({ rsi: 65 }), row({ rsi: 65.01 })]
    expect(filter(rows, { rsiMin: 60, rsiMax: 65 }).map((r) => r.rsi)).toEqual([60, 65])
  })

  it('a NaN-RSI row is INCLUDED when no RSI range is active', () => {
    const rows = [row({ rsi: NaN }), row({ rsi: 62 })]
    expect(filter(rows, {})).toHaveLength(2)
  })

  it('a NaN-RSI row is EXCLUDED when an RSI range is active — "RSI between 60 and 65" cannot include a row with no RSI', () => {
    const rows = [row({ rsi: NaN, symbol: 'NORSI-EQ' }), row({ rsi: 62, symbol: 'IN-EQ' })]
    expect(symbols(filter(rows, { rsiMin: 60, rsiMax: 65 }))).toEqual(['IN-EQ'])
    expect(symbols(filter(rows, { rsiMin: 1 }))).toEqual(['IN-EQ'])
    expect(symbols(filter(rows, { rsiMax: 99 }))).toEqual(['IN-EQ'])
  })

  it('never mutates or reorders its input', () => {
    const rows = [row({ price: 1 }), row({ price: 3000 }), row({ price: 2 })]
    const before = rows.slice()
    const out = filter(rows, { minPrice: 2 })
    expect(rows).toEqual(before)
    expect(out.map((r) => r.price)).toEqual([3000, 2])
  })
})

describe('rowsToCsv', () => {
  const HEADER = 'Time,Symbol,Type,Exchange,Signal,Price,RSI,Level'

  it('emits the header, then one line per row in the given order', () => {
    const csv = rowsToCsv([row({ symbol: 'B-EQ' }), row({ symbol: 'A-EQ' })])
    const lines = csv.split('\n')
    expect(lines[0]).toBe(HEADER)
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain(',B-EQ,')
    expect(lines[2]).toContain(',A-EQ,')
  })

  it('renders NaN RSI and a missing level as empty cells — never "NaN" or "undefined"', () => {
    const line = rowsToCsv([row({ rsi: NaN, level: undefined })]).split('\n')[1]
    expect(line).not.toMatch(/NaN|undefined/)
    expect(line.endsWith(',,')).toBe(true)
  })

  it('quotes a cell only when it contains a comma, quote or newline, doubling inner quotes', () => {
    const line = rowsToCsv([row({ symbol: 'A,"B"\nC' })]).split('\n').slice(1).join('\n')
    expect(line).toContain('"A,""B""\nC"')
  })

  it('does not quote or alter ordinary cells (no over-escaping)', () => {
    const line = rowsToCsv([row({ symbol: 'RELIANCE24SEPFUT', exchange: 'NFO', signal: 'BREAKOUT-UP', price: 2500, rsi: 61.234, level: 2490.5 })]).split('\n')[1]
    expect(line).toBe('13:00:00,RELIANCE24SEPFUT,FUT,NFO,BREAKOUT-UP,2500.00,61.23,2490.50')
  })
})
