import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionState, MarketDataSource } from '../../../data/MarketDataSource'
import type { ScripRow, SearchResponse } from '../../../types/api'
import type { Candle, MarketTick } from '../../../types/domain'
import { createScreenerStore, type ScreenerStore } from '../../../store/screenerStore'
import type { ScreenerRow } from '../../../store/types'
import { SignalsTable } from '../SignalsTable'

class NoopDataSource implements MarketDataSource {
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
}

function makeRow(i: number): ScreenerRow {
  const signals = ['BUY', 'SELL', 'BREAKOUT-UP', 'BREAKOUT-DOWN'] as const
  return {
    id: `row-${i}`,
    symbol: `SYM${i}-EQ`,
    exchange: 'NSE',
    signal: signals[i % signals.length],
    price: 2000 + i,
    rsi: i % 7 === 0 ? NaN : (i * 3) % 100,
    time: 1767609600 - i * 300,
    status: 'active',
    firstSeenAt: 1767609600,
    lastSeenAt: 1767609600,
    pinned: false,
    token: `T${i}`,
  }
}

// jsdom doesn't implement layout, so every element reports 0 clientHeight —
// @tanstack/react-virtual would then see a zero-height viewport and render
// nothing at all. Give scrollable containers a realistic viewport size so
// the virtualizer computes a real (bounded) visible range, same as it would
// in a real browser.
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

function renderTableWith500Rows(): { store: ScreenerStore } {
  const store = createScreenerStore({ dataSource: new NoopDataSource(), now: () => 1767609600 })
  const rows = Array.from({ length: 500 }, (_, i) => makeRow(i))
  store.setState({ rows, visibleRows: rows })

  render(
    <MemoryRouter>
      <SignalsTable store={store} />
    </MemoryRouter>,
  )

  return { store }
}

let restoreViewport: () => void

beforeEach(() => {
  restoreViewport = mockViewportDimensions()
})

afterEach(() => {
  restoreViewport()
  document.body.innerHTML = ''
})

describe('SignalsTable virtualization', () => {
  it('renders far fewer DOM rows than the 500 data rows behind it', () => {
    renderTableWith500Rows()

    const renderedRows = screen.getAllByRole('row')
    expect(renderedRows.length).toBeGreaterThan(0)
    expect(renderedRows.length).toBeLessThan(100)
  })

  it('shows the correct total signal count in the toolbar', () => {
    renderTableWith500Rows()
    expect(screen.getByText(/500 of 500 signals/)).toBeInTheDocument()
  })
})
