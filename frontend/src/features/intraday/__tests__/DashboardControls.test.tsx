import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIntradayStore, type IntradayStore } from '../../../store/intradayStore'
import { usePauseStore } from '../../../store/pauseStore'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../../data/MarketDataSource'
import type { Candle, Instrument, MarketTick } from '../../../types/domain'
import type { ScripRow, SearchResponse } from '../../../types/api'
import { DashboardControls } from '../DashboardControls'

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

function makeStore(): IntradayStore {
  const store = createIntradayStore({ dataSource: new StubDataSource(), now: () => 0 })
  store.setState((state) => ({ ...state, nextRefreshAt: 130 }))
  return store
}

let activeStore: IntradayStore | null = null

afterEach(() => {
  activeStore?.getState().stop()
  activeStore = null
  usePauseStore.getState().setPaused(false)
})

describe('DashboardControls', () => {
  it('shows a countdown to the next automatic refresh, using the SIMULATED clock, not real time', () => {
    activeStore = makeStore()
    render(<DashboardControls store={activeStore} density="comfortable" onDensityChange={() => {}} now={100} />)
    expect(screen.getByText('next in 30s')).toBeInTheDocument()
  })

  it('"Refresh now" calls refreshAll()', async () => {
    const user = userEvent.setup()
    activeStore = makeStore()
    const spy = vi.spyOn(activeStore.getState(), 'refreshAll')
    render(<DashboardControls store={activeStore} density="comfortable" onDensityChange={() => {}} now={100} />)

    await user.click(screen.getByRole('button', { name: /refresh now/i }))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('Pause/Resume toggles the SHARED pauseStore — the same one every poll loop reads', async () => {
    const user = userEvent.setup()
    activeStore = makeStore()
    render(<DashboardControls store={activeStore} density="comfortable" onDensityChange={() => {}} now={100} />)

    expect(usePauseStore.getState().isPaused).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(usePauseStore.getState().isPaused).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(usePauseStore.getState().isPaused).toBe(false)
  })

  it('the density toggle calls back with the OPPOSITE density', async () => {
    const user = userEvent.setup()
    activeStore = makeStore()
    const onDensityChange = vi.fn()
    render(<DashboardControls store={activeStore} density="comfortable" onDensityChange={onDensityChange} now={100} />)

    await user.click(screen.getByRole('button', { name: /compact/i }))
    expect(onDensityChange).toHaveBeenCalledWith('compact')
  })
})
