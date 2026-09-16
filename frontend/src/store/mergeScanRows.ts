import type { ScannedRow } from '../features/rsi-ha/scanner'
import type { ScreenerRow } from './types'

function dedupeKey(row: Pick<ScannedRow, 'symbol' | 'signal'>): string {
  return `${row.symbol}:${row.signal}`
}

export interface MergeScanRowsResult {
  rows: ScreenerRow[]
  /** Rows that just left `rows` for good this pass — append these to history. */
  expired: ScreenerRow[]
  /** Rows that are brand new this pass (no prior row for that symbol+signal) — also worth logging to history. */
  created: ScreenerRow[]
}

/**
 * Merges freshly computed SignalRows for a set of just-(re)scanned symbols
 * into the existing store rows:
 *  - a symbol that keeps satisfying the same condition (same symbol +
 *    signal kind) updates its existing row in place (new price/rsi/time,
 *    same `id`/`firstSeenAt`, bumped `lastSeenAt`) rather than spawning a
 *    duplicate
 *  - a condition that stops appearing doesn't vanish immediately: it goes
 *    'active' -> 'fading' -> (next time still missing) 'expired', at which
 *    point it leaves `rows` and is returned in `expired` for the caller to
 *    append to history
 *  - a brand new condition is added as a fresh 'active' row
 *  - rows belonging to symbols NOT part of this particular scan pass
 *    (relevant for a single-symbol tick-driven rescan) are left untouched —
 *    only symbols actually in `scannedSymbols` can fade or expire
 */
export function mergeScanRows(
  existing: readonly ScreenerRow[],
  incoming: readonly ScannedRow[],
  scannedSymbols: ReadonlySet<string>,
  now: number,
): MergeScanRowsResult {
  const incomingByKey = new Map(incoming.map((row) => [dedupeKey(row), row]))
  const matchedKeys = new Set<string>()

  const rows: ScreenerRow[] = []
  const expired: ScreenerRow[] = []
  const created: ScreenerRow[] = []

  for (const row of existing) {
    const key = dedupeKey(row)
    const match = incomingByKey.get(key)

    if (match) {
      matchedKeys.add(key)
      // Pinning is a store/UI concept the engine knows nothing about, so it
      // survives an update-in-place — unlike everything else, which is
      // fully replaced by the freshly computed values.
      rows.push({ ...match, id: row.id, status: 'active', firstSeenAt: row.firstSeenAt, lastSeenAt: now, pinned: row.pinned })
      continue
    }

    if (!scannedSymbols.has(row.symbol)) {
      rows.push(row)
      continue
    }

    if (row.status === 'active') {
      rows.push({ ...row, status: 'fading', lastSeenAt: row.lastSeenAt })
    } else {
      expired.push({ ...row, status: 'expired', lastSeenAt: now })
    }
  }

  for (const [key, row] of incomingByKey) {
    if (matchedKeys.has(key)) continue
    const freshRow: ScreenerRow = { ...row, status: 'active', firstSeenAt: now, lastSeenAt: now, pinned: false }
    rows.push(freshRow)
    created.push(freshRow)
  }

  return { rows, expired, created }
}
