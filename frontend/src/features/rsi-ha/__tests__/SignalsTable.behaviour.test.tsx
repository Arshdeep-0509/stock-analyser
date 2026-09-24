import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScanResult } from '../scanner'
import { DEFAULT_PARAMS } from '../../../strategy/constants'
import { createScreenerStore, type ScreenerStore } from '../../../store/screenerStore'
import type { ScreenerRow } from '../../../store/types'
import { FIXTURE_NOW, makeRow, mockViewportDimensions, NoopDataSource, renderWithRouter, seededStore } from '../../../test-utils/fixtures'
import { SignalsTable } from '../SignalsTable'

// lightweight-charts cannot render in jsdom (no canvas); the drawer's chart is replaced by a marker.
vi.mock('../SignalChart', () => ({ SignalChart: () => <div data-testid="signal-chart" /> }))

let restoreViewport: () => void
beforeEach(() => {
  restoreViewport = mockViewportDimensions()
})
afterEach(() => {
  restoreViewport()
  vi.useRealTimers()
})

function renderTable(store: ScreenerStore) {
  return renderWithRouter(<SignalsTable store={store} />)
}

/** Data rows only (the header row has columnheaders, not gridcells), in DOM order. */
function dataRows(): HTMLElement[] {
  return screen.getAllByRole('row').filter((r) => within(r).queryAllByRole('gridcell').length > 0)
}
const symbolsInOrder = (): string[] => dataRows().map((r) => within(r).getAllByRole('gridcell')[1].textContent?.replace(/(NSE|NFO).*$/, '') ?? '')
const header = (name: string): HTMLElement => screen.getByRole('columnheader', { name: new RegExp(`^${name}`) })

describe('SignalsTable — rendering', () => {
  it('renders one row per visible signal plus the sticky header row', () => {
    const rows = [makeRow(), makeRow(), makeRow()]
    renderTable(seededStore(rows))
    expect(dataRows()).toHaveLength(3)
    const headerRow = screen.getAllByRole('row').find((r) => within(r).queryAllByRole('columnheader').length > 0)
    expect(headerRow).toBeDefined()
    expect(headerRow?.className).toMatch(/sticky/)
    expect(screen.getByRole('grid', { name: 'Signals' })).toHaveAttribute('aria-rowcount', '3')
  })
})

describe('SignalsTable — sorting', () => {
  it('a header click sorts by that column; a second click reverses; aria-sort follows', async () => {
    const user = userEvent.setup()
    renderTable(seededStore([makeRow({ symbol: 'BBBFUT', price: 2 }), makeRow({ symbol: 'AAAFUT', price: 3 }), makeRow({ symbol: 'CCCFUT', price: 1 })]))

    await user.click(header('Price'))
    expect(header('Price')).toHaveAttribute('aria-sort', 'ascending')
    expect(symbolsInOrder()).toEqual(['CCCFUT', 'BBBFUT', 'AAAFUT'])

    await user.click(header('Price'))
    expect(header('Price')).toHaveAttribute('aria-sort', 'descending')
    expect(symbolsInOrder()).toEqual(['AAAFUT', 'BBBFUT', 'CCCFUT'])
    expect(header('Symbol')).toHaveAttribute('aria-sort', 'none')
  })

  it('shift-click adds a secondary sort key that breaks ties', async () => {
    const user = userEvent.setup()
    renderTable(
      seededStore([
        makeRow({ symbol: 'BFUT', signal: 'SELL', price: 10 }),
        makeRow({ symbol: 'AFUT', signal: 'BUY', price: 20 }),
        makeRow({ symbol: 'CFUT', signal: 'BUY', price: 5 }),
      ]),
    )
    await user.click(header('Signal'))
    await user.keyboard('{Shift>}')
    await user.click(header('Price'))
    await user.keyboard('{/Shift}')

    expect(header('Signal')).toHaveAttribute('aria-sort', 'ascending')
    expect(header('Price')).toHaveAttribute('aria-sort', 'ascending')
    expect(symbolsInOrder()).toEqual(['CFUT', 'AFUT', 'BFUT']) // BUY(5), BUY(20), SELL
    expect(within(header('Price')).getByText('2')).toBeInTheDocument() // rank marker for the secondary key
  })
})

describe('SignalsTable — keyboard and drawer', () => {
  it('j / k move the selection, Enter opens the drawer, Esc closes it', async () => {
    const user = userEvent.setup()
    const store = seededStore([makeRow({ symbol: 'ONEFUT', time: FIXTURE_NOW - 300 }), makeRow({ symbol: 'TWOFUT', time: FIXTURE_NOW - 600 })])
    renderTable(store)

    await user.keyboard('j')
    expect(dataRows()[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('j')
    expect(dataRows()[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('k')
    expect(dataRows()[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Enter}')
    expect(await screen.findByRole('heading', { name: 'ONEFUT' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('heading', { name: 'ONEFUT' })).not.toBeInTheDocument()
  })
})

describe('SignalsTable — pinning', () => {
  it('the pin button moves a row to the top, and it stays there through a re-sort in either direction', async () => {
    const user = userEvent.setup()
    const store = seededStore([makeRow({ symbol: 'AFUT', price: 1 }), makeRow({ symbol: 'BFUT', price: 2 }), makeRow({ symbol: 'CFUT', price: 3 })])
    renderTable(store)
    await user.click(header('Price'))
    expect(symbolsInOrder()).toEqual(['AFUT', 'BFUT', 'CFUT'])

    const cRow = dataRows()[2]
    await user.click(within(cRow).getByRole('button', { name: 'Pin' }))
    expect(symbolsInOrder()[0]).toBe('CFUT')

    await user.click(header('Price'))
    expect(symbolsInOrder()).toEqual(['CFUT', 'BFUT', 'AFUT'])
    await user.click(header('Price')) // third click: unsorted
    await user.click(header('Price'))
    expect(symbolsInOrder()[0]).toBe('CFUT')
  })
})

describe('SignalsTable — errors and empty state', () => {
  it('the error strip shows the failed-instrument count and expands to list each one', async () => {
    const user = userEvent.setup()
    const errors = [
      { symbol: 'BAD1FUT', message: 'simulated failure one' },
      { symbol: 'BAD2FUT', message: 'simulated failure two' },
    ]
    renderTable(seededStore([makeRow()], { errors }))
    const toggle = screen.getByRole('button', { name: /2 instruments failed/ })
    expect(screen.queryByText('simulated failure one')).not.toBeInTheDocument()
    await user.click(toggle)
    expect(screen.getByText('simulated failure one')).toBeInTheDocument()
    expect(screen.getByText('BAD2FUT')).toBeInTheDocument()
  })

  it('the empty state names the ACTUAL bands from params, not a hardcoded string', () => {
    const params = { ...DEFAULT_PARAMS, rsiBuyLow: 55, rsiBuyHigh: 70, rsiSellLow: 25, rsiSellHigh: 45 }
    renderTable(seededStore([], { params, universe: [{ symbol: 'XFUT', token: '1', exchange: 'NFO' }] }))
    const text = screen.getByText(/No instrument currently satisfies/).textContent ?? ''
    expect(text).toContain('55–70')
    expect(text).toContain('25–45')
    expect(text).not.toContain('60–65')
  })

  it('with default params the empty state names the default bands', () => {
    renderTable(seededStore([]))
    const text = screen.getByText(/No instrument currently satisfies/).textContent ?? ''
    expect(text).toContain(`${DEFAULT_PARAMS.rsiBuyLow}–${DEFAULT_PARAMS.rsiBuyHigh}`)
    expect(text).toContain(`${DEFAULT_PARAMS.rsiSellLow}–${DEFAULT_PARAMS.rsiSellHigh}`)
  })
})

describe('SignalsTable — scan countdown', () => {
  it('counts down on the SIMULATED clock the scans run on, not the wall clock', () => {
    // The fixture store's clock is 2026-01-05 13:00 IST, far from the real date: a
    // wall-clock countdown would show 0s (or garbage) here instead of 300s.
    renderTable(seededStore([makeRow()], { nextScanAt: FIXTURE_NOW + 300 }))
    expect(screen.getByText(/next scan in 300s/)).toBeInTheDocument()
  })

  it('the empty state names the same simulated countdown', () => {
    renderTable(seededStore([], { nextScanAt: FIXTURE_NOW + 120 }))
    expect(screen.getByText('Next scan in 120s')).toBeInTheDocument()
  })
})

describe('SignalsTable — aria-live announcements', () => {
  /** A store whose scans return scripted results, driven through the REAL runScanNow(). */
  function scriptedStore(scans: ScreenerRow[][]): ScreenerStore {
    let call = 0
    return createScreenerStore({
      dataSource: new NoopDataSource(),
      now: () => FIXTURE_NOW,
      runScan: async (): Promise<ScanResult> => {
        const rows = scans[Math.min(call, scans.length - 1)]
        call += 1
        return { rows, errors: [], visibleRows: rows }
      },
    })
  }
  const liveRegion = (): HTMLElement => {
    const region = document.querySelector('[aria-live="polite"]')
    if (!(region instanceof HTMLElement)) throw new Error('no aria-live region')
    return region
  }

  it('the first scan announces nothing — it is the starting state, not news', async () => {
    const a = makeRow({ symbol: 'AAAFUT' })
    const store = scriptedStore([[a]])
    renderTable(store)
    await act(() => store.getState().runScanNow())
    expect(dataRows()).toHaveLength(1)
    expect(liveRegion().textContent).toBe('')
  })

  it('a later scan that produces a genuinely new signal announces it exactly once', async () => {
    const a = makeRow({ symbol: 'AAAFUT' })
    const b = makeRow({ symbol: 'BBBFUT', signal: 'SELL', rsi: 37.5 })
    const store = scriptedStore([[a], [a, b], [a, b]])
    renderTable(store)
    await act(() => store.getState().runScanNow())

    // A screen reader speaks when the live region's content CHANGES — count those changes, not the resting text.
    const announcements: string[] = []
    const observer = new MutationObserver(() => announcements.push(liveRegion().textContent ?? ''))
    observer.observe(liveRegion(), { childList: true, characterData: true, subtree: true })

    await act(() => store.getState().runScanNow())
    await act(() => store.getState().runScanNow()) // the same row set again: not news
    observer.disconnect()

    const spoken = announcements.filter((t) => t !== '')
    expect(spoken).toHaveLength(1)
    expect(spoken[0]).toContain('BBBFUT')
    expect(spoken[0]).not.toContain('AAAFUT')
    expect(spoken[0].split('BBBFUT')).toHaveLength(2)
  })

  it('a parameter what-if (immediateReplace) announces nothing, even though every row is new', async () => {
    const store = scriptedStore([[makeRow({ symbol: 'AAAFUT' })], [makeRow({ symbol: 'ZZZFUT' }), makeRow({ symbol: 'YYYFUT' })]])
    renderTable(store)
    await act(() => store.getState().runScanNow())
    await act(() => store.getState().runScanNow({ immediateReplace: true }))
    expect(dataRows()).toHaveLength(2)
    expect(liveRegion().textContent).toBe('')
  })
})
