import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Panel } from '../Panel'

describe('Panel', () => {
  it('renders the title and children', () => {
    render(<Panel title="Market Meter">Body content</Panel>)
    expect(screen.getByRole('heading', { name: 'Market Meter' })).toBeInTheDocument()
    expect(screen.getByText('Body content')).toBeInTheDocument()
  })

  it('shows the LIVE badge only when `live` is true, and marks it aria-live="off"', () => {
    const { rerender } = render(<Panel title="X">body</Panel>)
    expect(screen.queryByText('LIVE · SIMULATED')).not.toBeInTheDocument()

    rerender(
      <Panel title="X" live>
        body
      </Panel>,
    )
    const liveBadge = screen.getByText('LIVE · SIMULATED')
    expect(liveBadge.closest('[aria-live]')).toHaveAttribute('aria-live', 'off')
  })

  it('applies a bullish accent border for Breakout and bearish for BreakDown', () => {
    const { container: bullish } = render(
      <Panel title="Breakout" accent="bullish">
        body
      </Panel>,
    )
    expect(bullish.querySelector('section')).toHaveClass('border-l-bullish')

    const { container: bearish } = render(
      <Panel title="BreakDown" accent="bearish">
        body
      </Panel>,
    )
    expect(bearish.querySelector('section')).toHaveClass('border-l-bearish')
  })

  it('renders an optional toolbar slot', () => {
    render(
      <Panel title="X" toolbar={<button type="button">Configure</button>}>
        body
      </Panel>,
    )
    expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument()
  })
})
