/**
 * Acceptance smoke script: runs Strength (src/analytics/strength.ts) across
 * the mock universe at the default seed and prints the resulting
 * distribution — the check that it looks like the reference screenshots'
 * shape (one or two standouts, a long tail near zero), not a uniform or
 * degenerate distribution. Every number printed here comes out of
 * MockMarketDataSource -> src/analytics/, nothing is hardcoded.
 *
 * Run: npm run smoke:strength
 */
import { DEFAULT_SEED, MockMarketDataSource } from '../src/data/mock'
import { computeStrength, deriveStrengthInputs, strengthTone, type StrengthTone } from '../src/analytics/strength'

// A fixed instant so this script's output is reproducible run to run —
// 2026-01-05 12:30 IST, ~3h15m into the session (39 closed 5-min bars).
// Deliberately not end-of-day and not right at the open: end-of-day lets a
// full session's drift accumulate for every name at once (fewer names stay
// "quiet"); right at the open, rvol is measured off only 1-2 bars, which is
// too noisy (bar-to-bar volume has no day-to-day correlation in the mock's
// generator) to mean anything. Mid-session is where both terms are at
// their most representative.
const REFERENCE_NOW = 1767596400

interface SymbolStrength {
  symbol: string
  value: number
}

async function main(): Promise<void> {
  const dataSource = new MockMarketDataSource(DEFAULT_SEED, { mode: 'fixed', startTimestamp: REFERENCE_NOW })
  dataSource.setFastForward(true)

  const rows = await dataSource.loadScripMaster()
  const eqRows = rows.filter((row) => row.exchange === 'NSE' && row.instrument_name === 'EQ')

  console.log(`Seed: ${DEFAULT_SEED}   Reference time (epoch seconds): ${REFERENCE_NOW}`)
  console.log(`Computing Strength across ${eqRows.length} NSE equities...\n`)

  const results: SymbolStrength[] = []
  let skipped = 0

  for (const row of eqRows) {
    const token = String(row.exchange_token)
    try {
      const [dailyBars, intradayBars] = await Promise.all([
        dataSource.fetchDailyBars({ token, exchange: 'NSE' }, 10),
        dataSource.fetchHistoricalCandles(token, 'NSE', '5minute', 10),
      ])

      if (intradayBars.length === 0) {
        skipped++
        continue
      }

      // No live tick subscription in this script — the last closed 5-minute
      // candle's close stands in for "today's last traded price."
      const ltp = intradayBars[intradayBars.length - 1].close
      const inputs = deriveStrengthInputs(dailyBars, intradayBars, ltp, REFERENCE_NOW)
      const value = computeStrength(inputs)

      results.push({ symbol: row.trading_symbol, value })
    } catch {
      skipped++ // simulated network failure (the mock's ~2% shouldFail roll) — not a real error
    }
  }

  const finite = results.filter((r) => Number.isFinite(r.value))
  const nanCount = results.length - finite.length

  const toneCounts: Record<StrengthTone, number> = { high: 0, medium: 0, low: 0, none: 0 }
  for (const r of results) toneCounts[strengthTone(r.value)]++

  const sortedValues = finite.map((r) => r.value).sort((a, b) => a - b)
  const min = sortedValues[0] ?? NaN
  const max = sortedValues[sortedValues.length - 1] ?? NaN
  const median = sortedValues.length > 0 ? sortedValues[Math.floor(sortedValues.length / 2)] : NaN

  console.log(`Computed: ${finite.length} finite, ${nanCount} NaN (not enough history), ${skipped} skipped (simulated fetch failure)\n`)

  console.log('Distribution by tone:')
  console.log(`  high   (>= 1.0)       : ${toneCounts.high}`)
  console.log(`  medium (0.5 - 0.99)   : ${toneCounts.medium}`)
  console.log(`  low    (0.05 - 0.49)  : ${toneCounts.low}`)
  console.log(`  none   (< 0.05 / NaN) : ${toneCounts.none + nanCount}`)

  console.log(`\nmin=${min.toFixed(1)}  median=${median.toFixed(1)}  max=${max.toFixed(1)}`)

  // A visual histogram so a human can actually judge "shape" (the
  // long-tail claim) — that's an inherently qualitative read of a picture,
  // not something worth encoding as an arbitrary numeric threshold below.
  console.log('\nDistribution (0.5-wide bins):')
  const binWidth = 0.5
  const maxBin = Math.ceil(max / binWidth) * binWidth || binWidth
  for (let binStart = 0; binStart < maxBin; binStart += binWidth) {
    const count = finite.filter((r) => r.value >= binStart && r.value < binStart + binWidth).length
    const label = `${binStart.toFixed(1)}-${(binStart + binWidth).toFixed(1)}`
    console.log(`  ${label.padStart(9)} | ${'#'.repeat(count)} (${count})`)
  }

  const top10 = [...finite].sort((a, b) => b.value - a.value).slice(0, 10)
  console.log('\nTop 10 by Strength:')
  for (const r of top10) {
    console.log(`  ${r.symbol.padEnd(16)} ${r.value.toFixed(1)}  (${strengthTone(r.value)})`)
  }

  const belowMedium = toneCounts.none + nanCount + toneCounts.low
  console.log(
    `\n${belowMedium}/${finite.length + nanCount} (${((belowMedium / (finite.length + nanCount)) * 100).toFixed(0)}%) score low or none — ` +
      'see the histogram above for the actual shape.',
  )

  // The only criterion stated as a hard number in the acceptance ask; "long
  // tail... one or two standouts" is a shape judgment for a human reading
  // the histogram above, not something this script manufactures a pass/fail
  // threshold for.
  const topLandsInRange = max >= 3 && max <= 7
  console.log(`\n${topLandsInRange ? 'PASS' : 'FAIL'}: top value ${topLandsInRange ? 'lands' : 'does NOT land'} in [3, 7] (${max.toFixed(1)}).`)
  if (!topLandsInRange) process.exitCode = 1
}

main()
  .catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
