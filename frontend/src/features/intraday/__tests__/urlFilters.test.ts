import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTERS, type IntradayFilters } from '../../../store/intradayStore'
import { filtersFromSearchParams, searchParamsFromFilters } from '../urlFilters'

describe('filtersFromSearchParams', () => {
  it('returns an empty patch for an empty URL, leaving the store at its own defaults', () => {
    expect(filtersFromSearchParams(new URLSearchParams())).toEqual({})
  })

  it('parses every canonical dimension', () => {
    const params = new URLSearchParams('sector=Banks&index=IT&dir=up&minStrength=2.5&breakout=1&smartMoney=1&q=RELIANCE')
    expect(filtersFromSearchParams(params)).toEqual({
      sector: 'Banks',
      index: 'IT',
      direction: 'up',
      minStrength: 2.5,
      breakoutOnly: true,
      smartMoneyOnly: true,
      q: 'RELIANCE',
    })
  })

  it('rejects an invalid index key and an invalid direction rather than passing them through unchecked', () => {
    const params = new URLSearchParams('index=NOT_REAL&dir=sideways')
    const patch = filtersFromSearchParams(params)
    expect(patch.index).toBeUndefined()
    expect(patch.direction).toBeUndefined()
  })

  it('falls back to the default minStrength when the value is not a finite number', () => {
    const params = new URLSearchParams('minStrength=not-a-number')
    expect(filtersFromSearchParams(params).minStrength).toBe(DEFAULT_FILTERS.minStrength)
  })
})

describe('searchParamsFromFilters', () => {
  it('omits every dimension at its default value — a fully-default filter set produces an empty query', () => {
    const result = searchParamsFromFilters(DEFAULT_FILTERS, new URLSearchParams())
    expect(result.toString()).toBe('')
  })

  it('round-trips every non-default dimension', () => {
    const filters: IntradayFilters = {
      ...DEFAULT_FILTERS,
      sector: 'Banks',
      index: 'IT',
      direction: 'down',
      minStrength: 1.5,
      breakoutOnly: true,
      smartMoneyOnly: true,
      q: 'HDFC',
    }
    const params = searchParamsFromFilters(filters, new URLSearchParams())
    const roundTripped = filtersFromSearchParams(params)
    expect(roundTripped).toEqual({
      sector: 'Banks',
      index: 'IT',
      direction: 'down',
      minStrength: 1.5,
      breakoutOnly: true,
      smartMoneyOnly: true,
      q: 'HDFC',
    })
  })

  it('never serialises `tokens` — it is deliberately not one of the 7 shareable dimensions', () => {
    const filters: IntradayFilters = { ...DEFAULT_FILTERS, tokens: ['T1', 'T2'] }
    const params = searchParamsFromFilters(filters, new URLSearchParams())
    expect(params.toString()).toBe('')
  })

  it('preserves unrelated existing query params', () => {
    const previous = new URLSearchParams('utm_source=test')
    const params = searchParamsFromFilters({ ...DEFAULT_FILTERS, sector: 'Banks' }, previous)
    expect(params.get('utm_source')).toBe('test')
    expect(params.get('sector')).toBe('Banks')
  })
})
