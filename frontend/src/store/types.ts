import type { ScanError, ScannedRow } from '../features/rsi-ha/scanner'

export type { ScanError }

export type UniverseMode = 'equity' | 'futures' | 'both' | 'watchlist'
export type ScanState = 'idle' | 'loading-universe' | 'scanning' | 'done' | 'error'
export type RowStatus = 'active' | 'fading' | 'expired'

export interface ScanProgress {
  done: number
  total: number
}

/**
 * A ScannedRow (the strategy-engine output plus its HA sparkline, see
 * scanner.ts) plus store-level bookkeeping for dedupe/fade-out/pinning.
 * `id` stays stable for the row's whole active lifetime even though a
 * freshly (re)computed SignalRow gets a new id every scan (it's derived
 * from the latest closed candle's time) — see mergeScanRows().
 */
export interface ScreenerRow extends ScannedRow {
  status: RowStatus
  firstSeenAt: number
  lastSeenAt: number
  pinned: boolean
}
