import type { MarketDataSource } from '../../data/MarketDataSource'
import { analyzeCandles } from '../../strategy/analyzeCandles'
import { checkBreakout, checkSignal } from '../../strategy/signals'
import { parseIntervalMinutes, type StrategyParams } from '../../strategy/constants'
import { BASE_INTERVAL_MINUTES, resampleCandles } from '../../strategy/resampleCandles'
import type { UniverseEntry } from '../../strategy/universe'
import type { AnalyzedCandle, Candle } from '../../types/domain'

const CONCURRENCY = 50

// Comfortably above the largest breakoutLookback (100) plus room for the
// exact-2 HA-streak check — see the comment on WINDOW's use below.
const WINDOW = 150

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    for (;;) {
      const current = nextIndex
      nextIndex += 1
      if (current >= items.length) return
      results[current] = await fn(items[current])
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

interface PerSymbolSeries {
  candles: Candle[]
  analyzed: AnalyzedCandle[]
}

/**
 * Locates the next bar timestamp (strictly after `afterTimestamp`) at which
 * ANY instrument in `universe` would fire a BUY/SELL signal or a breakout,
 * by calling the SAME checkSignal()/checkBreakout() the real scanner uses —
 * just run locally, once per symbol over its full candle history, instead
 * of driving hundreds of full async rescans one bar at a time (which is
 * what made the replay "jump to next signal" button impractically slow).
 *
 * checkSignal()/checkBreakout() only ever look at a trailing window of the
 * array they're given (the last candle, a short HA-colour streak, and up to
 * `breakoutLookback` candles back) — never anything before that. So instead
 * of the O(bars) `slice(0, i+1)` a literal transliteration would need (which
 * would make this whole scan O(bars^2)), each check gets only a small
 * trailing WINDOW ending at bar i. A capped HA streak can only ever read as
 * "some length >= WINDOW", never exactly 2, so a real streak of exactly 2 is
 * still identified correctly and a longer real streak still correctly reads
 * as "not exactly 2" — the boolean outcome is unaffected by the cap.
 *
 * Caller must have the mock's clock pinned far enough forward (e.g. session
 * end) before calling, so `dataSource.fetchHistoricalCandles` returns each
 * symbol's full series rather than truncating at "still forming".
 */
export async function findNextSignalTimestamp(
  universe: readonly UniverseEntry[],
  dataSource: Pick<MarketDataSource, 'fetchHistoricalCandles'>,
  params: StrategyParams,
  afterTimestamp: number,
  isCancelled: () => boolean,
): Promise<number | null> {
  if (universe.length === 0) return null

  const perSymbol = await mapWithConcurrency<UniverseEntry, PerSymbolSeries | null>(universe, CONCURRENCY, async (entry) => {
    try {
      const baseCandles = await dataSource.fetchHistoricalCandles(entry.token, entry.exchange, '5minute', 5)
      const targetMinutes = parseIntervalMinutes(params.candleInterval)
      const candles = targetMinutes === BASE_INTERVAL_MINUTES ? baseCandles : resampleCandles(baseCandles, targetMinutes)
      const analyzed = candles.length > 0 ? analyzeCandles(candles, params) : []
      return { candles, analyzed }
    } catch {
      return null
    }
  })

  const series = perSymbol.filter((s): s is PerSymbolSeries => s !== null)
  const longest = series.reduce((best, s) => (s.candles.length > best.candles.length ? s : best), series[0])
  if (!longest) return null
  const barTimestamps = longest.candles.map((c) => c.time)

  const startIndex = barTimestamps.findIndex((t) => t > afterTimestamp)
  if (startIndex === -1) return null

  for (let i = startIndex; i < barTimestamps.length; i++) {
    if (isCancelled()) return null
    for (const { candles, analyzed } of series) {
      if (i >= candles.length) continue
      const from = Math.max(0, i + 1 - WINDOW)
      if (checkSignal(analyzed.slice(from, i + 1), params)) return barTimestamps[i]
      if (checkBreakout(candles.slice(from, i + 1), params).signal) return barTimestamps[i]
    }
  }
  return null
}
