import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { IndexQuote } from '../../../data/MarketDataSource'
import { QuoteStrip } from '../QuoteStrip'

const HEADER_COUNTS = { breakoutUpCount: 3, breakoutDownCount: 1, breakoutStrength: 2.4 }

const QUOTES: IndexQuote[] = [
  { key: 'NIFTY', label: 'NIFTY 50', last: 23398.4, prevClose: 23470, changePct: -0.3, time: 0 },
  { key: 'BANKNIFTY', label: 'BANK NIFTY', last: 56607.2, prevClose: 56495, changePct: 0.2, time: 0 },
  { key: 'INDIAVIX', label: 'India VIX', last: 12.29, prevClose: 11.79, changePct: 4.2, time: 0 },
]

describe('QuoteStrip', () => {
  it('shows a loading message when there are no quotes yet', () => {
    render(<QuoteStrip indexQuotes={[]} headerCounts={{ breakoutUpCount: 0, breakoutDownCount: 0, breakoutStrength: NaN }} />)
    expect(screen.getByText(/loading quotes/i)).toBeInTheDocument()
  })

  it('renders each quote label and last value', () => {
    render(<QuoteStrip indexQuotes={QUOTES} headerCounts={HEADER_COUNTS} />)
    expect(screen.getByText('NIFTY 50')).toBeInTheDocument()
    expect(screen.getByText('BANK NIFTY')).toBeInTheDocument()
    expect(screen.getByText('India VIX')).toBeInTheDocument()
    expect(screen.getByText('23,398.40')).toBeInTheDocument()
  })

  it('a normal quote (NIFTY) rising renders bullish, falling renders bearish', () => {
    render(<QuoteStrip indexQuotes={QUOTES} headerCounts={HEADER_COUNTS} />)
    expect(screen.getByText('-0.30%')).toHaveClass('text-bearish') // NIFTY down
    expect(screen.getByText('+0.20%')).toHaveClass('text-bullish') // BANK NIFTY up
  })

  it("VIX's colour is inverted: a rising VIX renders bearish, not bullish", () => {
    render(<QuoteStrip indexQuotes={QUOTES} headerCounts={HEADER_COUNTS} />)
    expect(screen.getByText('+4.20%')).toHaveClass('text-bearish')
  })

  it('discloses the VIX inversion in a tooltip', async () => {
    const user = userEvent.setup()
    render(<QuoteStrip indexQuotes={QUOTES} headerCounts={HEADER_COUNTS} />)

    await user.hover(screen.getByLabelText(/why india vix/i))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/inverted/i)
  })

  it('renders the live breakout/breakdown counts and breakout strength', () => {
    render(<QuoteStrip indexQuotes={QUOTES} headerCounts={HEADER_COUNTS} />)
    expect(screen.getByText('▲ 3')).toBeInTheDocument()
    expect(screen.getByText('▼ 1')).toBeInTheDocument()
    expect(screen.getByText('2.4')).toBeInTheDocument()
  })

  it('renders an em-dash for a NaN breakout strength rather than "NaN"', () => {
    render(<QuoteStrip indexQuotes={QUOTES} headerCounts={{ breakoutUpCount: 0, breakoutDownCount: 0, breakoutStrength: NaN }} />)
    expect(screen.queryByText(/nan/i)).not.toBeInTheDocument()
  })
})
