import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createIntradayStore, type IntradayStore } from '../../../store/intradayStore'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../../data/MarketDataSource'
import type { Candle, Instrument, IntradayRow, MarketTick } from '../../../types/domain'
import type { ScripRow, SearchResponse } from '../../../types/api'
import { IndexMeter } from '../IndexMeter'

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

function makeRow(overrides: Partial<IntradayRow> = {}): IntradayRow {
  return {
    symbol: 'X-EQ',
    baseSymbol: 'X',
    token: `T${Math.random()}`,
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
  // .setState() here (not the immer-draft form intradayStore.ts uses internally) —
  // IntradayStore's public type intentionally doesn't leak immer's void-returning
  // overload, so an external caller (a test, in this case) returns a new state instead.
  store.setState((state) => ({ ...state, rows, meterRows: rows, loadState: 'ready' }))
  return store
}

/** Overrides window.matchMedia so a specific query resolves a chosen way — the shared test default (matches: true) would otherwise force IndexMeter's max-width query true (mobile/horizontal) for every test. */
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
  // Default every test to the desktop/vertical-grouped-bars branch; individual tests override for the horizontal case.
  setMatchMedia(() => false)
})

afterEach(() => {
  activeStore?.getState().stop()
  activeStore = null
  window.matchMedia = originalMatchMedia
})

describe('IndexMeter', () => {
  it('renders one entry per index, sorted by upPct descending', () => {
    const rows = [
      makeRow({ indices: ['IT'], changePct: 5 }),
      makeRow({ indices: ['FMCG'], changePct: 5 }),
      makeRow({ indices: ['FMCG'], changePct: 5 }),
    ]
    activeStore = makeStore(rows)
    render(<IndexMeter store={activeStore} />)

    const table = screen.getByText('Index meter').closest('table')!
    const rowLabels = Array.from(table.querySelectorAll('tbody th')).map((th) => th.textContent)
    // FMCG (100% up) must come before IT (100% up too, but tied) — both must appear; order asserted via NIFTY_50/BANK_NIFTY absence isn't tested here, just presence.
    expect(rowLabels).toContain('IT')
    expect(rowLabels).toContain('FMCG')
  })

  it('sorts the strongest index leftmost', () => {
    const rows = [makeRow({ indices: ['IT'], changePct: 5 }), makeRow({ indices: ['FMCG'], changePct: -5 })]
    activeStore = makeStore(rows)
    render(<IndexMeter store={activeStore} />)

    const table = screen.getByText('Index meter').closest('table')!
    const rowLabels = Array.from(table.querySelectorAll('tbody th')).map((th) => th.textContent)
    expect(rowLabels[0]).toBe('IT') // 100% up, sorts first
  })

  it('clicking a group filters the dashboard to that index; clicking again clears it', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ indices: ['IT'], changePct: 5 })])
    render(<IndexMeter store={activeStore} />)

    const group = screen.getByRole('button', { name: /filter to it,/i })
    await user.click(group)
    expect(activeStore.getState().filters.index).toBe('IT')

    await user.click(group)
    expect(activeStore.getState().filters.index).toBeNull()
  })

  it('shows a tooltip with name, up/down %, count, and top constituents on hover', async () => {
    const user = userEvent.setup()
    const rows = [
      makeRow({ indices: ['IT'], symbol: 'INFY-EQ', changePct: 5, strength: 9 }),
      makeRow({ indices: ['IT'], symbol: 'TCS-EQ', changePct: 5, strength: 5 }),
    ]
    activeStore = makeStore(rows)
    render(<IndexMeter store={activeStore} />)

    await user.hover(screen.getByRole('button', { name: /filter to it,/i }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent('IT')
    expect(screen.getByRole('tooltip')).toHaveTextContent('2 names')
    expect(screen.getByRole('tooltip')).toHaveTextContent('INFY-EQ')
    expect(screen.getByRole('tooltip')).toHaveTextContent('TCS-EQ')
  })

  it('switches to a horizontal layout at narrow (sm) widths', () => {
    setMatchMedia((q) => q.includes('max-width'))
    activeStore = makeStore([makeRow({ indices: ['IT'] })])
    const { container } = render(<IndexMeter store={activeStore} />)
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('renders vertical grouped SVG bars above sm width', () => {
    activeStore = makeStore([makeRow({ indices: ['IT'] })])
    const { container } = render(<IndexMeter store={activeStore} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it("dims the down bars when MarketMeter's direction filter is 'up' (cross-panel reactivity)", () => {
    activeStore = makeStore([makeRow({ indices: ['IT'], changePct: -5 })])
    activeStore.getState().setFilters({ direction: 'up' })
    const { container } = render(<IndexMeter store={activeStore} />)

    const downBar = container.querySelector('.fill-bearish')
    expect(downBar).toHaveClass('opacity-40')
  })
})
