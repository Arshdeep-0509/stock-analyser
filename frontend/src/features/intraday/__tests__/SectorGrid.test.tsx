import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIntradayStore, type IntradayStore } from '../../../store/intradayStore'
import type { ConnectionState, IndexQuote, IndexQuoteKey, MarketDataSource } from '../../../data/MarketDataSource'
import type { Candle, Instrument, IntradayRow, MarketTick } from '../../../types/domain'
import type { ScripRow, SearchResponse } from '../../../types/api'
import { getRenderCount } from '../../../lib/renderCounter'
import { SCROLL_ROOT_ID, SectorGrid } from '../SectorGrid'

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
  setMatchMedia(() => false) // desktop: not narrow, no reduced motion
})

afterEach(() => {
  window.matchMedia = originalMatchMedia
  activeStore?.getState().stop()
  activeStore = null
})

function cardFor(label: string): HTMLElement {
  return screen.getByText(label).closest('section') as HTMLElement
}

/** Reads the dev render-count registry the `~` devtools overlay shows — METAL/PHARMA's index key equals its label. */
function renderCountFor(indexKey: string): number {
  return getRenderCount(`SectorCard:${indexKey}`)
}

/** Mimics exactly what a real tick does: a NEW object only for the mutated token, every other row keeping its OLD reference — the structural-sharing guarantee useShallow's isolation depends on. */
function bumpChangePct(rows: IntradayRow[], token: string, delta: number): IntradayRow[] {
  return rows.map((r) => (r.token === token ? { ...r, changePct: r.changePct + delta, cmp: r.cmp + delta } : r))
}

describe('SectorGrid', () => {
  it('populates all ten cards, in the fixed METAL..OTHERS order', () => {
    activeStore = makeStore([])
    const { container } = render(<SectorGrid store={activeStore} />)

    const labels = ['METAL', 'PHARMA', 'PSU BANK', 'PVT BANK', 'AUTO', 'FINANCIAL', 'FMCG', 'IT', 'REALTY', 'OTHERS']
    // The title button is the one WITH aria-pressed — the Expand icon button beside it has no such attribute, so this can't accidentally pick it up too.
    const headings = Array.from(container.querySelectorAll('button[aria-pressed]')).map((b) => b.textContent)
    expect(headings).toEqual(labels)
  })

  it('shows the constituent count and mean Strength in the header', () => {
    activeStore = makeStore([
      makeRow({ indices: ['METAL'], strength: 4 }),
      makeRow({ indices: ['METAL'], strength: 2 }),
    ])
    render(<SectorGrid store={activeStore} />)

    const metal = cardFor('METAL')
    expect(within(metal).getByText('(2)')).toBeInTheDocument()
    expect(within(metal).getByTitle('Mean Strength')).toHaveTextContent('3.0')
  })

  it('sorts each card by Strength descending, NaN sinking to the bottom', () => {
    activeStore = makeStore([
      makeRow({ indices: ['METAL'], symbol: 'LOW-EQ', strength: 1 }),
      makeRow({ indices: ['METAL'], symbol: 'NAN-EQ', strength: NaN }),
      makeRow({ indices: ['METAL'], symbol: 'HIGH-EQ', strength: 9 }),
    ])
    render(<SectorGrid store={activeStore} />)

    const metal = cardFor('METAL')
    const names = within(metal)
      .getAllByRole('button', { name: /^Open details for/i })
      .map((b) => b.textContent)
    expect(names).toEqual(['HIGH-EQ', 'LOW-EQ', 'NAN-EQ'])
  })

  it("a NaN-strength row still shows a pale dot and an em-dash, never a fabricated zero", () => {
    activeStore = makeStore([makeRow({ indices: ['METAL'], strength: NaN })])
    render(<SectorGrid store={activeStore} />)
    expect(within(cardFor('METAL')).getByLabelText(/Strength not available/i)).toBeInTheDocument()
  })

  it('the Symbol button opens the drill-down selection', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ indices: ['METAL'], symbol: 'VEDL-EQ', token: 'TOK1' })])
    render(<SectorGrid store={activeStore} />)

    await user.click(screen.getByRole('button', { name: 'Open details for VEDL-EQ' }))
    expect(activeStore.getState().selectedToken).toBe('TOK1')
  })

  it('clicking a card header filters the dashboard to that index, scrolls to top, and clears on a second click', async () => {
    const user = userEvent.setup()
    const scrollRoot = document.createElement('div')
    scrollRoot.id = SCROLL_ROOT_ID
    document.body.appendChild(scrollRoot)
    // jsdom doesn't implement Element.scrollTo at all — give it a stub so vi.spyOn has something to wrap.
    if (!scrollRoot.scrollTo) scrollRoot.scrollTo = () => {}
    const scrollSpy = vi.spyOn(scrollRoot, 'scrollTo').mockImplementation(() => {})

    activeStore = makeStore([makeRow({ indices: ['METAL'] })])
    render(<SectorGrid store={activeStore} />)

    await user.click(screen.getByRole('button', { name: 'METAL' }))
    expect(activeStore.getState().filters.index).toBe('METAL')
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))

    await user.click(screen.getByRole('button', { name: 'METAL' }))
    expect(activeStore.getState().filters.index).toBeNull()

    document.body.removeChild(scrollRoot)
  })

  it('the grid-level sort control reorders the cards', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([
      makeRow({ indices: ['METAL'], strength: 1 }),
      makeRow({ indices: ['OTHERS'], strength: 9 }),
    ])
    render(<SectorGrid store={activeStore} />)

    await user.click(screen.getByRole('radio', { name: 'Mean strength' }))

    const headings = screen.getAllByRole('button', { name: /METAL|PHARMA|PSU BANK|PVT BANK|AUTO|FINANCIAL|FMCG|IT|REALTY|OTHERS/ }).map((b) => b.textContent)
    expect(headings[0]).toBe('OTHERS') // mean strength 9 > every other sector's NaN/0
  })

  it('"hide empty sectors" removes cards with zero constituents', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ indices: ['METAL'] })])
    render(<SectorGrid store={activeStore} />)

    expect(screen.getByRole('button', { name: 'PHARMA' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Hide empty sectors' }))
    expect(screen.queryByRole('button', { name: 'PHARMA' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'METAL' })).toBeInTheDocument()
  })

  it('the expand control opens a modal with every constituent, extra columns (CMP, 3 Day Ch%, rvol, VWAP), and sorting', async () => {
    const user = userEvent.setup()
    activeStore = makeStore([makeRow({ indices: ['METAL'], symbol: 'VEDL-EQ', rvol: 2.5, vwap: 123.45 })])
    render(<SectorGrid store={activeStore} />)

    await user.click(within(cardFor('METAL')).getByRole('button', { name: 'Expand METAL' }))

    const modal = screen.getByRole('dialog', { name: 'METAL' })
    expect(within(modal).getByRole('heading', { name: /METAL/ })).toBeInTheDocument()
    expect(within(modal).getByRole('columnheader', { name: /^CMP/ })).toBeInTheDocument()
    expect(within(modal).getByRole('columnheader', { name: /3 Day Ch%/ })).toBeInTheDocument()
    expect(within(modal).getByRole('columnheader', { name: /^rvol/ })).toBeInTheDocument()
    expect(within(modal).getByRole('columnheader', { name: /^VWAP/ })).toBeInTheDocument()
    expect(within(modal).getByText('VEDL-EQ')).toBeInTheDocument()

    await user.click(within(modal).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'METAL' })).not.toBeInTheDocument()
  })

  it('a tick affecting only METAL re-renders METAL but not PHARMA (proved via the dev render counter)', () => {
    const metalRow = makeRow({ indices: ['METAL'], symbol: 'VEDL-EQ', token: 'METAL_TOK' })
    const pharmaRow = makeRow({ indices: ['PHARMA'], symbol: 'SUNPHARMA-EQ', token: 'PHARMA_TOK' })
    activeStore = makeStore([metalRow, pharmaRow])
    render(<SectorGrid store={activeStore} />)

    const metalBefore = renderCountFor('METAL')
    const pharmaBefore = renderCountFor('PHARMA')

    act(() => {
      activeStore!.setState((state) => ({ ...state, rows: bumpChangePct(state.rows, 'METAL_TOK', 1) }))
    })

    // METAL re-renders at least once (its own useShallow slice changed) — the
    // flash effect's own state update can add a second pass shortly after,
    // which is expected, not a bug. PHARMA must not move AT ALL: that's the
    // actual isolation guarantee this test exists to prove.
    expect(renderCountFor('METAL')).toBeGreaterThan(metalBefore)
    expect(renderCountFor('PHARMA')).toBe(pharmaBefore)
  })
})
