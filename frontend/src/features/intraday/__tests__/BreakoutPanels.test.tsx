import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { headerCounts } from '../../../analytics/aggregate'
import { createIntradayStore, type IntradayStore } from '../../../store/intradayStore'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../../data/MarketDataSource'
import type { Candle, Instrument, IntradayRow, MarketTick } from '../../../types/domain'
import type { ScripRow, SearchResponse } from '../../../types/api'
import { BreakoutPanels } from '../BreakoutPanels'

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
    lastTickAt: 1700000000,
    starred: false,
    ...overrides,
  }
}

function makeStore(rows: IntradayRow[]): IntradayStore {
  const store = createIntradayStore({ dataSource: new StubDataSource(), now: () => 0 })
  store.setState((state) => ({
    ...state,
    rows,
    loadState: 'ready',
    lastComputedAt: 1700000000,
    meters: { ...state.meters, headerCounts: headerCounts(rows) },
  }))
  return store
}

let activeStore: IntradayStore | null = null

afterEach(() => {
  activeStore?.getState().stop()
  activeStore = null
})

function panelByTitle(title: string): HTMLElement {
  return screen.getByText(title).closest('section') as HTMLElement
}

describe('BreakoutPanels', () => {
  it('splits rows by direction — BREAKOUT-UP in Breakout, BREAKOUT-DOWN in BreakDown', () => {
    const rows = [
      makeRow({ symbol: 'UP-EQ', breakout: 'BREAKOUT-UP' }),
      makeRow({ symbol: 'DOWN-EQ', breakout: 'BREAKOUT-DOWN' }),
      makeRow({ symbol: 'NONE-EQ', breakout: null }),
    ]
    activeStore = makeStore(rows)
    render(<BreakoutPanels store={activeStore} />)

    const breakout = panelByTitle('Breakout ▲')
    const breakdown = panelByTitle('BreakDown ▼')
    expect(within(breakout).getByText('UP-EQ')).toBeInTheDocument()
    expect(within(breakout).queryByText('DOWN-EQ')).not.toBeInTheDocument()
    expect(within(breakout).queryByText('NONE-EQ')).not.toBeInTheDocument()
    expect(within(breakdown).getByText('DOWN-EQ')).toBeInTheDocument()
    expect(within(breakdown).queryByText('UP-EQ')).not.toBeInTheDocument()
  })

  it('sorts by Strength descending, then |% Ch| descending', () => {
    const rows = [
      makeRow({ symbol: 'LOW-EQ', breakout: 'BREAKOUT-UP', strength: 1, changePct: 9 }),
      makeRow({ symbol: 'HIGH-EQ', breakout: 'BREAKOUT-UP', strength: 9, changePct: 1 }),
      makeRow({ symbol: 'TIE-BIG-EQ', breakout: 'BREAKOUT-UP', strength: 5, changePct: -8 }),
      makeRow({ symbol: 'TIE-SMALL-EQ', breakout: 'BREAKOUT-UP', strength: 5, changePct: 2 }),
    ]
    activeStore = makeStore(rows)
    render(<BreakoutPanels store={activeStore} />)

    const breakout = panelByTitle('Breakout ▲')
    const symbolButtons = within(breakout)
      .getAllByRole('button', { name: /^Open details for/i })
      .map((b) => b.textContent)
    expect(symbolButtons).toEqual(['HIGH-EQ', 'TIE-BIG-EQ', 'TIE-SMALL-EQ', 'LOW-EQ'])
  })

  it('a NaN strength always sorts last, regardless of its % change', () => {
    const rows = [
      makeRow({ symbol: 'NAN-EQ', breakout: 'BREAKOUT-UP', strength: NaN, changePct: 50 }),
      makeRow({ symbol: 'REAL-EQ', breakout: 'BREAKOUT-UP', strength: 0.1, changePct: 0.1 }),
    ]
    activeStore = makeStore(rows)
    render(<BreakoutPanels store={activeStore} />)

    const breakout = panelByTitle('Breakout ▲')
    const symbolButtons = within(breakout)
      .getAllByRole('button', { name: /^Open details for/i })
      .map((b) => b.textContent)
    expect(symbolButtons).toEqual(['REAL-EQ', 'NAN-EQ'])
  })

  it('the count badge matches the header-strip breakout counts', () => {
    const rows = [makeRow({ breakout: 'BREAKOUT-UP' }), makeRow({ breakout: 'BREAKOUT-UP' }), makeRow({ breakout: 'BREAKOUT-DOWN' })]
    activeStore = makeStore(rows)
    render(<BreakoutPanels store={activeStore} />)

    const breakoutHeader = panelByTitle('Breakout ▲').querySelector('header') as HTMLElement
    const breakdownHeader = panelByTitle('BreakDown ▼').querySelector('header') as HTMLElement
    expect(within(breakoutHeader).getByText('2')).toBeInTheDocument()
    expect(within(breakdownHeader).getByText('1')).toBeInTheDocument()
  })

  it('the companion chart counts breakouts per sector, top 5 descending, with integer labels', () => {
    const rows = [
      makeRow({ sector: 'Banks', breakout: 'BREAKOUT-UP' }),
      makeRow({ sector: 'Banks', breakout: 'BREAKOUT-UP' }),
      makeRow({ sector: 'IT Software', breakout: 'BREAKOUT-UP' }),
    ]
    activeStore = makeStore(rows)
    render(<BreakoutPanels store={activeStore} />)

    const breakout = panelByTitle('Breakout ▲')
    const chart = within(breakout).getByRole('img', { name: /breakouts by sector/i })
    expect(within(chart).getByRole('button', { name: /filter to banks, 2 breakouts/i })).toBeInTheDocument()
    expect(within(chart).getByRole('button', { name: /filter to it software, 1 breakout$/i })).toBeInTheDocument()
  })

  it('clicking a companion-chart bar filters the table to that sector; clicking again clears it', async () => {
    const user = userEvent.setup()
    const rows = [
      makeRow({ symbol: 'BANK-EQ', sector: 'Banks', breakout: 'BREAKOUT-UP' }),
      makeRow({ symbol: 'IT-EQ', sector: 'IT Software', breakout: 'BREAKOUT-UP' }),
    ]
    activeStore = makeStore(rows)
    render(<BreakoutPanels store={activeStore} />)

    const breakout = panelByTitle('Breakout ▲')
    await user.click(within(breakout).getByRole('button', { name: /filter to banks,/i }))

    expect(activeStore.getState().filters.sector).toBe('Banks')
    expect(within(breakout).getByText('BANK-EQ')).toBeInTheDocument()
    expect(within(breakout).queryByText('IT-EQ')).not.toBeInTheDocument()

    await user.click(within(breakout).getByRole('button', { name: /filter to banks,/i }))
    expect(activeStore.getState().filters.sector).toBeNull()
  })

  it('shows the domain-specific empty state, with the last-checked time and the lookback bar count, when there are no breakouts at all', () => {
    activeStore = makeStore([makeRow({ breakout: null })])
    render(<BreakoutPanels store={activeStore} />)

    const breakout = panelByTitle('Breakout ▲')
    expect(within(breakout).getByText(/No instrument has closed above its 20-bar high since 09:15/)).toBeInTheDocument()
    expect(within(breakout).getByText(/20-bar lookback/)).toBeInTheDocument()
    expect(within(breakout).getByText(/1 instruments scanned/)).toBeInTheDocument()

    const breakdown = panelByTitle('BreakDown ▼')
    expect(within(breakdown).getByText(/No instrument has closed below its 20-bar low since 09:15/)).toBeInTheDocument()
  })

  it('shows a generic filtered-empty state with a one-click clear when dashboard filters exclude every breakout row', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ sector: 'Banks', breakout: 'BREAKOUT-UP' })])
    activeStore.getState().setFilters({ sector: 'IT Software' })
    render(<BreakoutPanels store={activeStore} />)

    const breakout = panelByTitle('Breakout ▲')
    expect(within(breakout).getByText('No names match the current filters.')).toBeInTheDocument()

    await user.click(within(breakout).getByRole('button', { name: 'Clear filters' }))
    expect(activeStore.getState().filters.sector).toBeNull()
  })

  it("the Symbol button opens (and toggles closed) the drill-down selection", async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ symbol: 'HDFCBANK-EQ', token: 'TOK1', breakout: 'BREAKOUT-UP' })])
    render(<BreakoutPanels store={activeStore} />)

    const btn = screen.getByRole('button', { name: 'Open details for HDFCBANK-EQ' })
    await user.click(btn)
    expect(activeStore.getState().selectedToken).toBe('TOK1')

    await user.click(btn)
    expect(activeStore.getState().selectedToken).toBeNull()
  })

  it('the star marker toggles starred state from within either table', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ token: 'TOK1', breakout: 'BREAKOUT-UP', starred: false })])
    render(<BreakoutPanels store={activeStore} />)

    await user.click(screen.getByRole('button', { name: 'Add your marker' }))
    expect(screen.getByRole('button', { name: 'Remove your marker' })).toHaveAttribute('aria-pressed', 'true')
  })
})
