import { formatISTTime } from '../../lib/formatters'
import type { ScreenerRow } from '../../store/types'
import { getInstrumentType } from './rowHelpers'

const COLUMNS = ['Time', 'Symbol', 'Type', 'Exchange', 'Signal', 'Price', 'RSI', 'Level'] as const

function rowToCells(row: ScreenerRow): string[] {
  return [
    formatISTTime(new Date(row.time * 1000)),
    row.symbol,
    getInstrumentType(row),
    row.exchange,
    row.signal,
    row.price.toFixed(2),
    Number.isNaN(row.rsi) ? '' : row.rsi.toFixed(2),
    row.level !== undefined ? row.level.toFixed(2) : '',
  ]
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** Exports rows to CSV text, respecting whatever order `rows` is already in (i.e. the caller's current sort). */
export function rowsToCsv(rows: readonly ScreenerRow[]): string {
  const lines = [COLUMNS.join(','), ...rows.map((row) => rowToCells(row).map(escapeCsvCell).join(','))]
  return lines.join('\n')
}

/** Exports rows to a Markdown table, same column set and order as the CSV export. */
export function rowsToMarkdown(rows: readonly ScreenerRow[]): string {
  const header = `| ${COLUMNS.join(' | ')} |`
  const divider = `| ${COLUMNS.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${rowToCells(row).join(' | ')} |`)
  return [header, divider, ...body].join('\n')
}

export function downloadCsv(rows: readonly ScreenerRow[], filename = 'rsi-ha-signals.csv'): void {
  const csv = rowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function copyRowsAsMarkdown(rows: readonly ScreenerRow[]): Promise<void> {
  await navigator.clipboard.writeText(rowsToMarkdown(rows))
}
