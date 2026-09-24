import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIntradayStore, type IntradayStore } from '../../../store/intradayStore'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../../data/MarketDataSource'
import type { Candle, Instrument, IntradayRow, MarketTick } from '../../../types/domain'
import type { ScripRow, SearchResponse } from '../../../types/api'
import { IntradayIndexChart } from '../IntradayIndexChart'

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
    symbol: 'X-EQ',
    baseSymbol: 'X',
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
  store.setState((state) => ({ ...state, rows, meterRows: rows, loadState: 'ready' }))
  return store
}

function setMatchMedia(matchesFor: (query: string) => boolean): void {
  window.matchMedia = ((query: string) =>
    ({
      matches: matchesFor(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia
}

const originalMatchMedia = window.matchMedia

let activeStore: IntradayStore | null = null

beforeEach(() => {
  setMatchMedia(() => false)
})

afterEach(() => {
  activeStore?.getState().stop()
  activeStore = null
  window.matchMedia = originalMatchMedia
})

describe('IntradayIndexChart', () => {
  it('renders one row per sector, sorted descending by mean change', () => {
    const rows = [
      makeRow({ sector: 'Banks', changePct: -3 }),
      makeRow({ sector: 'IT Software', changePct: 5 }),
    ]
    activeStore = makeStore(rows)
    render(<IntradayIndexChart store={activeStore} />)

    const table = screen.getByText('Intraday index').closest('table')!
    const sectorNames = Array.from(table.querySelectorAll('tbody th')).map((th) => th.textContent)
    expect(sectorNames[0]).toBe('IT Software')
    expect(sectorNames[1]).toBe('Banks')
  })

  it('does not fold small sectors into Others — every sector present gets its own row', () => {
    const rows = [makeRow({ sector: 'Aerospace Defence', changePct: 2 })]
    activeStore = makeStore(rows)
    render(<IntradayIndexChart store={activeStore} />)
    const table = screen.getByText('Intraday index').closest('table')!
    expect(within(table).getByText('Aerospace Defence')).toBeInTheDocument()
  })

  it('clicking a bar filters the dashboard to that sector; clicking again clears it', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ sector: 'Banks', changePct: 3 })])
    render(<IntradayIndexChart store={activeStore} />)

    const bar = screen.getByRole('button', { name: /filter to banks,/i })
    await user.click(bar)
    expect(activeStore.getState().filters.sector).toBe('Banks')

    await user.click(bar)
    expect(activeStore.getState().filters.sector).toBeNull()
  })

  it('the "vs day open" toggle recomputes the mean from dayOpen instead of prevClose', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ sector: 'Banks', cmp: 110, dayOpen: 100, changePct: 999 })])
    render(<IntradayIndexChart store={activeStore} />)

    const table = screen.getByText('Intraday index').closest('table')!
    expect(within(table).getByText('+999.0%')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'vs day open' }))
    expect(within(table).getByText('+10.0%')).toBeInTheDocument()
  })

  it('the "Cap-weight (approx.)" toggle reorders the chart', async () => {
    const user = userEvent.setup()
    const rows = [
      makeRow({ sector: 'A', changePct: 10, cachedClose: 1 }),
      makeRow({ sector: 'A', changePct: 0, cachedClose: 99 }),
      makeRow({ sector: 'B', changePct: 4, cachedClose: 1 }),
    ]
    activeStore = makeStore(rows)
    render(<IntradayIndexChart store={activeStore} />)

    let table = screen.getByText('Intraday index').closest('table')!
    let sectorNames = Array.from(table.querySelectorAll('tbody th')).map((th) => th.textContent)
    expect(sectorNames[0]).toBe('A') // equal-weight: mean(10,0)=5 > B's 4

    await user.click(screen.getByRole('radio', { name: 'Cap-weight (approx.)' }))

    table = screen.getByText('Intraday index').closest('table')!
    sectorNames = Array.from(table.querySelectorAll('tbody th')).map((th) => th.textContent)
    expect(sectorNames[0]).toBe('B') // cap-weighted A ≈ 0.1 < B's 4
  })

  it('shows a tooltip with mean change, best/worst constituents, and breakout counts', async () => {
    const user = userEvent.setup()
    const rows = [
      makeRow({ sector: 'Banks', symbol: 'HDFCBANK-EQ', changePct: 5, breakout: 'BREAKOUT-UP' }),
      makeRow({ sector: 'Banks', symbol: 'ICICIBANK-EQ', changePct: -2, breakout: 'BREAKOUT-DOWN' }),
    ]
    activeStore = makeStore(rows)
    render(<IntradayIndexChart store={activeStore} />)

    await user.hover(screen.getByRole('button', { name: /filter to banks,/i }))

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Banks')
    expect(tooltip).toHaveTextContent('HDFCBANK-EQ')
    expect(tooltip).toHaveTextContent('ICICIBANK-EQ')
    expect(tooltip).toHaveTextContent('2 names')
  })

  it('renders a readable empty state when no rows are loaded yet', () => {
    activeStore = makeStore([])
    render(<IntradayIndexChart store={activeStore} />)
    expect(screen.getByText('No F&O names loaded yet.')).toBeInTheDocument()
  })

  it('switches to horizontal rows (no chart SVG) at narrow (sm) widths', () => {
    setMatchMedia((q) => q.includes('max-width'))
    activeStore = makeStore([makeRow({ sector: 'Banks' })])
    const { container } = render(<IntradayIndexChart store={activeStore} />)
    expect(container.querySelector('svg[role="img"]')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /filter to banks,/i })).toBeInTheDocument()
  })

  it('renders the diverging chart SVG above sm width', () => {
    activeStore = makeStore([makeRow({ sector: 'Banks' })])
    const { container } = render(<IntradayIndexChart store={activeStore} />)
    expect(container.querySelector('svg[role="img"]')).toBeInTheDocument()
  })
})
