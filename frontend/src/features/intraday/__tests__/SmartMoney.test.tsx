import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createIntradayStore, type IntradayStore } from '../../../store/intradayStore'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../../data/MarketDataSource'
import type { Candle, Instrument, IntradayRow, MarketTick } from '../../../types/domain'
import type { ScripRow, SearchResponse } from '../../../types/api'
import { SmartMoney } from '../SmartMoney'

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

let activeStore: IntradayStore | null = null

afterEach(() => {
  activeStore?.getState().stop()
  activeStore = null
})

describe('SmartMoney', () => {
  it('shows the plain-words subtitle so the metric is never mistaken for order-flow data', () => {
    activeStore = makeStore([makeRow({ sector: 'Banks', rvol: 3, zMove: 2 })])
    render(<SmartMoney store={activeStore} />)
    expect(screen.getByText('Sectors with the most names showing unusual volume alongside an unusual move.')).toBeInTheDocument()
  })

  it('counts only names meeting both default thresholds (rvol >= 2 and |zMove| >= 1)', () => {
    const rows = [
      makeRow({ sector: 'Banks', rvol: 3, zMove: 2 }),
      makeRow({ sector: 'Banks', rvol: 3, zMove: 2 }),
      makeRow({ sector: 'Banks', rvol: 1, zMove: 2 }), // rvol too low
    ]
    activeStore = makeStore(rows)
    render(<SmartMoney store={activeStore} />)

    const table = screen.getByText('Smart money').closest('table')!
    expect(table).toHaveTextContent('Banks')
    expect(table.querySelector('tbody td')).toHaveTextContent('2')
  })

  it('the numeric threshold controls recompute the counts live', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ sector: 'Banks', rvol: 1.5, zMove: 0.8 })])
    render(<SmartMoney store={activeStore} />)

    expect(screen.getByText(/no sector currently has a name above rvol 2/i)).toBeInTheDocument()

    const rvolInput = screen.getByLabelText('Minimum rvol')
    await user.clear(rvolInput)
    await user.type(rvolInput, '1')
    const zInput = screen.getByLabelText('Minimum absolute z-move')
    await user.clear(zInput)
    await user.type(zInput, '0.5')

    const table = screen.getByText('Smart money').closest('table')!
    expect(table).toHaveTextContent('Banks')
  })

  it('shows a readable empty state naming the live thresholds when no sector qualifies', () => {
    activeStore = makeStore([makeRow({ sector: 'Banks', rvol: 1, zMove: 0.2 })])
    render(<SmartMoney store={activeStore} />)
    expect(screen.getByText('No sector currently has a name above rvol 2 with a z-move above 1.')).toBeInTheDocument()
    expect(screen.getByText(/loosen the thresholds/i)).toBeInTheDocument()
  })

  it('lists qualifying symbols with rvol and zMove on hover', async () => {
    const user = userEvent.setup()
    const rows = [
      makeRow({ sector: 'Banks', symbol: 'HDFCBANK-EQ', rvol: 3, zMove: 2 }),
      makeRow({ sector: 'Banks', symbol: 'ICICIBANK-EQ', rvol: 4, zMove: -1.5 }),
    ]
    activeStore = makeStore(rows)
    render(<SmartMoney store={activeStore} />)

    await user.hover(screen.getByRole('button', { name: /filter to the 2 qualifying names in banks/i }))

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('HDFCBANK-EQ')
    expect(tooltip).toHaveTextContent('ICICIBANK-EQ')
    expect(tooltip).toHaveTextContent(/rvol ≥ 2 and \|z-move\| ≥ 1/)
    expect(tooltip).toHaveTextContent(/cannot see who is buying/i)
  })

  it('clicking a bar filters to those SPECIFIC names, not the whole sector', async () => {
    const user = userEvent.setup()
    const qualifying = makeRow({ sector: 'Banks', rvol: 3, zMove: 2 })
    const nonQualifying = makeRow({ sector: 'Banks', rvol: 1, zMove: 0.2 })
    activeStore = makeStore([qualifying, nonQualifying])
    render(<SmartMoney store={activeStore} />)

    await user.click(screen.getByRole('button', { name: /filter to the 1 qualifying names in banks/i }))

    expect(activeStore.getState().filters.tokens).toEqual([qualifying.token])
    expect(activeStore.getState().filters.sector).toBeNull() // never the whole sector

    await user.click(screen.getByRole('button', { name: /filter to the 1 qualifying names in banks/i }))
    expect(activeStore.getState().filters.tokens).toBeNull()
  })
})
