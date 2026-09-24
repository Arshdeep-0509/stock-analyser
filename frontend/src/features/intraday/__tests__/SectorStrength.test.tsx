import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createIntradayStore, type IntradayStore } from '../../../store/intradayStore'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../../data/MarketDataSource'
import type { Candle, Instrument, IntradayRow, MarketTick } from '../../../types/domain'
import type { ScripRow, SearchResponse } from '../../../types/api'
import { SectorStrength } from '../SectorStrength'

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

function threeRows(sector: string, strength: number): IntradayRow[] {
  return [makeRow({ sector, strength }), makeRow({ sector, strength }), makeRow({ sector, strength })]
}

let activeStore: IntradayStore | null = null

afterEach(() => {
  activeStore?.getState().stop()
  activeStore = null
})

describe('SectorStrength', () => {
  it('renders one bar per sector via the sr-only table, descending by mean strength', () => {
    const rows = [...threeRows('Banks', 8), ...threeRows('IT Software', 3)]
    activeStore = makeStore(rows)
    render(<SectorStrength store={activeStore} />)

    const table = screen.getByText('Sector strength').closest('table')!
    const sectorNames = Array.from(table.querySelectorAll('tbody th')).map((th) => th.textContent)
    expect(sectorNames[0]).toBe('Banks')
    expect(sectorNames).toContain('IT Software')
  })

  it('caps at top 10 sectors, folding the rest into Others', () => {
    const rows = Array.from({ length: 12 }, (_, i) => threeRows(`Sector${i}`, 12 - i)).flat()
    activeStore = makeStore(rows)
    render(<SectorStrength store={activeStore} />)

    const table = screen.getByText('Sector strength').closest('table')!
    const sectorNames = Array.from(table.querySelectorAll('tbody th')).map((th) => th.textContent)
    expect(sectorNames).toHaveLength(11) // 10 named + Others
    expect(sectorNames).toContain('Others')
  })

  it('clicking a bar filters the dashboard to that sector; clicking again clears it', async () => {
    const user = userEvent.setup()
    activeStore = makeStore(threeRows('Banks', 5))
    render(<SectorStrength store={activeStore} />)

    const bar = screen.getByRole('button', { name: /filter to banks,/i })
    await user.click(bar)
    expect(activeStore.getState().filters.sector).toBe('Banks')

    await user.click(bar)
    expect(activeStore.getState().filters.sector).toBeNull()
  })

  it('shows a tooltip with sector, mean strength, count, top constituents, and the Strength reminder', async () => {
    const user = userEvent.setup()
    const rows = [
      makeRow({ sector: 'Banks', symbol: 'HDFCBANK-EQ', strength: 9 }),
      makeRow({ sector: 'Banks', symbol: 'ICICIBANK-EQ', strength: 5 }),
      makeRow({ sector: 'Banks', symbol: 'SBIN-EQ', strength: 2 }),
    ]
    activeStore = makeStore(rows)
    render(<SectorStrength store={activeStore} />)

    await user.hover(screen.getByRole('button', { name: /filter to banks,/i }))

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Banks')
    expect(tooltip).toHaveTextContent('3 names')
    expect(tooltip).toHaveTextContent('HDFCBANK-EQ')
    expect(tooltip).toHaveTextContent(/Strength = zMove/)
  })

  it('shows a readable empty state when no rows are loaded yet', () => {
    activeStore = makeStore([])
    render(<SectorStrength store={activeStore} />)
    expect(screen.getByText('No F&O names loaded yet.')).toBeInTheDocument()
  })

  it('shows a readable empty state when every row has a NaN strength', () => {
    activeStore = makeStore(threeRows('Banks', NaN))
    render(<SectorStrength store={activeStore} />)
    expect(screen.getByText(/no sector has enough session history/i)).toBeInTheDocument()
  })
})
