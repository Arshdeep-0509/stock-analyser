import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIntradayStore, type IntradayStore } from '../../../store/intradayStore'
import { useStarredStore } from '../../../store/starredStore'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../../data/MarketDataSource'
import type { Candle, Instrument, IntradayRow, MarketTick } from '../../../types/domain'
import type { ScripRow, SearchResponse } from '../../../types/api'
import { TopStrengthTable } from '../TopStrengthTable'

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
  store.setState((state) => ({ ...state, rows, loadState: 'ready' }))
  return store
}

/** jsdom reports 0 for every clientHeight/offsetHeight — @tanstack/react-virtual would then see a zero-height viewport and render nothing. Same fix SignalsTable's own tests use. */
function mockViewportDimensions(): () => void {
  const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 })
  return () => {
    if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight)
    if (offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
  }
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
let restoreViewport: () => void
let activeStore: IntradayStore | null = null

function symbolNamesInOrder(): string[] {
  return screen.getAllByRole('button', { name: /^Open details for/i }).map((btn) => btn.textContent ?? '')
}

beforeEach(() => {
  restoreViewport = mockViewportDimensions()
  setMatchMedia(() => true) // desktop grid + reduced-motion default, matching the app-wide test polyfill
})

afterEach(() => {
  restoreViewport()
  window.matchMedia = originalMatchMedia
  activeStore?.getState().stop()
  activeStore = null
  useStarredStore.setState({ tokens: new Set() })
})

describe('TopStrengthTable', () => {
  it('defaults to Strength descending', () => {
    const rows = [makeRow({ symbol: 'LOW-EQ', strength: 1 }), makeRow({ symbol: 'HIGH-EQ', strength: 9 }), makeRow({ symbol: 'MID-EQ', strength: 5 })]
    activeStore = makeStore(rows)
    render(<TopStrengthTable store={activeStore} />)

    expect(symbolNamesInOrder()).toEqual(['HIGH-EQ', 'MID-EQ', 'LOW-EQ'])
  })

  it('every column is sortable, and NaN always sorts last regardless of direction', async () => {
    const user = userEvent.setup()
    const rows = [makeRow({ symbol: 'A-EQ', cmp: 100 }), makeRow({ symbol: 'B-EQ', cmp: NaN }), makeRow({ symbol: 'C-EQ', cmp: 50 })]
    activeStore = makeStore(rows)
    render(<TopStrengthTable store={activeStore} />)

    await user.click(screen.getByRole('button', { name: 'CMP' }))
    expect(symbolNamesInOrder()).toEqual(['C-EQ', 'A-EQ', 'B-EQ']) // ascending: 50, 100, NaN last

    await user.click(screen.getByRole('button', { name: 'CMP' }))
    expect(symbolNamesInOrder()).toEqual(['A-EQ', 'C-EQ', 'B-EQ']) // descending: 100, 50, NaN STILL last
  })

  it('the Top N control limits how many rows render', async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 60 }, (_, i) => makeRow({ strength: 60 - i }))
    activeStore = makeStore(rows)
    render(<TopStrengthTable store={activeStore} />)

    expect(screen.getByText(/25 of 60 shown/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: '10' }))
    expect(screen.getByText(/10 of 60 shown/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'all' }))
    expect(screen.getByText(/60 of 60 shown/)).toBeInTheDocument()
  })

  it('virtualises above 50 visible rows — fewer DOM rows than total are rendered', async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 200 }, (_, i) => makeRow({ strength: 200 - i }))
    activeStore = makeStore(rows)
    render(<TopStrengthTable store={activeStore} />)

    await user.click(screen.getByRole('radio', { name: 'all' }))
    const renderedRows = screen.getAllByRole('row')
    expect(renderedRows.length).toBeGreaterThan(0)
    expect(renderedRows.length).toBeLessThan(200)
  })

  it('narrows to the dashboard-wide sector filter, and shows a dismissible chip naming it', async () => {
    const user = userEvent.setup()
    const rows = [makeRow({ symbol: 'BANK-EQ', sector: 'Banks' }), makeRow({ symbol: 'IT-EQ', sector: 'IT Software' })]
    activeStore = makeStore(rows)
    activeStore.getState().setFilters({ sector: 'Banks' })
    render(<TopStrengthTable store={activeStore} />)

    expect(symbolNamesInOrder()).toEqual(['BANK-EQ'])
    expect(screen.getByText('Sector: Banks')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /sector: banks/i }))
    expect(activeStore.getState().filters.sector).toBeNull()
    expect(symbolNamesInOrder()).toEqual(['BANK-EQ', 'IT-EQ'])
  })

  it('shows a readable empty state naming the active filter, with a one-click clear', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ sector: 'Banks' })])
    activeStore.getState().setFilters({ sector: 'IT Software' }) // excludes the only row

    render(<TopStrengthTable store={activeStore} />)
    expect(screen.getByText('No names match the current filters.')).toBeInTheDocument()
    expect(screen.getByText('Active: Sector: IT Software.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(activeStore.getState().filters.sector).toBeNull()
    expect(symbolNamesInOrder()).toHaveLength(1)
  })

  it('the Symbol button sets and clears the drill-down selection', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ symbol: 'HDFCBANK-EQ', token: 'TOK1' })])
    render(<TopStrengthTable store={activeStore} />)

    const symbolBtn = screen.getByRole('button', { name: 'Open details for HDFCBANK-EQ' })
    await user.click(symbolBtn)
    expect(activeStore.getState().selectedToken).toBe('TOK1')

    await user.click(symbolBtn)
    expect(activeStore.getState().selectedToken).toBeNull()
  })

  it('the star marker toggles persisted starred state', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ token: 'TOK1', starred: false })])
    render(<TopStrengthTable store={activeStore} />)

    const star = screen.getByRole('button', { name: 'Add your marker' })
    await user.click(star)
    expect(useStarredStore.getState().isStarred('TOK1')).toBe(true)
    expect(screen.getByRole('button', { name: 'Remove your marker' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a NaN Strength renders a pale dot and an em-dash, never a fabricated zero', () => {
    activeStore = makeStore([makeRow({ strength: NaN })])
    render(<TopStrengthTable store={activeStore} />)
    expect(screen.getByLabelText(/Strength not available/i)).toBeInTheDocument()
  })

  it('renders Breakouts as an arrow with a screen-reader label, or blank when there is none', () => {
    const rows = [makeRow({ symbol: 'UP-EQ', breakout: 'BREAKOUT-UP' }), makeRow({ symbol: 'NONE-EQ', breakout: null })]
    activeStore = makeStore(rows)
    render(<TopStrengthTable store={activeStore} />)
    expect(screen.getByText('Breakout up')).toBeInTheDocument()
    expect(screen.getByText('No breakout')).toBeInTheDocument()
  })

  it('exports the current (sorted, filtered, Top-N-limited) view as CSV', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    activeStore = makeStore([makeRow({ symbol: 'HDFCBANK-EQ' })])
    render(<TopStrengthTable store={activeStore} />)

    await user.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)

    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('shows a readable empty state before any data has loaded', () => {
    activeStore = makeStore([])
    render(<TopStrengthTable store={activeStore} />)
    expect(screen.getByText('No F&O names loaded yet.')).toBeInTheDocument()
  })

  it('the filter toggle reveals a symbol search that narrows the table', async () => {
    const user = userEvent.setup()
    const rows = [makeRow({ symbol: 'RELIANCE-EQ' }), makeRow({ symbol: 'INFY-EQ' })]
    activeStore = makeStore(rows)
    render(<TopStrengthTable store={activeStore} />)

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    const search = screen.getByLabelText('Search symbol')
    await user.type(search, 'RELIANCE')
    await user.tab() // blur commits the search

    expect(activeStore.getState().filters.q).toBe('RELIANCE')
    expect(symbolNamesInOrder()).toEqual(['RELIANCE-EQ'])
  })

  it('disables the row-reorder transition under prefers-reduced-motion', () => {
    setMatchMedia((q) => q.includes('prefers-reduced-motion'))
    activeStore = makeStore([makeRow()])
    const { container } = render(<TopStrengthTable store={activeStore} />)
    const row = container.querySelector('[role="row"][aria-rowindex]') as HTMLElement
    expect(row.style.transition).toBe('none')
  })
})
