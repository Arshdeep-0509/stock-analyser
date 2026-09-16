import { describe, expect, it } from 'vitest'
import type { ScreenerRow } from '../../../store/types'
import { rowsToCsv, rowsToMarkdown } from '../exportRows'

function row(overrides: Partial<ScreenerRow> = {}): ScreenerRow {
  return {
    id: '1',
    symbol: 'RELIANCE-EQ',
    exchange: 'NSE',
    signal: 'BUY',
    price: 2500.5,
    rsi: 62.345,
    time: 1767609600,
    status: 'active',
    firstSeenAt: 0,
    lastSeenAt: 0,
    pinned: false,
    ...overrides,
  }
}

describe('rowsToCsv', () => {
  it('includes a header row and one row per signal', () => {
    const csv = rowsToCsv([row()])
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Time,Symbol,Type,Exchange,Signal,Price,RSI,Level')
    expect(lines[1]).toContain('RELIANCE-EQ')
    expect(lines[1]).toContain('2500.50')
  })

  it('renders NaN rsi and missing level as empty cells', () => {
    const csv = rowsToCsv([row({ rsi: NaN, level: undefined })])
    const cells = csv.split('\n')[1].split(',')
    expect(cells[cells.length - 2]).toBe('') // RSI
    expect(cells[cells.length - 1]).toBe('') // Level
  })
})

describe('rowsToMarkdown', () => {
  it('renders a markdown table with header, divider, and one row per signal', () => {
    const md = rowsToMarkdown([row()])
    const lines = md.split('\n')
    expect(lines[0]).toBe('| Time | Symbol | Type | Exchange | Signal | Price | RSI | Level |')
    expect(lines[1]).toMatch(/^\|( ---\s*\|)+$/)
    expect(lines[2]).toContain('RELIANCE-EQ')
  })
})
