import type { MarketDataSource } from '../../data/MarketDataSource'
import { analyzeCandles } from '../../strategy/analyzeCandles'
import { addOptionRecommendations } from '../../strategy/optionLegs'
import { checkBreakout, checkSignal, selectVisibleRows } from '../../strategy/signals'
import { parseIntervalMinutes, type StrategyParams } from '../../strategy/constants'
import { BASE_INTERVAL_MINUTES, resampleCandles } from '../../strategy/resampleCandles'
import type { AtmMap, UniverseEntry } from '../../strategy/universe'
import type { SignalRow } from '../../types/domain'

export interface ScanError {
  symbol: string
  message: string
}

/**
 * A SignalRow plus the last 6 Heikin-Ashi colours leading up to it, for the
 * UI's streak sparkline. This is additive, UI-facing metadata computed by
 * the engine (it already has the HA series in hand) — not part of the
 * frozen SignalRow shape from STRATEGY-CONTRACT.md, so every SignalRow
 * consumer that doesn't care about it keeps working unchanged. Absent for
 * CE/PE Buy rows, which don't have their own HA series (see
 * addOptionRecommendations' PARITY note).
 */
export interface ScannedRow extends SignalRow {
  haStreak?: ('green' | 'red')[]
  /**
   * The upstream instrument token — also additive/UI-facing, not part of
   * the frozen SignalRow shape. Lets the UI key live ticks (which arrive
   * keyed by token, not symbol) back to the row that fired them. For a
   * CE/PE Buy row this is the OPTION's own token, resolved via atmMap in
   * runFullScan(), not the underlying's.
   */
  token?: string
}

export interface ScanWatchlistResult {
  rows: ScannedRow[]
  errors: ScanError[]
}

export interface ScanResult extends ScanWatchlistResult {
  visibleRows: ScannedRow[]
}

export type ScanProgressListener = (done: number, total: number) => void

const PROGRESS_EVERY = 10
/**
 * How many fetchHistoricalCandles() calls are in flight at once. Bounded,
 * not unlimited, so this still behaves like a real client would against a
 * real rate-limited backend. Sized so 400 symbols at the mock's 80-250ms
 * simulated per-call latency clears the "under 2s" scan budget with margin
 * for the real Web Worker path's Comlink message-passing overhead, which
 * this number was tuned against on the main thread only (see
 * __tests__/perf.scratch.test.ts) — not measured through an actual worker.
 */
const CONCURRENCY = 50

interface PerEntryResult {
  rows: ScannedRow[]
  error: ScanError | null
}

const HA_STREAK_LENGTH = 6

/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once,
 * returning results in the SAME order as `items` regardless of which
 * call actually finishes first — completion order must never leak into
 * the output, or a scan would stop being reproducible for a given seed.
 */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    for (;;) {
      const current = nextIndex
      nextIndex += 1
      if (current >= items.length) return
      const item = items[current]
      results[current] = await fn(item, current)
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

/**
 * Transliteration of scan_watchlist() (mastertrust_rsi_ha_screener.py lines
 * 452-489): for every instrument, fetch its candles, run RSI + Heikin-Ashi,
 * then independently check for a signal AND a breakout, pushing a row for
 * each when present — one symbol can contribute two rows in the same scan.
 * A per-symbol exception is recorded and the scan continues; it never
 * aborts the whole watchlist, matching the Python's per-symbol try/except.
 *
 * This function contains no maths of its own — candles come from
 * `dataSource` (already closed/normalised, per the MarketDataSource
 * contract), and every number on a row comes from src/strategy/.
 *
 * Unlike the Python (which fetches sequentially, one blocking HTTP call at
 * a time), symbols are fetched with bounded concurrency — the Python's
 * sequential order is an artifact of using blocking requests.get(), not a
 * strategy decision, and 400 sequential round-trips would blow the "under
 * 2s" scan budget even against a mock. Output order is still deterministic
 * (indexed by the input universe, never by completion order), so a given
 * seed still produces a byte-identical result regardless of scheduling.
 */
export async function scanWatchlist(
  universe: readonly UniverseEntry[],
  dataSource: Pick<MarketDataSource, 'fetchHistoricalCandles'>,
  params: StrategyParams,
  onProgress?: ScanProgressListener,
): Promise<ScanWatchlistResult> {
  let completed = 0

  const perEntry = await mapWithConcurrency(universe, CONCURRENCY, async (entry): Promise<PerEntryResult> => {
    const rowsForEntry: ScannedRow[] = []
    let error: ScanError | null = null

    try {
      // Always fetch the mock's native 5-minute base series (see
      // MockMarketDataSource.fetchHistoricalCandles's comment on why), then
      // resample up to whatever the user's candleInterval param asks for.
      const baseCandles = await dataSource.fetchHistoricalCandles(entry.token, entry.exchange, '5minute', 5)
      const targetMinutes = parseIntervalMinutes(params.candleInterval)
      const candles = targetMinutes === BASE_INTERVAL_MINUTES ? baseCandles : resampleCandles(baseCandles, targetMinutes)

      if (candles.length > 0) {
        const analyzed = analyzeCandles(candles, params)
        const last = candles[candles.length - 1]
        const lastRsi = analyzed[analyzed.length - 1].rsi
        const haStreak = analyzed.slice(-HA_STREAK_LENGTH).map((c) => c.haColor)

        const signal = checkSignal(analyzed, params)
        if (signal) {
          rowsForEntry.push({
            id: `${entry.token}-${signal}-${last.time}`,
            symbol: entry.symbol,
            exchange: entry.exchange,
            signal,
            price: last.close,
            rsi: lastRsi,
            time: last.time,
            haStreak,
            token: entry.token,
          })
        }

        const breakout = checkBreakout(candles, params)
        if (breakout.signal) {
          rowsForEntry.push({
            id: `${entry.token}-${breakout.signal}-${last.time}`,
            symbol: entry.symbol,
            exchange: entry.exchange,
            signal: breakout.signal,
            price: last.close,
            rsi: lastRsi,
            time: last.time,
            level: breakout.level ?? undefined,
            haStreak,
            token: entry.token,
          })
        }
      }
    } catch (err) {
      error = { symbol: entry.symbol, message: err instanceof Error ? err.message : String(err) }
    }

    completed += 1
    if (onProgress && (completed % PROGRESS_EVERY === 0 || completed === universe.length)) {
      onProgress(completed, universe.length)
    }

    return { rows: rowsForEntry, error }
  })

  const rows = perEntry.flatMap((entry) => entry.rows)
  const errors: ScanError[] = []
  for (const entry of perEntry) {
    if (entry.error) errors.push(entry.error)
  }

  return { rows, errors }
}

/**
 * Transliteration of the __main__ orchestration (lines 504-518): run
 * scan_watchlist(), derive CE/PE Buy recommendations from the NSE rows via
 * add_option_recommendations(), then apply the visibility rule. Equity NSE
 * rows are still computed (needed to derive the option legs) but are
 * filtered out of `visibleRows` — see selectVisibleRows().
 */
export async function runFullScan(
  universe: readonly UniverseEntry[],
  dataSource: Pick<MarketDataSource, 'fetchHistoricalCandles'>,
  atmMap: AtmMap,
  params: StrategyParams,
  onProgress?: ScanProgressListener,
): Promise<ScanResult> {
  const { rows, errors } = await scanWatchlist(universe, dataSource, params, onProgress)

  // Only the option's last close matters here (see optionLegs.ts), which is
  // identical whether or not the base series gets resampled afterwards —
  // no need to resample just to read the tail value.
  const optionRows = await addOptionRecommendations(rows, atmMap, (token) => dataSource.fetchHistoricalCandles(token, 'NFO', '5minute', 5))

  // addOptionRecommendations() returns the frozen SignalRow shape (see
  // optionLegs.ts) with no token on it — resolve the option's own token
  // (not the underlying's) from the same atmMap it was derived from, purely
  // as additive UI metadata.
  const optionRowsWithToken: ScannedRow[] = optionRows.map((row): ScannedRow => {
    const baseSymbol = row.derivedFrom?.replace('-EQ', '') ?? ''
    const optionType = row.signal === 'CE Buy' ? 'CE' : 'PE'
    const token = atmMap[baseSymbol]?.[optionType]?.[1]
    return { ...row, token }
  })

  const allRows = [...rows, ...optionRowsWithToken]
  const visibleRows = selectVisibleRows(allRows)

  return { rows: allRows, errors, visibleRows }
}
