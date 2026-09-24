/**
 * Test harness: a REAL MockMarketDataSource + the REAL screener store, pinned
 * to a fixed seed and a frozen clock, with the scan run in-thread (the same
 * runFullScan() the Web Worker runs) instead of through Comlink. Used by the
 * golden master, the integration suite and the invariant suite — anything
 * that must exercise the actual pipeline end to end, deterministically.
 *
 * Never used by component tests (those seed a store with fixture rows).
 */
import { DEFAULT_SEED, MockMarketDataSource } from '../data/mock'
import { runFullScan } from '../features/rsi-ha/scanner'
import { createScreenerStore, type ScreenerStore } from '../store/screenerStore'
import type { ScreenerRow } from '../store/types'

/** 2026-01-05 (a Monday) 13:00 IST — mid-session, so the last bar is a real intraday bar, not the close. */
export const SESSION_NOW = 1767598200
/** 2026-01-05 16:10 IST — after the close. The instant the older store/acceptance tests use. */
export const AFTER_CLOSE_NOW = 1767609600
export const BAR_SECONDS = 300

export interface MockOptions {
  seed?: number
  now?: number
  /** Share of requests that fail (0..1). Defaults to 0 so a scan's output never depends on which requests the RNG failed. */
  failureRate?: number
}

export function makeMock(options: MockOptions = {}): MockMarketDataSource {
  const source = new MockMarketDataSource(options.seed ?? DEFAULT_SEED, { mode: 'fixed', startTimestamp: options.now ?? SESSION_NOW })
  source.setFastForward(true)
  source.setFailureRate(options.failureRate ?? 0)
  return source
}

/** The real store over `source`, reading `source`'s own (fixed) clock, scanning in-thread. A long poll interval keeps the scheduler out of the way unless a test drives it. */
export function makeScreener(source: MockMarketDataSource, pollIntervalMs = 60 * 60 * 1000): ScreenerStore {
  return createScreenerStore({ dataSource: source, now: () => source.getNow(), runScan: runFullScan, pollIntervalMs })
}

/** loadUniverse() then one full scan — what start() does, minus the scheduler. */
export async function scanOnce(store: ScreenerStore, options?: { immediateReplace?: boolean }): Promise<void> {
  if (store.getState().universe.length === 0) await store.getState().loadUniverse()
  await store.getState().runScanNow(options)
}

/** The strategy-facing content of a row — no bookkeeping (status / firstSeenAt / pinned), ordered by id so two scans compare regardless of emission order. */
export function strategyView(rows: readonly ScreenerRow[]): {
  id: string
  symbol: string
  exchange: string
  signal: string
  price: number
  rsi: number
  time: number
  level: number | null
  streak: string
  derivedFrom: string | null
}[] {
  return rows
    .map((r) => ({
      id: r.id,
      symbol: r.symbol,
      exchange: r.exchange,
      signal: r.signal,
      price: r.price,
      rsi: r.rsi,
      time: r.time,
      level: r.level ?? null,
      streak: (r.haStreak ?? []).map((c) => (c === 'green' ? 'G' : 'R')).join(''),
      derivedFrom: r.derivedFrom ?? null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
