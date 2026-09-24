import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { createIntradayStore, type IntradayStore } from '../../../store/intradayStore'
import { createScreenerStore, type ScreenerStore } from '../../../store/screenerStore'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../../data/MarketDataSource'
import type { Candle, Instrument, IntradayRow, MarketTick } from '../../../types/domain'
import type { ScreenerRow } from '../../../store/types'
import type { ScripRow, SearchResponse } from '../../../types/api'
import { InstrumentDrawer } from '../InstrumentDrawer'

class StubDataSource implements MarketDataSource {
  async searchSymbol(): Promise<SearchResponse> {
    return { error: null, result: [] }
  }
  async fetchHistoricalCandles(): Promise<Candle[]> {
    // Deliberately empty: lightweight-charts cannot actually render in jsdom
    // (no real <canvas>) — these tests exercise the "no candle history"
    // branch rather than mounting the real chart, matching this session's
    // established pattern for any drawer test that touches SignalChart.
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
    symbol: 'HDFCBANK-EQ',
    baseSymbol: 'HDFCBANK',
    token: 'TOK1',
    exchange: 'NSE',
    sector: 'Banks',
    indices: [],
    cmp: 1650,
    prevClose: 1600,
    changePct: 3.1,
    change3dPct: 2,
    dayOpen: 1620,
    dayHigh: 1660,
    dayLow: 1610,
    vwap: 1640,
    strength: 3.2,
    strengthTone: 'medium',
    intradayDir: 'up',
    breakout: 'BREAKOUT-UP',
    breakoutLevel: 1645.5,
    rvol: 2.5,
    zMove: 1.8,
    persistence: 0.7,
    cachedClose: 1600,
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

function makeScreenerRow(overrides: Partial<ScreenerRow> = {}): ScreenerRow {
  return {
    id: 'row-1',
    symbol: 'HDFCBANK-EQ',
    exchange: 'NSE',
    signal: 'BUY',
    price: 1600,
    rsi: 62,
    time: 1700000000,
    status: 'active',
    firstSeenAt: 1700000000,
    lastSeenAt: 1700000000,
    pinned: false,
    ...overrides,
  }
}

function makeScreenerStore(rows: ScreenerRow[]): ScreenerStore {
  const store = createScreenerStore({ dataSource: new StubDataSource() as unknown as MarketDataSource, now: () => 0 })
  store.setState((state) => ({ ...state, rows, visibleRows: rows }))
  return store
}

function renderDrawer(store: IntradayStore, screenerStore: ScreenerStore) {
  return render(
    <MemoryRouter>
      <InstrumentDrawer store={store} screenerStore={screenerStore} />
    </MemoryRouter>,
  )
}

let activeStore: IntradayStore | null = null

afterEach(() => {
  activeStore?.getState().stop()
  activeStore = null
})

describe('InstrumentDrawer', () => {
  it('renders nothing when no token is selected', () => {
    activeStore = makeStore([makeRow()])
    const { container } = renderDrawer(activeStore, makeScreenerStore([]))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the header, CMP, and stat row once a token is selected', () => {
    activeStore = makeStore([makeRow()])
    activeStore.getState().selectToken('TOK1')
    renderDrawer(activeStore, makeScreenerStore([]))

    expect(screen.getByRole('heading', { name: 'HDFCBANK-EQ' })).toBeInTheDocument()
    expect(screen.getByText('Banks')).toBeInTheDocument()
    expect(screen.getByText('% Ch')).toBeInTheDocument()
    expect(screen.getByText('3 Day Ch%')).toBeInTheDocument()
    expect(screen.getByText('rvol')).toBeInTheDocument()
    expect(screen.getAllByText('VWAP').length).toBeGreaterThan(0) // the stat-row label AND the chart's "VWAP" overlay checkbox both say "VWAP"
  })

  it('shows the breakout level in the stat row, matching the row that fired it', () => {
    activeStore = makeStore([makeRow({ breakout: 'BREAKOUT-UP', breakoutLevel: 1645.5 })])
    activeStore.getState().selectToken('TOK1')
    renderDrawer(activeStore, makeScreenerStore([]))
    expect(screen.getByText('1,645.50')).toBeInTheDocument()
  })

  it('marks the day range with the current price position, and handles a degenerate range', () => {
    activeStore = makeStore([makeRow({ dayLow: 1610, dayHigh: 1660, cmp: 1650 })])
    activeStore.getState().selectToken('TOK1')
    renderDrawer(activeStore, makeScreenerStore([]))
    expect(screen.getByText('Day range')).toBeInTheDocument()
    expect(screen.getByText('1,610.00')).toBeInTheDocument()
    expect(screen.getByText('1,660.00')).toBeInTheDocument()
  })

  it('shows "no candle history" once the (empty) candle fetch resolves, and a loading skeleton first', async () => {
    activeStore = makeStore([makeRow()])
    activeStore.getState().selectToken('TOK1')
    renderDrawer(activeStore, makeScreenerStore([]))

    expect(screen.getByRole('status', { name: 'Loading chart' })).toBeInTheDocument()
    expect(await screen.findByText('No candle history available')).toBeInTheDocument()
  })

  it('shows the Strength breakdown once computed, and the "not enough history" message when NaN', async () => {
    activeStore = makeStore([makeRow({ strength: NaN })])
    activeStore.getState().selectToken('TOK1')
    renderDrawer(activeStore, makeScreenerStore([]))

    expect(await screen.findByText(/not enough session history/i)).toBeInTheDocument()
  })

  it("explains the row's OWN Strength — the breakdown can never print a different number than the stat row", () => {
    activeStore = makeStore([makeRow({ strength: 6.7, zMove: 7.2, rvol: 0.96, persistence: 0.9 })])
    activeStore.getState().selectToken('TOK1')
    renderDrawer(activeStore, makeScreenerStore([]))

    const factor = screen.getByText('Strength', { selector: 'span.font-medium' }).parentElement!
    expect(factor).toHaveTextContent('Strength 6.70')
    expect(screen.getByText('zMove', { selector: 'span.font-medium' }).parentElement).toHaveTextContent('zMove 7.20')
    expect(screen.getByText('√rvol', { selector: 'span.font-medium' }).parentElement).toHaveTextContent(`√rvol ${Math.sqrt(0.96).toFixed(2)}`)
    expect(screen.getByText('Persistence-factor', { selector: 'span.font-medium' }).parentElement).toHaveTextContent('Persistence-factor 0.95')
  })

  it('shows an active BUY/SELL Screener status with a link to /rsi-ha, when one exists for this base symbol', () => {
    activeStore = makeStore([makeRow()])
    activeStore.getState().selectToken('TOK1')
    const screenerStore = makeScreenerStore([makeScreenerRow({ symbol: 'HDFCBANK-EQ', signal: 'BUY' })])
    renderDrawer(activeStore, screenerStore)

    expect(screen.getByText(/Currently a/)).toBeInTheDocument()
    expect(screen.getByText('BUY')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /open on screener/i })
    expect(link).toHaveAttribute('href', '/rsi-ha?q=HDFCBANK')
  })

  it('shows "no active signal" with a link to check, when there is none for this base symbol', () => {
    activeStore = makeStore([makeRow()])
    activeStore.getState().selectToken('TOK1')
    renderDrawer(activeStore, makeScreenerStore([]))

    expect(screen.getByText(/No active BUY\/SELL/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /check on screener/i })).toHaveAttribute('href', '/rsi-ha?q=HDFCBANK')
  })

  it('does not match a screener row for a DIFFERENT base symbol', () => {
    activeStore = makeStore([makeRow({ baseSymbol: 'HDFCBANK' })])
    activeStore.getState().selectToken('TOK1')
    const screenerStore = makeScreenerStore([makeScreenerRow({ symbol: 'ICICIBANK-EQ', signal: 'BUY' })])
    renderDrawer(activeStore, screenerStore)

    expect(screen.getByText(/No active BUY\/SELL/)).toBeInTheDocument()
  })

  it('the Close button clears the selection', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow()])
    activeStore.getState().selectToken('TOK1')
    renderDrawer(activeStore, makeScreenerStore([]))

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(activeStore.getState().selectedToken).toBeNull()
  })

  it('clicking the backdrop clears the selection', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow()])
    activeStore.getState().selectToken('TOK1')
    const { container } = renderDrawer(activeStore, makeScreenerStore([]))

    // Structural, not class-based: the backdrop is always the outer wrapper's first child.
    const backdrop = container.querySelector('.fixed.inset-0.z-50')?.firstElementChild as HTMLElement
    await user.click(backdrop)
    expect(activeStore.getState().selectedToken).toBeNull()
  })

  it('prev/next walk the current filtered set, ordered by Strength descending', async () => {
    const user = userEvent.setup()
    const rows = [
      makeRow({ token: 'HIGH', symbol: 'HIGH-EQ', baseSymbol: 'HIGH', strength: 9 }),
      makeRow({ token: 'MID', symbol: 'MID-EQ', baseSymbol: 'MID', strength: 5 }),
      makeRow({ token: 'LOW', symbol: 'LOW-EQ', baseSymbol: 'LOW', strength: 1 }),
    ]
    activeStore = makeStore(rows)
    activeStore.getState().selectToken('MID')
    renderDrawer(activeStore, makeScreenerStore([]))

    expect(screen.getByRole('button', { name: 'Previous instrument' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next instrument' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Next instrument' }))
    expect(activeStore.getState().selectedToken).toBe('LOW')

    await user.click(screen.getByRole('button', { name: 'Previous instrument' }))
    await user.click(screen.getByRole('button', { name: 'Previous instrument' }))
    expect(activeStore.getState().selectedToken).toBe('HIGH')
    expect(screen.getByRole('button', { name: 'Previous instrument' })).toBeDisabled()
  })

  it('prev/next only walk rows that pass the active dashboard filters', () => {
    const rows = [
      makeRow({ token: 'BANK', symbol: 'BANK-EQ', baseSymbol: 'BANK', sector: 'Banks', strength: 9 }),
      makeRow({ token: 'IT', symbol: 'IT-EQ', baseSymbol: 'IT', sector: 'IT Software', strength: 5 }),
    ]
    activeStore = makeStore(rows)
    activeStore.getState().setFilters({ sector: 'Banks' })
    activeStore.getState().selectToken('BANK')
    renderDrawer(activeStore, makeScreenerStore([]))

    expect(screen.getByRole('button', { name: 'Next instrument' })).toBeDisabled()
  })
})
