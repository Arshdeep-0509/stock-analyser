/**
 * Acceptance smoke script: prints NIFTY / BANK NIFTY / India VIX at the
 * default seed, alongside a market-wide advance/decline count, and checks
 * that each index's sign agrees with the majority of its OWN constituents —
 * the check that catches "NIFTY says -0.3% while every constituent is
 * green" (see src/analytics/indexComposite.ts's design note). Every number
 * printed here comes from MockMarketDataSource -> src/analytics/, nothing
 * is hardcoded.
 *
 * Run: npm run smoke:index
 */
import { DEFAULT_SEED, MockMarketDataSource } from '../src/data/mock'
import { INDEX_PANELS } from '../src/data/reference/indices'
import { aggregateToSessions } from '../src/analytics/daily'
import type { ScripRow } from '../src/types/api'

// A fixed instant so this script's output is reproducible run to run.
const REFERENCE_NOW = 1767609600

function pct(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`
}

async function main(): Promise<void> {
  const dataSource = new MockMarketDataSource(DEFAULT_SEED, { mode: 'fixed', startTimestamp: REFERENCE_NOW })
  dataSource.setFastForward(true)

  const rows = await dataSource.loadScripMaster()
  const eqRows = rows.filter((row) => row.exchange === 'NSE' && row.instrument_name === 'EQ')
  const byBaseSymbol = new Map<string, ScripRow>(eqRows.map((row) => [row.company_name, row]))

  console.log(`Seed: ${DEFAULT_SEED}   Reference time (epoch seconds): ${REFERENCE_NOW}\n`)

  // --- Index quotes ---------------------------------------------------------
  const quotes = await dataSource.fetchIndexQuotes(['NIFTY', 'BANKNIFTY', 'INDIAVIX'])
  console.log('Index quotes:')
  for (const quote of quotes) {
    console.log(
      `  ${quote.label.padEnd(12)} last=${quote.last.toFixed(2).padStart(10)}  prevClose=${quote.prevClose.toFixed(2).padStart(10)}  change=${pct(quote.changePct)}`,
    )
  }

  // --- Market-wide advance/decline ------------------------------------------
  let advances = 0
  let declines = 0
  let unchanged = 0
  let skipped = 0

  for (const row of eqRows) {
    try {
      const bars = await dataSource.fetchDailyBars({ token: String(row.exchange_token), exchange: 'NSE' }, 2)
      if (bars.length < 2) {
        unchanged++
        continue
      }
      const change = bars[bars.length - 1].close - bars[bars.length - 2].close
      if (change > 0) advances++
      else if (change < 0) declines++
      else unchanged++
    } catch {
      skipped++ // simulated network failure (the mock's ~2% shouldFail roll) — not a real error
    }
  }

  console.log(
    `\nMarket breadth (${eqRows.length} NSE equities): ${advances} advances, ${declines} declines, ${unchanged} unchanged` +
      (skipped > 0 ? `, ${skipped} skipped (simulated fetch failure)` : ''),
  )

  // --- Sign agreement: index vs. the majority of its own constituents -------
  console.log('\nSign agreement (index vs. the majority of its own constituents):')
  let allAgree = true

  const checks: ReadonlyArray<readonly ['NIFTY' | 'BANKNIFTY', 'NIFTY_50' | 'BANK_NIFTY']> = [
    ['NIFTY', 'NIFTY_50'],
    ['BANKNIFTY', 'BANK_NIFTY'],
  ]

  for (const [quoteKey, panelKey] of checks) {
    const quote = quotes.find((q) => q.key === quoteKey)
    const panel = INDEX_PANELS.find((p) => p.key === panelKey)
    if (!quote || !panel) continue

    let up = 0
    let down = 0

    for (const symbol of panel.constituents) {
      const row = byBaseSymbol.get(symbol)
      if (!row) continue
      try {
        const candles = await dataSource.fetchHistoricalCandles(String(row.exchange_token), 'NSE', '5minute', 5)
        const sessions = aggregateToSessions(candles)
        if (sessions.length < 2) continue
        const change = sessions[sessions.length - 1].close - sessions[sessions.length - 2].close
        if (change > 0) up++
        else if (change < 0) down++
      } catch {
        // simulated network failure for this one constituent — skip it, doesn't invalidate the majority check
      }
    }

    const majoritySign = up === down ? 0 : up > down ? 1 : -1
    const indexSign = quote.changePct === 0 ? 0 : quote.changePct > 0 ? 1 : -1
    const agrees = majoritySign === 0 || indexSign === majoritySign
    allAgree = allAgree && agrees

    console.log(
      `  ${quote.label.padEnd(12)} index=${pct(quote.changePct)}  constituents: ${up} up / ${down} down  -> ${agrees ? 'AGREES' : 'DISAGREES'}`,
    )
  }

  console.log(`\n${allAgree ? 'PASS' : 'FAIL'}: index sign agrees with the majority of its constituents.`)
  if (!allAgree) process.exitCode = 1
}

// MockMarketDataSource always starts the mock Primus socket's heartbeat/
// reconnect timers in its constructor (real WebSocket lifecycle simulation,
// STRATEGY-CONTRACT.md §3.4) even though this script never subscribes to
// ticks — those timers keep Node's event loop alive indefinitely, so a
// one-shot CLI script must exit explicitly rather than let the process end
// naturally.
main()
  .catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
