import { afterEach, describe, expect, it } from 'vitest'
import { makeMock, makeScreener, scanOnce, SESSION_NOW, strategyView } from '../../../test-utils/realMock'
import type { ScreenerStore } from '../../../store/screenerStore'

/**
 * GOLDEN MASTER. The complete row set the real pipeline (mock scrip master
 * -> universe loaders -> scanWatchlist -> option legs -> store) produces at
 * the default seed on a frozen clock, snapshotted field by field.
 *
 * Any change to the port, the mock generator or the scan pipeline that moves
 * a single symbol, signal, price, RSI, level or streak shows up here as a
 * snapshot diff a human has to look at and approve (`vitest -u`). If the
 * change is not intended, it's a regression; if it is, the diff is the
 * record of exactly what moved.
 */
let store: ScreenerStore | null = null
afterEach(() => {
  store?.getState().stop()
  store = null
})

describe('golden master — full scan at the default seed', () => {
  it('produces exactly the committed row set', async () => {
    const source = makeMock({ now: SESSION_NOW })
    store = makeScreener(source)
    await scanOnce(store, { immediateReplace: true })

    const state = store.getState()
    expect(state.scanState).toBe('done')
    expect(state.errors).toEqual([])
    expect(state.rows.length).toBeGreaterThan(0)

    expect({
      universeSize: state.universe.length,
      rowCount: state.rows.length,
      rows: strategyView(state.rows),
    }).toMatchSnapshot()
  }, 30_000)
})
