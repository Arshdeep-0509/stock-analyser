import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createIntradayStore, DEFAULT_FILTERS, type IntradayStore } from '../../../store/intradayStore'
import { useUiStore } from '../../../store/uiStore'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../../data/MarketDataSource'
import type { Candle, Instrument, MarketTick } from '../../../types/domain'
import type { ScripRow, SearchResponse } from '../../../types/api'
import { useIntradayShortcuts } from '../useIntradayShortcuts'

class StubDataSource implements MarketDataSource {
  async searchSymbol(): Promise<SearchResponse> {
    return { error: null, result: [] }
  }
  async fetchHistoricalCandles(): Promise<Candle[]> {
    return []
  }
  async loadScripMaster(): Promise<ScripRow[]> {
    return []
  }
  subscribeTicks(_tokens: string[], _onTick: (tick: MarketTick) => void): () => void {
    return () => {}
  }
  getConnectionState(): ConnectionState {
    return 'connected'
  }
  async fetchIndexQuotes(keys: IndexQuoteKey[]): Promise<IndexQuote[]> {
    return keys.map((key) => ({ key, label: key, last: 0, prevClose: 0, changePct: 0, time: 0 }))
  }
  async fetchDailyBars(_instrument: Pick<Instrument, 'token' | 'exchange'>): Promise<Candle[]> {
    return []
  }
}

const SEARCH_ID = 'test-search-input'

function Host({ store }: { store: IntradayStore }) {
  useIntradayShortcuts(store, SEARCH_ID)
  const selectedToken = store((s) => s.selectedToken)
  return (
    <div>
      <input id={SEARCH_ID} aria-label="Search" />
      {selectedToken && <span>selected: {selectedToken}</span>}
    </div>
  )
}

function makeStore(): IntradayStore {
  return createIntradayStore({ dataSource: new StubDataSource(), now: () => 0 })
}

let activeStore: IntradayStore | null = null

afterEach(() => {
  activeStore?.getState().stop()
  activeStore = null
  useUiStore.getState().setShortcutsOverlayOpen(false)
})

describe('useIntradayShortcuts', () => {
  it('"/" focuses the search input', async () => {
    const user = userEvent.setup()
    activeStore = makeStore()
    render(<Host store={activeStore} />)

    await user.keyboard('/')
    expect(screen.getByLabelText('Search')).toHaveFocus()
  })

  it('does not intercept "/" while already typing in a field', async () => {
    const user = userEvent.setup()
    activeStore = makeStore()
    render(<Host store={activeStore} />)

    const input = screen.getByLabelText<HTMLInputElement>('Search')
    input.focus()
    await user.keyboard('/')
    expect(input.value).toBe('/') // typed literally, not swallowed as a shortcut
  })

  it('"s" cycles the sector filter through SECTORS, wrapping back to null', async () => {
    const user = userEvent.setup()
    activeStore = makeStore()
    render(<Host store={activeStore} />)

    await user.keyboard('s')
    const first = activeStore.getState().filters.sector
    expect(first).not.toBeNull()

    await user.keyboard('s')
    const second = activeStore.getState().filters.sector
    expect(second).not.toBe(first)
  })

  it('"b" toggles breakout-only', async () => {
    const user = userEvent.setup()
    activeStore = makeStore()
    render(<Host store={activeStore} />)

    await user.keyboard('b')
    expect(activeStore.getState().filters.breakoutOnly).toBe(true)
    await user.keyboard('b')
    expect(activeStore.getState().filters.breakoutOnly).toBe(false)
  })

  it('Escape closes the drawer first, then clears filters on a second press', async () => {
    const user = userEvent.setup()
    activeStore = makeStore()
    activeStore.getState().setFilters({ breakoutOnly: true })
    activeStore.getState().selectToken('TOK1')
    render(<Host store={activeStore} />)

    expect(screen.getByText('selected: TOK1')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(activeStore.getState().selectedToken).toBeNull()
    expect(activeStore.getState().filters.breakoutOnly).toBe(true) // filters untouched by the FIRST Escape

    await user.keyboard('{Escape}')
    expect(activeStore.getState().filters).toEqual(DEFAULT_FILTERS)
  })

  it('does nothing when the global shortcuts overlay is open, leaving it to close first', async () => {
    const user = userEvent.setup()
    activeStore = makeStore()
    activeStore.getState().setFilters({ breakoutOnly: true })
    useUiStore.getState().setShortcutsOverlayOpen(true)
    render(<Host store={activeStore} />)

    await user.keyboard('{Escape}')
    expect(activeStore.getState().filters.breakoutOnly).toBe(true) // untouched — the overlay owns this Escape
  })
})
