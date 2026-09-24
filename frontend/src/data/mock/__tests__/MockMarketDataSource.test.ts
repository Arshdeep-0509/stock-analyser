import { describe, expect, it } from 'vitest'
import { DEFAULT_SEED, MockMarketDataSource } from '../MockMarketDataSource'

const REFERENCE_NOW = 1767609600

function makeDataSource(): MockMarketDataSource {
  const ds = new MockMarketDataSource(DEFAULT_SEED, { mode: 'fixed', startTimestamp: REFERENCE_NOW })
  ds.setFastForward(true)
  return ds
}

describe('MockMarketDataSource — index quotes', () => {
  it('returns one quote per requested key, in the same order, with finite values', async () => {
    const ds = makeDataSource()
    const quotes = await ds.fetchIndexQuotes(['NIFTY', 'BANKNIFTY', 'INDIAVIX'])

    expect(quotes.map((q) => q.key)).toEqual(['NIFTY', 'BANKNIFTY', 'INDIAVIX'])
    for (const quote of quotes) {
      expect(Number.isFinite(quote.last)).toBe(true)
      expect(Number.isFinite(quote.prevClose)).toBe(true)
      expect(Number.isFinite(quote.changePct)).toBe(true)
      expect(quote.time).toBe(REFERENCE_NOW)
    }
  })

  it('labels each key with its human-readable name', async () => {
    const ds = makeDataSource()
    const quotes = await ds.fetchIndexQuotes(['NIFTY', 'BANKNIFTY', 'INDIAVIX'])
    expect(quotes.map((q) => q.label)).toEqual(['NIFTY 50', 'BANK NIFTY', 'India VIX'])
  })

  it('is byte-identical across two independently constructed instances of the same seed', async () => {
    const a = await makeDataSource().fetchIndexQuotes(['NIFTY', 'BANKNIFTY', 'INDIAVIX'])
    const b = await makeDataSource().fetchIndexQuotes(['NIFTY', 'BANKNIFTY', 'INDIAVIX'])
    expect(a).toEqual(b)
  }, 20000) // two independent mock constructions (each generates the universe) — same parallel-load headroom as generateUniverse.test.ts

  it('India VIX stays within a plausible band, never collapsing to zero or negative', async () => {
    const ds = makeDataSource()
    const [vix] = await ds.fetchIndexQuotes(['INDIAVIX'])
    expect(vix.last).toBeGreaterThanOrEqual(5)
    expect(vix.last).toBeLessThan(100)
  })
})

describe('MockMarketDataSource — daily bars', () => {
  it('aggregates the generated intraday series and respects the requested day count', async () => {
    const ds = makeDataSource()
    const rows = await ds.loadScripMaster()
    const eqRow = rows.find((r) => r.exchange === 'NSE' && r.instrument_name === 'EQ')
    expect(eqRow).toBeDefined()

    const bars = await ds.fetchDailyBars({ token: String(eqRow!.exchange_token), exchange: 'NSE' }, 3)

    expect(bars.length).toBeGreaterThan(0)
    expect(bars.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].time).toBeGreaterThan(bars[i - 1].time)
    }
  })

  it('never returns more days than the mock has actually generated', async () => {
    const ds = makeDataSource()
    const rows = await ds.loadScripMaster()
    const eqRow = rows.find((r) => r.exchange === 'NSE' && r.instrument_name === 'EQ')!

    const bars = await ds.fetchDailyBars({ token: String(eqRow.exchange_token), exchange: 'NSE' }, 30)
    expect(bars.length).toBeLessThanOrEqual(5)
  })
})
