import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../../strategy/constants'
import { loadFnoFuturesUniverse } from '../../strategy/universe'
import { makeMock, makeScreener } from '../../test-utils/realMock'
import { createIntradayStore } from '../intradayStore'
import type { ScreenerStore } from '../screenerStore'

/**
 * PARITY: load_fno_futures_universe() keeps a contract while
 *     expiry_date >= pd.Timestamp.now().normalize()
 * i.e. compared against TODAY'S DATE, so the expiring contract stays in the
 * universe for the whole of its expiry day. The TS loader mirrors that
 * exactly (its third argument is "today"); these tests pin that every
 * CALLER passes today's date and not the raw clock time — which would drop
 * the expiring contract from 05:30 IST (UTC midnight) on expiry day and
 * switch to next month a full day early.
 */
const IST_OFFSET = 330 * 60
const ist = (y: number, m1: number, d: number, h: number, min: number): number => Date.UTC(y, m1 - 1, d, h, min) / 1000 - IST_OFFSET
/** What pandas' naive Timestamp.now().normalize() means here: midnight of today's IST calendar date, as the loader's UTC-midnight date epoch. */
const pythonToday = (now: number): number => {
  const d = new Date((now + IST_OFFSET) * 1000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000
}

let store: ScreenerStore | null = null
afterEach(() => {
  store?.getState().stop()
  store = null
})

describe('expiry day — the expiring futures contract stays in the universe all day (Python parity)', () => {
  const EXPIRY_DAY_1PM = ist(2026, 1, 29, 13, 0) // Thu 29 Jan 2026 = January's last Thursday

  it('guard: on this instant, comparing against the raw clock time WOULD give a different universe (so this test is not vacuous)', async () => {
    const source = makeMock({ now: EXPIRY_DAY_1PM })
    const rows = await source.loadScripMaster()
    const byDate = loadFnoFuturesUniverse(rows, DEFAULT_PARAMS, pythonToday(EXPIRY_DAY_1PM)).map((e) => e.symbol)
    const byClock = loadFnoFuturesUniverse(rows, DEFAULT_PARAMS, EXPIRY_DAY_1PM).map((e) => e.symbol)
    expect(byDate.length).toBeGreaterThan(0)
    expect(byDate).not.toEqual(byClock)
    expect(byDate.some((s) => s.includes('JAN'))).toBe(true)
  })

  it('the screener store picks the same futures contracts the Python would', async () => {
    const source = makeMock({ now: EXPIRY_DAY_1PM })
    const rows = await source.loadScripMaster()
    const expected = loadFnoFuturesUniverse(rows, DEFAULT_PARAMS, pythonToday(EXPIRY_DAY_1PM)).map((e) => e.token)

    store = makeScreener(source)
    await store.getState().loadUniverse()
    const actualFutures = store
      .getState()
      .universe.filter((e) => e.exchange === 'NFO')
      .map((e) => e.token)
    expect(actualFutures).toEqual(expected)
  })

  it('the intraday store builds its F&O rows from the same contracts', async () => {
    const source = makeMock({ now: EXPIRY_DAY_1PM })
    const rows = await source.loadScripMaster()
    const expected = new Set(loadFnoFuturesUniverse(rows, DEFAULT_PARAMS, pythonToday(EXPIRY_DAY_1PM)).map((e) => e.token))

    const intraday = createIntradayStore({ dataSource: source, now: () => source.getNow(), scheduleFrame: (flush) => flush() })
    await intraday.getState().init()
    intraday.getState().stop()
    expect(new Set(intraday.getState().rows.map((r) => r.token))).toEqual(expected)
  }, 30_000)
})