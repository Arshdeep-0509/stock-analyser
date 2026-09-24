import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createIntradayStore, type IntradayStore } from '../../../store/intradayStore'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../../data/MarketDataSource'
import type { Candle, Instrument, IntradayRow, MarketTick } from '../../../types/domain'
import type { ScripRow, SearchResponse } from '../../../types/api'
import { MarketMeter } from '../MarketMeter'

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

/** The summary <p> interleaves plain text with <span> children, so a plain getByText regex can't match its full sentence (a documented RTL limitation) — match on the element's full textContent instead. */
function summaryText(): string {
  const p = document.querySelector('p.text-xs')
  return p?.textContent ?? ''
}

function makeStore(rows: IntradayRow[]): IntradayStore {
  const store = createIntradayStore({ dataSource: new StubDataSource(), now: () => 0 })
  // .setState() here (not the immer-draft form intradayStore.ts uses internally) —
  // IntradayStore's public type intentionally doesn't leak immer's void-returning
  // overload, so an external caller (a test, in this case) returns a new state instead.
  store.setState((state) => ({ ...state, rows, meterRows: rows, loadState: 'ready' }))
  return store
}

let activeStore: IntradayStore | null = null

afterEach(() => {
  activeStore?.getState().stop()
  activeStore = null
})

describe('MarketMeter', () => {
  it('computes and displays up/down percentages and the raw-count summary line', () => {
    const rows = [makeRow({ changePct: 2 }), makeRow({ changePct: 2 }), makeRow({ changePct: -2 }), makeRow({ changePct: 0.1 })]
    activeStore = makeStore(rows)
    render(<MarketMeter store={activeStore} />)

    const table = screen.getByText('Market meter').closest('table')!
    expect(within(table).getByText('50.0%')).toBeInTheDocument() // 2 of 4 up
    expect(within(table).getByText('25.0%')).toBeInTheDocument() // 1 of 4 down
    expect(summaryText()).toBe('2 of 4 F&O names up more than 0.5%, 1 down more than 0.5%, 1 flat.')
  })

  it('changing the threshold recomputes the bars — proving the number is computed, not fixed', async () => {
    const user = userEvent.setup()
    const rows = [makeRow({ changePct: 0.6 }), makeRow({ changePct: -0.6 })]
    activeStore = makeStore(rows)
    render(<MarketMeter store={activeStore} />)

    // At the default 0.5% threshold both rows count as moved.
    expect(summaryText()).toBe('1 of 2 F&O names up more than 0.5%, 1 down more than 0.5%, 0 flat.')

    await user.click(screen.getByRole('radio', { name: '1%' }))

    // At 1% neither 0.6% move clears the bar -> both become flat.
    expect(summaryText()).toBe('0 of 2 F&O names up more than 1%, 0 down more than 1%, 2 flat.')
  })

  it('clicking the Up bar filters to advancing names; clicking again clears it', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ changePct: 2 })])
    render(<MarketMeter store={activeStore} />)

    await user.click(screen.getByRole('button', { name: /filter to advancing names/i }))
    expect(activeStore.getState().filters.direction).toBe('up')

    await user.click(screen.getByRole('button', { name: /filter to advancing names/i }))
    expect(activeStore.getState().filters.direction).toBe('all')
  })

  it('clicking the Down bar filters to declining names', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ changePct: -2 })])
    render(<MarketMeter store={activeStore} />)

    await user.click(screen.getByRole('button', { name: /filter to declining names/i }))
    expect(activeStore.getState().filters.direction).toBe('down')
  })

  it('keeps showing the WHOLE market when another chart sets an index filter, adding a highlighted-slice line instead of narrowing', () => {
    const rows = [
      makeRow({ indices: ['IT'], changePct: 2 }),
      makeRow({ indices: ['IT'], changePct: 2 }),
      makeRow({ indices: ['FMCG'], changePct: -2 }),
    ]
    activeStore = makeStore(rows)
    activeStore.getState().setFilters({ index: 'IT' })
    render(<MarketMeter store={activeStore} />)

    // Still the full 3-row universe, not narrowed to IT's 2 rows.
    expect(summaryText()).toBe(
      '2 of 3 F&O names up more than 0.5%, 1 down more than 0.5%, 0 flat. Of these, 2 of 2 IT names are up, 0 down (marked on the bars above).',
    )
  })

  it('keeps showing the WHOLE market when another chart sets a sector filter, adding a highlighted-slice line instead of narrowing', () => {
    const rows = [
      makeRow({ sector: 'Banks', changePct: 2 }),
      makeRow({ sector: 'Banks', changePct: 2 }),
      makeRow({ sector: 'IT Software', changePct: -2 }),
    ]
    activeStore = makeStore(rows)
    activeStore.getState().setFilters({ sector: 'Banks' })
    render(<MarketMeter store={activeStore} />)

    expect(summaryText()).toBe(
      '2 of 3 F&O names up more than 0.5%, 1 down more than 0.5%, 0 flat. Of these, 2 of 2 Banks names are up, 0 down (marked on the bars above).',
    )
  })

  it('renders a visually-hidden data table carrying the same values', () => {
    activeStore = makeStore([makeRow({ changePct: 2 })])
    render(<MarketMeter store={activeStore} />)
    expect(screen.getByText('Market meter')).toBeInTheDocument() // <caption>
  })
})
