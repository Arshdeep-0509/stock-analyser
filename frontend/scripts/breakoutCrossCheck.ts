/**
 * Cross-check: every /intraday breakout row must be a breakout the /rsi-ha
 * scanner reports too — same token, same direction, same level, on the same
 * closed bar.
 *
 * Both sides run against identical MockMarketDataSource instances (default
 * seed, the same frozen instant), at five instants across one session,
 * through their REAL code paths:
 *   - /intraday: createIntradayStore(...).init() -> computeIntradayRow() ->
 *     checkBreakout(). The bar the row was computed from is recorded by a
 *     thin wrapper around fetchHistoricalCandles (the last closed candle the
 *     store was handed for that token) — the store itself is untouched.
 *   - /rsi-ha: scanWatchlist() over the same F&O instruments, which pushes a
 *     row per breakout with `time` = that same last closed candle.
 *
 * The mock injects random transient request failures by design; the
 * wrapper retries them (as a real client would) so every instrument is
 * compared rather than silently skipped.
 *
 * It also checks the converse (every scanner breakout on these instruments
 * appears on /intraday) and that non-breakout rows agree too.
 *
 * Run: npx tsx scripts/breakoutCrossCheck.ts
 */
import type { MarketDataSource } from '../src/data/MarketDataSource'
import { DEFAULT_SEED, MockMarketDataSource } from '../src/data/mock'
import { scanWatchlist } from '../src/features/rsi-ha/scanner'
import { createIntradayStore } from '../src/store/intradayStore'
import { DEFAULT_PARAMS } from '../src/strategy/constants'
import type { UniverseEntry } from '../src/strategy/universe'
import type { Candle } from '../src/types/domain'

// Fixed instants so the result is reproducible run to run: REFERENCE_NOW (the store acceptance test's, 16:10 IST, after the close) and four points inside that session.
const REFERENCE_NOW = 1767609600
const HOUR = 3600
const INSTANTS = [REFERENCE_NOW - 6 * HOUR - 10 * 60, REFERENCE_NOW - 4 * HOUR - 40 * 60, REFERENCE_NOW - 3 * HOUR - 10 * 60, REFERENCE_NOW - HOUR - 40 * 60, REFERENCE_NOW]
const MAX_ATTEMPTS = 5

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
    }
  }
  throw lastError
}

/** Delegates every call to `inner`, retrying transient failures, and records the last closed candle each token's history ended on. */
function recordingSource(inner: MarketDataSource, lastBarByToken: Map<string, number>): MarketDataSource {
  return {
    searchSymbol: (q) => withRetry(() => inner.searchSymbol(q)),
    loadScripMaster: () => withRetry(() => inner.loadScripMaster()),
    fetchHistoricalCandles: async (token, exchange, interval, daysBack) => {
      const candles: Candle[] = await withRetry(() => inner.fetchHistoricalCandles(token, exchange, interval, daysBack))
      if (candles.length > 0) lastBarByToken.set(token, candles[candles.length - 1].time)
      return candles
    },
    fetchDailyBars: (instrument, days) => withRetry(() => inner.fetchDailyBars(instrument, days)),
    fetchIndexQuotes: (keys) => withRetry(() => inner.fetchIndexQuotes(keys)),
    subscribeTicks: (tokens, onTick, opts) => inner.subscribeTicks(tokens, onTick, opts),
    getConnectionState: () => inner.getConnectionState(),
  }
}

function makeSource(instant: number): MockMarketDataSource {
  const source = new MockMarketDataSource(DEFAULT_SEED, { mode: 'fixed', startTimestamp: instant })
  source.setFastForward(true)
  return source
}

interface InstantResult {
  instruments: number
  breakoutRows: number
  nonBreakoutRows: number
  scannerBreakouts: number
  scannerOnly: number
  failures: string[]
}

async function checkInstant(instant: number): Promise<InstantResult> {
  // --- /intraday path ---
  const intradayMock = makeSource(instant)
  const intradayLastBar = new Map<string, number>()
  const store = createIntradayStore({
    dataSource: recordingSource(intradayMock, intradayLastBar),
    now: () => intradayMock.getNow(),
    scheduleFrame: (flush) => setTimeout(flush, 16),
  })
  await store.getState().init()
  store.getState().stop()
  const intradayRows = store.getState().rows

  // --- /rsi-ha path, over exactly the same instruments ---
  const scannerMock = makeSource(instant)
  const scannerLastBar = new Map<string, number>()
  const universe: UniverseEntry[] = intradayRows.map((r) => ({ symbol: r.symbol, token: r.token, exchange: r.exchange }))
  const scan = await scanWatchlist(universe, recordingSource(scannerMock, scannerLastBar), DEFAULT_PARAMS)
  const scannerBreakouts = scan.rows.filter((r) => r.signal === 'BREAKOUT-UP' || r.signal === 'BREAKOUT-DOWN')
  const scannerByToken = new Map(scannerBreakouts.map((r) => [r.token ?? '', r]))

  const failures: string[] = []
  let breakoutRowsCompared = 0
  let nonBreakoutRowsCompared = 0

  for (const row of intradayRows) {
    const scanned = scannerByToken.get(row.token)
    if (row.breakout === null) {
      nonBreakoutRowsCompared += 1
      if (scanned) failures.push(`${row.symbol}: /rsi-ha reports ${scanned.signal} but /intraday shows no breakout`)
      continue
    }
    breakoutRowsCompared += 1
    const barTime = intradayLastBar.get(row.token)
    if (!scanned) {
      failures.push(`${row.symbol}: /intraday shows ${row.breakout} but /rsi-ha reports no breakout`)
      continue
    }
    if (scanned.signal !== row.breakout) failures.push(`${row.symbol}: direction ${row.breakout} vs /rsi-ha ${scanned.signal}`)
    if (scanned.time !== barTime) failures.push(`${row.symbol}: bar time ${barTime} vs /rsi-ha ${scanned.time}`)
    if ((scanned.level ?? null) !== row.breakoutLevel) failures.push(`${row.symbol}: level ${row.breakoutLevel} vs /rsi-ha ${scanned.level}`)
  }

  const intradayBreakoutTokens = new Set(intradayRows.filter((r) => r.breakout !== null).map((r) => r.token))
  const scannerOnly = scannerBreakouts.filter((r) => !intradayBreakoutTokens.has(r.token ?? ''))
  for (const r of scannerOnly) failures.push(`${r.symbol}: /rsi-ha reports ${r.signal} but it is missing from /intraday`)
  if (store.getState().errors.length > 0 || scan.errors.length > 0) failures.push(`load errors: /intraday ${store.getState().errors.length}, /rsi-ha ${scan.errors.length}`)

  return {
    instruments: intradayRows.length,
    breakoutRows: breakoutRowsCompared,
    nonBreakoutRows: nonBreakoutRowsCompared,
    scannerBreakouts: scannerBreakouts.length,
    scannerOnly: scannerOnly.length,
    failures,
  }
}

async function main(): Promise<void> {
  console.log('=== /intraday vs /rsi-ha breakout cross-check (default seed, frozen clock) ===')
  console.log('instant (IST)        | instruments | /intraday breakouts | non-breakout rows | /rsi-ha breakouts | result')
  const allFailures: string[] = []
  let totalBreakouts = 0
  let totalNonBreakouts = 0
  for (const instant of INSTANTS) {
    const r = await checkInstant(instant)
    totalBreakouts += r.breakoutRows
    totalNonBreakouts += r.nonBreakoutRows
    const label = new Date((instant + 5.5 * HOUR) * 1000).toISOString().replace('T', ' ').slice(0, 16)
    console.log(
      `${label.padEnd(20)} | ${String(r.instruments).padEnd(11)} | ${String(r.breakoutRows).padEnd(19)} | ${String(r.nonBreakoutRows).padEnd(17)} | ${String(r.scannerBreakouts).padEnd(17)} | ${r.failures.length === 0 ? 'PASS' : `FAIL (${r.failures.length})`}`,
    )
    allFailures.push(...r.failures.map((f) => `${label}: ${f}`))
  }
  console.log(`\nTotal /intraday breakout rows compared: ${totalBreakouts}; non-breakout rows compared: ${totalNonBreakouts}`)

  if (totalBreakouts === 0) allFailures.push('no breakout rows to compare — the check would be vacuous')
  if (allFailures.length > 0) {
    console.log(`\nFAIL — ${allFailures.length} mismatch(es):`)
    for (const f of allFailures.slice(0, 20)) console.log(`  ${f}`)
    process.exit(1)
  }
  console.log('PASS — every /intraday breakout matches the /rsi-ha scanner on token, direction, level and bar timestamp, and vice versa.')
  process.exit(0)
}

void main()
