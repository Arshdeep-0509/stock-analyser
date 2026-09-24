import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScreenerStore } from '../../../store/screenerStore'
import { makeRow, renderWithRouter, seededStore } from '../../../test-utils/fixtures'
import { FilterBar } from '../FilterBar'
import { SIGNAL_KINDS } from '../rowHelpers'
import { useTableFilters } from '../useTableFilters'

/** FilterBar as the table wires it: the URL-backed filter hook + the store's equity toggle. */
function Harness({ store }: { store: ScreenerStore }) {
  const filters = useTableFilters()
  const show = store((s) => s.showNseEquityRows)
  return <FilterBar filters={filters} showNseEquityRows={show} onShowNseEquityRowsChange={(v) => store.getState().setShowNseEquityRows(v)} />
}

const urlQuery = (): string => screen.getByTestId('location-search').textContent ?? ''

afterEach(() => {
  vi.useRealTimers()
})

describe('FilterBar', () => {
  it('typing in search writes the (debounced) query to the URL search params', async () => {
    // Only the debounce's timers are faked — faking everything also stalls user-event's own scheduling.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    renderWithRouter(<Harness store={seededStore([])} />)

    await user.type(screen.getByRole('textbox', { name: 'Search symbol' }), 'rel')
    expect(urlQuery()).toBe('') // not yet: debounced
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    expect(new URLSearchParams(urlQuery()).get('q')).toBe('rel')
  })

  it('every signal chip toggles, reports its state with aria-pressed (not colour alone), and lands in the URL', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Harness store={seededStore([])} />)
    const group = screen.getByRole('group', { name: 'Filter by signal' })

    for (const signal of SIGNAL_KINDS) {
      const chip = Array.from(group.querySelectorAll('button')).find((b) => b.textContent === signal)
      if (!chip) throw new Error(`no chip for ${signal}`)
      expect(chip).toHaveAttribute('aria-pressed', 'false')
      await user.click(chip)
      expect(chip).toHaveAttribute('aria-pressed', 'true')
      // Decoded the way the app's own parser reads it back (the value is double-encoded in the URL — noted, harmless: it round-trips).
      expect(new URLSearchParams(urlQuery()).get('sig')?.split(',')).toContain(signal)
      await user.click(chip)
      expect(chip).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('a signal with a space is encoded ONCE in the URL (CE+Buy, not CE%2520Buy)', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Harness store={seededStore([])} />)
    await user.click(screen.getByRole('button', { name: 'CE Buy' }))
    expect(urlQuery()).toContain('sig=CE+Buy')
    expect(urlQuery()).not.toContain('%25')
  })

  it('an old double-encoded link (sig=CE%2520Buy) still restores the filter', () => {
    renderWithRouter(<Harness store={seededStore([])} />, ['/rsi-ha?sig=CE%2520Buy,PE+Buy'])
    expect(screen.getByRole('button', { name: 'CE Buy' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'PE Buy' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('"Clear" resets every filter and empties the URL', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Harness store={seededStore([])} />, ['/rsi-ha?q=rel&sig=BUY,SELL&exch=NFO&itype=FUT&rsiMin=60&rsiMax=65&minPrice=2000'])
    expect(screen.getByRole('textbox', { name: 'Search symbol' })).toHaveValue('rel')

    await user.click(screen.getByRole('button', { name: /^Clear \d+ filters?$/ }))
    expect(urlQuery()).toBe('')
    expect(screen.getByRole('textbox', { name: 'Search symbol' })).toHaveValue('')
    expect(screen.queryByRole('button', { name: /^Clear \d+ filters?$/ })).not.toBeInTheDocument()
  })

  it('the RSI sliders write the range to the URL', () => {
    renderWithRouter(<Harness store={seededStore([])} />)
    fireEvent.change(screen.getAllByLabelText('Minimum RSI')[0], { target: { value: '60' } })
    const params = new URLSearchParams(urlQuery())
    expect(params.get('rsiMin')).toBe('60')
  })

  it('the equity toggle changes only what is DISPLAYED — the store\'s computed rows are untouched (parity-critical)', async () => {
    const user = userEvent.setup()
    const equity = makeRow({ symbol: 'RELIANCE-EQ', exchange: 'NSE', signal: 'BUY' })
    const future = makeRow({ symbol: 'RELIANCE26JANFUT', exchange: 'NFO', signal: 'BUY' })
    const store = seededStore([equity, future])
    store.getState().setShowNseEquityRows(false)
    const rowsBefore = store.getState().rows
    const snapshot = structuredClone(rowsBefore)
    expect(store.getState().visibleRows.map((r) => r.symbol)).toEqual(['RELIANCE26JANFUT'])

    renderWithRouter(<Harness store={store} />)
    await user.click(screen.getByRole('switch', { name: /Show underlying equity signals/ }))

    expect(store.getState().showNseEquityRows).toBe(true)
    expect(store.getState().visibleRows.map((r) => r.symbol)).toEqual(['RELIANCE-EQ', 'RELIANCE26JANFUT'])
    expect(store.getState().rows).toBe(rowsBefore) // same array — nothing recomputed
    expect(store.getState().rows).toEqual(snapshot)
  })
})
