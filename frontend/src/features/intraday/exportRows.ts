import { formatISTTime } from '../../lib/formatters'
import type { IntradayRow } from '../../types/domain'

const COLUMNS = ['Rank', 'Symbol', 'Sector', 'CMP', 'Chg %', '3 Day Chg %', 'Strength', 'Time', 'Intraday', 'Breakout'] as const

function numOrBlank(value: number, decimals = 2): string {
  return Number.isNaN(value) ? '' : value.toFixed(decimals)
}

/** Rank is the row's position in the ARRAY AS GIVEN — the caller passes it already sorted/filtered/topN-limited, exactly the view on screen. */
function rowToCells(row: IntradayRow, rank: number): string[] {
  return [
    String(rank),
    row.symbol,
    row.sector,
    numOrBlank(row.cmp),
    numOrBlank(row.changePct),
    numOrBlank(row.change3dPct),
    numOrBlank(row.strength, 2),
    Number.isNaN(row.lastTickAt) ? '' : formatISTTime(new Date(row.lastTickAt * 1000)),
    row.intradayDir,
    row.breakout ?? '',
  ]
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** Exports rows to CSV text, respecting whatever order `rows` is already in (i.e. the caller's current sort, filters, and Top-N limit). */
export function rowsToCsv(rows: readonly IntradayRow[]): string {
  const lines = [COLUMNS.join(','), ...rows.map((row, i) => rowToCells(row, i + 1).map(escapeCsvCell).join(','))]
  return lines.join('\n')
}

export function downloadCsv(rows: readonly IntradayRow[], filename = 'intraday-top-strength.csv'): void {
  const csv = rowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
