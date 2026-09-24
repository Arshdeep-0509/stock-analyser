import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import candles60 from '../../../strategy/__tests__/fixtures/candles-60.json'
import monotonicRising from '../../../strategy/__tests__/fixtures/parity/monotonic-rising.json'
import { analyzeCandles } from '../../../strategy/analyzeCandles'
import { DEFAULT_PARAMS } from '../../../strategy/constants'
import { explainBreakout, explainSignal } from '../../../strategy/explainSignal'
import type { ScreenerRow } from '../../../store/types'
import type { Candle } from '../../../types/domain'
import { makeRow, NoopDataSource, renderWithRouter, seededStore } from '../../../test-utils/fixtures'
import { SignalDetail } from '../SignalDetail'

// lightweight-charts cannot render in jsdom; the mock records what the chart was asked to draw.
const chartCalls: { symbol: string; candles: number }[] = []
vi.mock('../SignalChart', () => ({
  SignalChart: (props: { row: ScreenerRow; candles: Candle[] }) => {
    chartCalls.push({ symbol: props.row.symbol, candles: props.candles.length })
    return <div data-testid="signal-chart" />
  },
}))

function renderDetail(row: ScreenerRow, rowList: ScreenerRow[], candles: Candle[], patch: Parameters<typeof seededStore>[1] = {}) {
  const source = new NoopDataSource()
  source.candles = candles
  const store = seededStore(rowList, patch, source)
  const onNavigate = vi.fn()
  const onClose = vi.fn()
  const view = renderWithRouter(<SignalDetail row={row} rowList={rowList} store={store} onClose={onClose} onNavigate={onNavigate} />)
  return { ...view, source, onNavigate, onClose }
}

/** The "Why this fired" checklist items (not the loading skeleton). */
async function checklistItems(): Promise<HTMLElement[]> {
  const heading = await screen.findByRole('heading', { name: 'Why this fired' })
  const section = heading.parentElement
  if (!section) throw new Error('no checklist section')
  await vi.waitFor(() => {
    if (within(section).queryByRole('status', { name: 'Loading' })) throw new Error('still loading')
  })
  return within(section).getAllByRole('listitem')
}

describe('SignalDetail — "why this fired"', () => {
  it('renders one checklist row per predicate, with the real computed numbers', async () => {
    const candles = candles60 as Candle[]
    const row = makeRow({ token: 'TOK', price: candles[candles.length - 1].close })
    renderDetail(row, [row], candles)

    const analyzed = analyzeCandles(candles, DEFAULT_PARAMS)
    const expected = [...(explainSignal(analyzed, DEFAULT_PARAMS)?.checks ?? []), ...(explainBreakout(candles, DEFAULT_PARAMS)?.checks ?? [])]
    const items = await checklistItems()
    expect(items).toHaveLength(expected.length)

    const rsi = analyzed[analyzed.length - 1].rsi
    expect(items.map((li) => li.textContent).join(' ')).toContain(rsi.toFixed(2))
  })

  it('a near-miss renders the gap line: how far RSI sits outside the band', async () => {
    const candles = monotonicRising as Candle[] // RSI is exactly 100 after the warm-up
    const row = makeRow({ token: 'TOK' })
    renderDetail(row, [row], candles)
    const text = (await checklistItems()).map((li) => li.textContent).join('\n')
    const gap = (100 - DEFAULT_PARAMS.rsiBuyHigh).toFixed(2)
    expect(text).toMatch(new RegExp(`RSI 100\\.00 is ${gap.replace('.', '\\.')} above the BUY band's upper bound ${DEFAULT_PARAMS.rsiBuyHigh}`))
  })
})

describe('SignalDetail — CE/PE rows', () => {
  it('shows the inherited-RSI notice, and charts the UNDERLYING (not the option\'s own candles)', async () => {
    chartCalls.length = 0
    const underlying = makeRow({ symbol: 'RELIANCE-EQ', exchange: 'NSE', token: 'UNDERLYING_TOK', signal: 'BUY' })
    const option = makeRow({ symbol: 'RELIANCE26JAN2500CE', exchange: 'NFO', token: 'OPTION_TOK', signal: 'CE Buy', derivedFrom: 'RELIANCE-EQ', rsi: underlying.rsi, time: underlying.time })
    const { source } = renderDetail(option, [option], candles60 as Candle[], {
      universe: [{ symbol: 'RELIANCE-EQ', token: 'UNDERLYING_TOK', exchange: 'NSE' }],
    })

    expect(await screen.findByText(/derived from RELIANCE-EQ's own BUY\/SELL signal/)).toBeInTheDocument()
    expect(screen.getByText(/inherited from the underlying/)).toBeInTheDocument()
    await vi.waitFor(() => expect(source.requestedTokens.length).toBeGreaterThan(0))
    expect(source.requestedTokens).toEqual(['UNDERLYING_TOK'])
    expect(source.requestedTokens).not.toContain('OPTION_TOK')
  })
})

describe('SignalDetail — navigation and actions', () => {
  it('prev / next walk the filtered list and disable at the ends', async () => {
    const user = userEvent.setup()
    const rows = [makeRow({ symbol: 'FIRSTFUT' }), makeRow({ symbol: 'MIDFUT' }), makeRow({ symbol: 'LASTFUT' })]

    const first = renderDetail(rows[0], rows, [])
    expect(screen.getByRole('button', { name: 'Previous signal' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next signal' }))
    expect(first.onNavigate).toHaveBeenCalledWith(rows[1])
    first.unmount()

    const middle = renderDetail(rows[1], rows, [])
    await user.click(screen.getByRole('button', { name: 'Previous signal' }))
    expect(middle.onNavigate).toHaveBeenCalledWith(rows[0])
    await user.click(screen.getByRole('button', { name: 'Next signal' }))
    expect(middle.onNavigate).toHaveBeenLastCalledWith(rows[2])
    middle.unmount()

    renderDetail(rows[2], rows, [])
    expect(screen.getByRole('button', { name: 'Next signal' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Previous signal' })).toBeEnabled()
  })

  it('"Copy analysis" writes a Markdown summary of the row and its checklist to the clipboard', async () => {
    const user = userEvent.setup() // installs a clipboard stub on navigator
    const candles = candles60 as Candle[]
    const row = makeRow({ symbol: 'COPYFUT', token: 'TOK' })
    renderDetail(row, [row], candles)
    await checklistItems()

    await user.click(screen.getByRole('button', { name: /Copy analysis/ }))
    const copied = await navigator.clipboard.readText()
    expect(copied).toContain('# COPYFUT — BUY')
    expect(copied).toContain('## Why this fired')
    expect(copied).toMatch(/- \[[x ]\] /)
  })

  it('"Place order" is disabled — trading is not wired up in the prototype', () => {
    const row = makeRow()
    renderDetail(row, [row], [])
    expect(screen.getByRole('button', { name: 'Place order' })).toBeDisabled()
  })
})
