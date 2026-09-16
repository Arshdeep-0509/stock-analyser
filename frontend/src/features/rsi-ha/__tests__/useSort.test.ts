import { describe, expect, it } from 'vitest'
import { compareRows, type SortableColumn, type SortRule } from '../useSort'

interface Row {
  symbol: string
  rsi: number
  price: number
}

const columns: Record<string, SortableColumn<Row>> = {
  symbol: { key: 'symbol', sortValue: (r) => r.symbol },
  rsi: { key: 'rsi', sortValue: (r) => r.rsi },
  price: { key: 'price', sortValue: (r) => r.price },
}

function sortRows(rows: Row[], rules: SortRule[]): Row[] {
  return rows.slice().sort((a, b) => compareRows(a, b, rules, columns))
}

describe('compareRows', () => {
  it('sorts numeric columns ascending and descending', () => {
    const rows: Row[] = [{ symbol: 'C', rsi: 30, price: 1 }, { symbol: 'A', rsi: 10, price: 1 }, { symbol: 'B', rsi: 20, price: 1 }]

    expect(sortRows(rows, [{ key: 'rsi', direction: 'asc' }]).map((r) => r.symbol)).toEqual(['A', 'B', 'C'])
    expect(sortRows(rows, [{ key: 'rsi', direction: 'desc' }]).map((r) => r.symbol)).toEqual(['C', 'B', 'A'])
  })

  it('sorts string columns via localeCompare', () => {
    const rows: Row[] = [{ symbol: 'ZEE', rsi: 0, price: 0 }, { symbol: 'ASIANPAINT', rsi: 0, price: 0 }, { symbol: 'MRF', rsi: 0, price: 0 }]
    expect(sortRows(rows, [{ key: 'symbol', direction: 'asc' }]).map((r) => r.symbol)).toEqual(['ASIANPAINT', 'MRF', 'ZEE'])
  })

  it('NaN RSI values always sort last, regardless of direction', () => {
    const rows: Row[] = [
      { symbol: 'HAS_NAN', rsi: NaN, price: 0 },
      { symbol: 'HIGH', rsi: 80, price: 0 },
      { symbol: 'LOW', rsi: 20, price: 0 },
    ]

    const asc = sortRows(rows, [{ key: 'rsi', direction: 'asc' }])
    expect(asc.map((r) => r.symbol)).toEqual(['LOW', 'HIGH', 'HAS_NAN'])

    const desc = sortRows(rows, [{ key: 'rsi', direction: 'desc' }])
    expect(desc.map((r) => r.symbol)).toEqual(['HIGH', 'LOW', 'HAS_NAN'])
  })

  it('keeps multiple NaN rows stable relative to each other, still trailing all real numbers', () => {
    const rows: Row[] = [
      { symbol: 'NAN_A', rsi: NaN, price: 0 },
      { symbol: 'REAL', rsi: 50, price: 0 },
      { symbol: 'NAN_B', rsi: NaN, price: 0 },
    ]

    const result = sortRows(rows, [{ key: 'rsi', direction: 'asc' }])
    expect(result[0].symbol).toBe('REAL')
    expect(new Set(result.slice(1).map((r) => r.symbol))).toEqual(new Set(['NAN_A', 'NAN_B']))
  })

  it('applies multi-sort rules in order: primary rule first, secondary breaks ties', () => {
    const rows: Row[] = [
      { symbol: 'A', rsi: 50, price: 300 },
      { symbol: 'B', rsi: 50, price: 100 },
      { symbol: 'C', rsi: 40, price: 500 },
    ]

    const result = sortRows(rows, [
      { key: 'rsi', direction: 'desc' },
      { key: 'price', direction: 'asc' },
    ])

    expect(result.map((r) => r.symbol)).toEqual(['B', 'A', 'C'])
  })

  it('a NaN primary-sort value defers to the secondary rule among NaN rows only when both are NaN (still trailing non-NaN rows)', () => {
    const rows: Row[] = [
      { symbol: 'NAN_HIGH_PRICE', rsi: NaN, price: 900 },
      { symbol: 'REAL', rsi: 10, price: 1 },
      { symbol: 'NAN_LOW_PRICE', rsi: NaN, price: 100 },
    ]

    const result = sortRows(rows, [
      { key: 'rsi', direction: 'asc' },
      { key: 'price', direction: 'asc' },
    ])

    expect(result[0].symbol).toBe('REAL')
    expect(result.slice(1).map((r) => r.symbol)).toEqual(['NAN_LOW_PRICE', 'NAN_HIGH_PRICE'])
  })
})
