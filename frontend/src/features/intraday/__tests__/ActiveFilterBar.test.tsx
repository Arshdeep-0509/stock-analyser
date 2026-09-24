import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createIntradayStore, type IntradayStore } from '../../../store/intradayStore'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../../data/MarketDataSource'
import type { Candle, Instrument, IntradayRow, MarketTick } from '../../../types/domain'
import type { ScripRow, SearchResponse } from '../../../types/api'
import { ActiveFilterBar } from '../ActiveFilterBar'

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

let tokenCounter = 0
function makeRow(overrides: Partial<IntradayRow> = {}): IntradayRow {
  tokenCounter += 1
  return {
    symbol: `SYM${tokenCounter}-EQ`,
    baseSymbol: `SYM${tokenCounter}`,
    token: `T${tokenCounter}`,
    exchange: 'NSE',
    sector: 'Others',
    indices: [],
    cmp: 100,
    prevClose: 100,
    changePct: 0,
    change3dPct: 0,
    dayOpen: 100,
    dayHigh: 100,
    dayLow: 100,
    vwap: 100,
    strength: 0,
    strengthTone: 'none',
    intradayDir: 'up',
    breakout: null,
    breakoutLevel: null,
    rvol: 1,
    zMove: 0,
    persistence: 0,
    cachedClose: 100,
    lastTickAt: 0,
    starred: false,
    ...overrides,
  }
}

function makeStore(rows: IntradayRow[]): IntradayStore {
  const store = createIntradayStore({ dataSource: new StubDataSource(), now: () => 0 })
  store.setState((state) => ({ ...state, rows, loadState: 'ready' }))
  return store
}

let activeStore: IntradayStore | null = null

afterEach(() => {
  activeStore?.getState().stop()
  activeStore = null
})

describe('ActiveFilterBar', () => {
  it('renders nothing when no filter is active', () => {
    activeStore = makeStore([makeRow()])
    const { container } = render(<ActiveFilterBar store={activeStore} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a chip per active dimension and the live "Showing N of M" count', () => {
    const rows = [makeRow({ sector: 'Banks' }), makeRow({ sector: 'IT Software' })]
    activeStore = makeStore(rows)
    activeStore.getState().setFilters({ sector: 'Banks', breakoutOnly: true })
    render(<ActiveFilterBar store={activeStore} />)

    expect(screen.getByText('Sector: Banks')).toBeInTheDocument()
    expect(screen.getByText('Breakout only')).toBeInTheDocument()
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 0 of 2 F&O names') // Banks + breakoutOnly, but no row has a breakout
  })

  it('includes a smart-money-only chip', () => {
    activeStore = makeStore([makeRow()])
    activeStore.getState().setFilters({ smartMoneyOnly: true })
    render(<ActiveFilterBar store={activeStore} />)
    expect(screen.getByText('Smart money only')).toBeInTheDocument()
  })

  it('clicking a chip clears just that dimension', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ sector: 'Banks' })])
    activeStore.getState().setFilters({ sector: 'Banks', breakoutOnly: true })
    render(<ActiveFilterBar store={activeStore} />)

    await user.click(screen.getByText('Sector: Banks'))
    expect(activeStore.getState().filters.sector).toBeNull()
    expect(activeStore.getState().filters.breakoutOnly).toBe(true) // untouched
  })

  it('"Clear all" resets every dimension at once', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow()])
    activeStore.getState().setFilters({ sector: 'Banks', breakoutOnly: true, minStrength: 2 })
    render(<ActiveFilterBar store={activeStore} />)

    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    const filters = activeStore.getState().filters
    expect(filters.sector).toBeNull()
    expect(filters.breakoutOnly).toBe(false)
    expect(filters.minStrength).toBe(0)
  })
})
