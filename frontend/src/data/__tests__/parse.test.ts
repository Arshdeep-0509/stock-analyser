import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SEED, MockMarketDataSource } from '../mock'
import { MockPrimusSocket } from '../mock/mockPrimus'
import type { HistoricalCandlesResponse, PrimusTick } from '../../types/api'
import { parseCandleTimestamp } from '../../types/api'
import type { MarketTick } from '../../types/domain'
import { parseHistoricalCandlesResponse } from '../parseCandles'

// Maps the spec's parse-layer names onto this codebase:
//   parseTdv      -> parseHistoricalCandlesResponse (src/data/parseCandles.ts)
//   normaliseTick -> the PrimusTick -> MarketTick mapping inside
//                    MockMarketDataSource.subscribeTicks (there is no
//                    standalone function; tested through the public API).

const SESSION_NOW = 1767598200 // 2026-01-05 13:00 IST

describe('parseCandleTimestamp — every wire format the tdv endpoint might use (UNCONFIRMED, see BACKEND-HANDOFF §3)', () => {
  it('ISO-8601 strings, with and without an offset', () => {
    expect(parseCandleTimestamp('2026-01-05T07:30:00Z')).toBe(SESSION_NOW)
    expect(parseCandleTimestamp('2026-01-05T13:00:00+05:30')).toBe(SESSION_NOW)
  })

  it('epoch seconds and epoch milliseconds, as numbers', () => {
    expect(parseCandleTimestamp(SESSION_NOW)).toBe(SESSION_NOW)
    expect(parseCandleTimestamp(SESSION_NOW * 1000)).toBe(SESSION_NOW)
    expect(parseCandleTimestamp(SESSION_NOW * 1000 + 999)).toBe(SESSION_NOW) // floors, never rounds up into the next second
  })

  it('epoch seconds and milliseconds as numeric strings, tolerating whitespace', () => {
    expect(parseCandleTimestamp(String(SESSION_NOW))).toBe(SESSION_NOW)
    expect(parseCandleTimestamp(` ${SESSION_NOW * 1000} `)).toBe(SESSION_NOW)
  })

  it('garbage THROWS (it does not return NaN) — the scanner records that instrument as a per-symbol error', () => {
    expect(() => parseCandleTimestamp('not a date')).toThrow(/unrecognised timestamp format/)
    expect(() => parseCandleTimestamp('')).toThrow(/unrecognised timestamp format/)
  })
})

describe('parseHistoricalCandlesResponse (the tdv parser)', () => {
  it('coerces an ALL-STRING payload to numbers — the path a real backend exercises (the mock sends strings deliberately)', () => {
    const response: HistoricalCandlesResponse = { data: { candles: [[String(SESSION_NOW - 600), '2500.50', '2510', '2490.25', '2505.75', '123456']] } }
    const [c] = parseHistoricalCandlesResponse(response, 5, SESSION_NOW)
    expect(c).toEqual({ time: SESSION_NOW - 600, open: 2500.5, high: 2510, low: 2490.25, close: 2505.75, volume: 123456 })
    for (const v of Object.values(c)) expect(typeof v).toBe('number')
  })

  it('sorts oldest-first even when the payload is shuffled', () => {
    const times = [SESSION_NOW - 900, SESSION_NOW - 1800, SESSION_NOW - 1200, SESSION_NOW - 1500]
    const response: HistoricalCandlesResponse = { data: { candles: times.map((t) => [String(t), '1', '1', '1', '1', '1']) } }
    expect(parseHistoricalCandlesResponse(response, 5, SESSION_NOW).map((c) => c.time)).toEqual([...times].sort((a, b) => a - b))
  })

  it('drops the forming bar: a bar is kept only when time + interval <= now', () => {
    const response: HistoricalCandlesResponse = {
      data: { candles: [[String(SESSION_NOW - 600), '1', '1', '1', '1', '1'], [String(SESSION_NOW - 300), '1', '1', '1', '1', '1'], [String(SESSION_NOW), '1', '1', '1', '1', '1']] },
    }
    // At exactly SESSION_NOW the bar that opened at SESSION_NOW - 300 has just closed; the one opening at SESSION_NOW is forming.
    expect(parseHistoricalCandlesResponse(response, 5, SESSION_NOW).map((c) => c.time)).toEqual([SESSION_NOW - 600, SESSION_NOW - 300])
    // One second earlier, the SESSION_NOW - 300 bar is still forming too.
    expect(parseHistoricalCandlesResponse(response, 5, SESSION_NOW - 1).map((c) => c.time)).toEqual([SESSION_NOW - 600])
  })
})

describe('PrimusTick -> MarketTick normalisation (MockMarketDataSource.subscribeTicks)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('maps every field of every raw tick, 1:1', async () => {
    vi.useFakeTimers()
    const raws: PrimusTick[] = []
    const original = MockPrimusSocket.prototype.subscribe
    vi.spyOn(MockPrimusSocket.prototype, 'subscribe').mockImplementation(function (this: MockPrimusSocket, tokens, listener, opts) {
      return original.call(
        this,
        tokens,
        (raw: PrimusTick) => {
          raws.push(raw)
          listener(raw)
        },
        opts,
      )
    })

    const source = new MockMarketDataSource(DEFAULT_SEED, { mode: 'fixed', startTimestamp: SESSION_NOW, forceSessionOpen: true })
    source.setFastForward(true)
    const scrip = await source.loadScripMaster()
    const tokens = [scrip.find((r) => r.exchange === 'NSE'), scrip.find((r) => r.exchange === 'NFO')].map((r) => String(r?.exchange_token))

    const ticks: MarketTick[] = []
    const unsubscribe = source.subscribeTicks(tokens, (t) => ticks.push(t))
    vi.advanceTimersByTime(3000)
    unsubscribe()

    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks).toHaveLength(raws.length)
    ticks.forEach((t, i) => {
      const raw = raws[i]
      expect(t).toEqual({
        token: String(raw.token),
        exchange: raw.exchange === 'NFO' ? 'NFO' : 'NSE',
        ltp: raw.ltp,
        time: raw.ltt,
        volume: raw.volume,
        open: raw.o,
        high: raw.h,
        low: raw.l,
        close: raw.c,
      })
      expect(typeof t.token).toBe('string')
    })
    expect(new Set(ticks.map((t) => t.exchange))).toEqual(new Set(['NSE', 'NFO']))
  })
})
