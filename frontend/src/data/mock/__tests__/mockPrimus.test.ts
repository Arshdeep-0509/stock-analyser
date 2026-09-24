import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrimusTick } from '../../../types/api'
import { CandleEngine } from '../candleEngine'
import { MockClock } from '../clock'
import { MockPrimusSocket } from '../mockPrimus'

// 2026-01-05 13:00 IST, mid-session: the feed is silent outside market hours (see liveSession.test.ts).
const REFERENCE_NOW = 1767598200

afterEach(() => {
  vi.useRealTimers()
})

function setup(): MockPrimusSocket {
  const clock = new MockClock({ mode: 'fixed', startTimestamp: REFERENCE_NOW })
  const engine = new CandleEngine(1, REFERENCE_NOW)
  return new MockPrimusSocket(
    clock,
    () => engine,
    () => 2500,
    () => 'NSE',
    1,
  )
}

describe('MockPrimusSocket batching', () => {
  it('ticks every priority token every batch, and still covers every non-priority token over time', () => {
    vi.useFakeTimers()
    const socket = setup()

    const priorityTokens = ['P1', 'P2', 'P3']
    const nonPriorityTokens = Array.from({ length: 40 }, (_, i) => `N${i}`)
    const allTokens = [...priorityTokens, ...nonPriorityTokens]

    const counts = new Map<string, number>()
    socket.subscribe(
      allTokens,
      (tick: PrimusTick) => {
        const token = String(tick.token)
        counts.set(token, (counts.get(token) ?? 0) + 1)
      },
      { priority: priorityTokens },
    )

    vi.advanceTimersByTime(700) // past the (150-600ms) random connect delay
    vi.advanceTimersByTime(1000) // ~10 batches at ~10/second

    for (const token of priorityTokens) {
      expect(counts.get(token) ?? 0).toBeGreaterThanOrEqual(8)
    }
    for (const token of nonPriorityTokens) {
      expect(counts.get(token) ?? 0).toBeGreaterThanOrEqual(1)
    }
  })

  it('never ticks a token that was never subscribed', () => {
    vi.useFakeTimers()
    const socket = setup()

    const seen = new Set<string>()
    socket.subscribe(['A', 'B'], (tick: PrimusTick) => seen.add(String(tick.token)))

    vi.advanceTimersByTime(2000)

    expect(seen.size).toBeGreaterThan(0)
    for (const token of seen) {
      expect(['A', 'B']).toContain(token)
    }
  })

  it('a subscriber never receives a tick for a token it did not ask for, even if another subscriber shares the socket', () => {
    vi.useFakeTimers()
    const socket = setup()

    const seenByA = new Set<string>()
    const seenByB = new Set<string>()
    socket.subscribe(['SHARED', 'ONLY_A'], (tick) => seenByA.add(String(tick.token)))
    socket.subscribe(['SHARED', 'ONLY_B'], (tick) => seenByB.add(String(tick.token)), { priority: ['SHARED', 'ONLY_B'] })

    vi.advanceTimersByTime(2000)

    expect(seenByA.has('ONLY_B')).toBe(false)
    expect(seenByB.has('ONLY_A')).toBe(false)
  })
})
