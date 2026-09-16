import { describe, expect, it } from 'vitest'
import type { ScannedRow } from '../../features/rsi-ha/scanner'
import { mergeScanRows } from '../mergeScanRows'
import type { ScreenerRow } from '../types'

function signalRow(overrides: Partial<ScannedRow> = {}): ScannedRow {
  return { id: 'raw-id', symbol: 'RELIANCE-EQ', exchange: 'NSE', signal: 'BUY', price: 2500, rsi: 62, time: 100, ...overrides }
}

function screenerRow(overrides: Partial<ScreenerRow> = {}): ScreenerRow {
  return { ...signalRow(), status: 'active', firstSeenAt: 0, lastSeenAt: 0, pinned: false, ...overrides }
}

describe('mergeScanRows', () => {
  it('updates an existing row in place when the same symbol+signal keeps firing, keeping its id and firstSeenAt', () => {
    const existing = [screenerRow({ id: 'stable-id', firstSeenAt: 0, lastSeenAt: 0, price: 2500, time: 100 })]
    const incoming = [signalRow({ id: 'fresh-id', price: 2510, time: 400 })]

    const { rows, expired } = mergeScanRows(existing, incoming, new Set(['RELIANCE-EQ']), 500)

    expect(expired).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'stable-id', firstSeenAt: 0, lastSeenAt: 500, price: 2510, time: 400, status: 'active' })
  })

  it('adds a brand new row for a condition that was not previously present', () => {
    const { rows, expired } = mergeScanRows([], [signalRow()], new Set(['RELIANCE-EQ']), 100)

    expect(expired).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'active', firstSeenAt: 100, lastSeenAt: 100 })
  })

  it('fades a row on the first scan it stops appearing, then expires it on the next', () => {
    const active = screenerRow({ id: 'a', status: 'active', firstSeenAt: 0, lastSeenAt: 0 })

    const afterFirstMiss = mergeScanRows([active], [], new Set(['RELIANCE-EQ']), 300)
    expect(afterFirstMiss.expired).toEqual([])
    expect(afterFirstMiss.rows).toHaveLength(1)
    expect(afterFirstMiss.rows[0]).toMatchObject({ id: 'a', status: 'fading' })

    const fading = afterFirstMiss.rows[0]
    const afterSecondMiss = mergeScanRows([fading], [], new Set(['RELIANCE-EQ']), 600)
    expect(afterSecondMiss.rows).toHaveLength(0)
    expect(afterSecondMiss.expired).toHaveLength(1)
    expect(afterSecondMiss.expired[0]).toMatchObject({ id: 'a', status: 'expired', lastSeenAt: 600 })
  })

  it('a fading row that fires again goes back to active instead of expiring', () => {
    const fading = screenerRow({ id: 'a', status: 'fading', firstSeenAt: 0, lastSeenAt: 300 })
    const incoming = [signalRow({ price: 2600, time: 700 })]

    const { rows, expired } = mergeScanRows([fading], incoming, new Set(['RELIANCE-EQ']), 900)

    expect(expired).toEqual([])
    expect(rows[0]).toMatchObject({ id: 'a', status: 'active', lastSeenAt: 900, price: 2600 })
  })

  it('preserves a pinned flag across an update-in-place (the engine knows nothing about pinning)', () => {
    const pinned = screenerRow({ id: 'a', status: 'active', pinned: true })
    const incoming = [signalRow({ price: 2700 })]

    const { rows } = mergeScanRows([pinned], incoming, new Set(['RELIANCE-EQ']), 500)

    expect(rows[0]).toMatchObject({ pinned: true, price: 2700 })
  })

  it('leaves rows for symbols outside this scan pass untouched (single-symbol rescan case)', () => {
    const untouched = screenerRow({ id: 'other', symbol: 'TCS-EQ', status: 'active', lastSeenAt: 50 })
    const { rows, expired } = mergeScanRows([untouched], [], new Set(['RELIANCE-EQ']), 999)

    expect(expired).toEqual([])
    expect(rows).toEqual([untouched])
  })
})
