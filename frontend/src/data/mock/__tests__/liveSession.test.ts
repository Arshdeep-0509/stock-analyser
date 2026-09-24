import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrimusTick } from '../../../types/api'
import type { Candle } from '../../../types/domain'
import { CandleEngine, formingState, isSessionBar, nextSessionBar } from '../candleEngine'
import { MockClock } from '../clock'
import { MockPrimusSocket } from '../mockPrimus'
import { mulberry32 } from '../rng'

/**
 * REGRESSION: the mock feed kept ticking after 15:30 and every tick rolled a
 * new 5-minute bar onto the history the screener and /intraday read, so
 * after hours every meter kept moving on bars no real market produced. And
 * during the session each tick nudged the pre-generated 15:25 bar instead of
 * the bar actually forming, so the live price tracked a FUTURE bar.
 */

const IST = 330 * 60
/** 2026-01-05 is a Monday; 2026-01-09 the Friday of that week. */
const ist = (day: number, hh: number, mm: number): number => Date.UTC(2026, 0, day, hh, mm) / 1000 - IST
const MON_1300 = ist(5, 13, 0)
const MON_1302 = ist(5, 13, 2) + 30
const MON_1525 = ist(5, 15, 25)
const MON_1530 = ist(5, 15, 30)
const MON_1900 = ist(5, 19, 0)
const TUE_0900 = ist(6, 9, 0)
const TUE_0915 = ist(6, 9, 15)
const TUE_0927 = ist(6, 9, 27)
const FRI_1525 = ist(9, 15, 25)
const SAT_1100 = ist(10, 11, 0)
const MON12_0915 = ist(12, 9, 15)

const TOKEN = 'T1'
const PRICE = 2500

afterEach(() => {
  vi.useRealTimers()
})

/** What fetchHistoricalCandles returns at `now`: every bar that has fully closed by then. */
function historyAt(engine: CandleEngine, now: number): Candle[] {
  return engine
    .getRawHistoricalResponse(TOKEN, PRICE, 30)
    .data.candles.map(([t, o, h, l, c, v]) => ({ time: Number(t), open: Number(o), high: Number(h), low: Number(l), close: Number(c), volume: Number(v) }))
    .filter((c) => c.time + 300 <= now)
}

function ticksAt(now: number, force = false): PrimusTick[] {
  const clock = new MockClock({ mode: 'fixed', startTimestamp: now, forceSessionOpen: force })
  const engine = new CandleEngine(7, now)
  const socket = new MockPrimusSocket(clock, () => engine, () => PRICE, () => 'NSE', 7)
  const ticks: PrimusTick[] = []
  socket.subscribe([TOKEN], (t) => ticks.push(t), { priority: [TOKEN] })
  vi.advanceTimersByTime(700 + 3000) // connect, then ~30 batches
  socket.destroy()
  return ticks
}

describe('session calendar', () => {
  it('a session bar is 09:15-15:25 IST on a weekday, nothing else', () => {
    expect(isSessionBar(TUE_0915)).toBe(true)
    expect(isSessionBar(MON_1525)).toBe(true)
    expect(isSessionBar(MON_1530)).toBe(false)
    expect(isSessionBar(TUE_0900)).toBe(false)
    expect(isSessionBar(SAT_1100)).toBe(false)
  })

  it('the next session bar after the close is the next weekday 09:15, skipping overnight and weekends', () => {
    expect(nextSessionBar(MON_1300)).toBe(MON_1300 + 300)
    expect(nextSessionBar(MON_1525)).toBe(TUE_0915)
    expect(nextSessionBar(FRI_1525)).toBe(MON12_0915)
  })
})

describe('the feed is silent while the market is closed', () => {
  it.each([
    ['after the close (19:00)', MON_1900],
    ['pre-open (09:00)', TUE_0900],
    ['on a Saturday', SAT_1100],
  ])('%s: no ticks at all', (_label, now) => {
    vi.useFakeTimers()
    expect(ticksAt(now)).toEqual([])
  })

  it('mid-session the same socket does tick (the silence above is the session gate, not a dead socket)', () => {
    vi.useFakeTimers()
    expect(ticksAt(MON_1302).length).toBeGreaterThan(0)
  })

  it('after the close the history ends at the 15:25 bar and does not grow, however long the tab stays open', () => {
    const engine = new CandleEngine(7, MON_1900)
    const before = historyAt(engine, MON_1900)
    for (let t = MON_1530; t <= TUE_0900; t += 60) expect(engine.advanceLiveTick(TOKEN, PRICE, t)).toBeNull()
    const after = historyAt(engine, TUE_0900)
    expect(after).toEqual(before)
    expect(after[after.length - 1].time).toBe(MON_1525)
  })

  it('the socket gates on the session by itself, even over an engine that would tick at any hour', () => {
    // Defence in depth: the engine also refuses off-session bars, so this pins the socket's own gate.
    class AlwaysTicks extends CandleEngine {
      override advanceLiveTick(): { price: number; candle: Candle } {
        return { price: PRICE, candle: { time: MON_1900, open: PRICE, high: PRICE, low: PRICE, close: PRICE, volume: 1 } }
      }
    }
    vi.useFakeTimers()
    const engine = new AlwaysTicks(7, MON_1900)
    const ticks: PrimusTick[] = []
    for (const now of [MON_1900, MON_1302]) {
      const socket = new MockPrimusSocket(new MockClock({ mode: 'fixed', startTimestamp: now }), () => engine, () => PRICE, () => 'NSE', 7)
      socket.subscribe([TOKEN], (t) => ticks.push(t))
      vi.advanceTimersByTime(3700)
      socket.destroy()
    }
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks.every((t) => t.ltt === MON_1302)).toBe(true)
  })

  it('with Force OPEN (devtools) the same instant does tick, so the override still works', () => {
    vi.useFakeTimers()
    expect(ticksAt(MON_1900, true).length).toBeGreaterThan(0)
  })
})

describe('when the market opens again, bars resume from the next session', () => {
  it('overnight: the first new bar is 09:15, straight after the 15:25 close, with no 15:30-09:10 bars', () => {
    const engine = new CandleEngine(7, MON_1900)
    expect(engine.advanceLiveTick(TOKEN, PRICE, TUE_0927)).not.toBeNull()
    const times = historyAt(engine, TUE_0927 + 3600)
      .map((c) => c.time)
      .filter((t) => t > MON_1300)
    expect(times.every(isSessionBar)).toBe(true)
    expect(times.slice(-5)).toEqual([MON_1525 - 300, MON_1525, TUE_0915, TUE_0915 + 300, TUE_0915 + 600])
    // At 09:27 the 09:25 bar is still forming, so the fetch-side cutoff hides it.
    expect(historyAt(engine, TUE_0927).map((c) => c.time).slice(-2)).toEqual([TUE_0915, TUE_0915 + 300])
  })

  it('the first new bar opens at the previous close (the price the screen was frozen on)', () => {
    const engine = new CandleEngine(7, MON_1900)
    const close = historyAt(engine, MON_1900).at(-1)?.close
    engine.advanceLiveTick(TOKEN, PRICE, TUE_0915 + 10)
    const first = historyAt(engine, TUE_0915 + 300).at(-1)
    expect(first?.time).toBe(TUE_0915)
    expect(first?.open).toBe(close)
  })
})

describe('during the session the tick belongs to the bar that is forming NOW', () => {
  it('a 13:02 tick sits inside the 13:00 bar, opens at its open, and ticking never rewrites history', () => {
    const engine = new CandleEngine(7, MON_1300)
    const snapshot = JSON.stringify(engine.getRawHistoricalResponse(TOKEN, PRICE, 30))
    const bar = engine.getClosedCandles(TOKEN, PRICE).find((c) => c.time === MON_1300)
    const live = engine.advanceLiveTick(TOKEN, PRICE, MON_1302)
    if (!bar || !live) throw new Error('expected a 13:00 bar and a mid-session tick')
    expect(live.candle.time).toBe(MON_1300)
    expect(live.candle.open).toBe(bar.open)
    expect(live.price).toBeGreaterThanOrEqual(bar.low)
    expect(live.price).toBeLessThanOrEqual(bar.high)
    expect(live.price).toBe(live.candle.close)
    for (let t = MON_1300; t < MON_1530; t += 7) engine.advanceLiveTick(TOKEN, PRICE, t)
    expect(JSON.stringify(engine.getRawHistoricalResponse(TOKEN, PRICE, 30))).toBe(snapshot)
  })

  it('ticks through a bar converge on the bar the history returns once it closes', () => {
    const engine = new CandleEngine(7, MON_1300)
    const bar = engine.getClosedCandles(TOKEN, PRICE).find((c) => c.time === MON_1300)
    const last = engine.advanceLiveTick(TOKEN, PRICE, MON_1300 + 299)
    if (!bar || !last) throw new Error('expected a 13:00 bar and a tick')
    expect(Math.abs(last.price - bar.close)).toBeLessThanOrEqual((bar.high - bar.low) * 0.1 + 0.01)
  })

  it('formingState stays inside the bar at every step, and at the close IS the bar', () => {
    const bar: Candle = { time: 0, open: 100, high: 104, low: 97, close: 102, volume: 5000 }
    const rng = mulberry32(1)
    for (let step = 0; step < 100; step++) {
      const s = formingState(bar, step / 100, rng)
      expect(s.open).toBe(100)
      expect(s.low).toBeGreaterThanOrEqual(bar.low)
      expect(s.high).toBeLessThanOrEqual(bar.high)
      expect(s.close).toBeGreaterThanOrEqual(s.low)
      expect(s.close).toBeLessThanOrEqual(s.high)
      expect(s.volume).toBeLessThanOrEqual(bar.volume)
    }
    expect(formingState(bar, 1, rng)).toEqual(bar)
    // At the bar's first instant nothing has traded yet: every price is the open, no volume.
    expect(formingState(bar, 0, rng)).toEqual({ time: 0, open: 100, high: 100, low: 100, close: 100, volume: 0 })
  })
})
