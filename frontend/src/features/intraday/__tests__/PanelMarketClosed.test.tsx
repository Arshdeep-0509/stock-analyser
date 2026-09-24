import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarketOpenContext, Panel } from '../Panel'

describe('Panel LIVE badge follows the market session', () => {
  it('open market: LIVE', () => {
    render(
      <MarketOpenContext.Provider value={true}>
        <Panel title="Market Meter" live>
          body
        </Panel>
      </MarketOpenContext.Provider>,
    )
    expect(screen.getByText('LIVE · SIMULATED')).toBeInTheDocument()
    expect(screen.queryByText('AS OF CLOSE')).not.toBeInTheDocument()
  })

  it('closed market: never claims LIVE, says the numbers are the close', () => {
    render(
      <MarketOpenContext.Provider value={false}>
        <Panel title="Market Meter" live>
          body
        </Panel>
      </MarketOpenContext.Provider>,
    )
    expect(screen.queryByText(/LIVE/)).not.toBeInTheDocument()
    expect(screen.getByText('AS OF CLOSE')).toBeInTheDocument()
  })

  it('a panel that is not live shows neither badge, open or closed', () => {
    for (const open of [true, false]) {
      const { unmount } = render(
        <MarketOpenContext.Provider value={open}>
          <Panel title="Top" live={false}>
            body
          </Panel>
        </MarketOpenContext.Provider>,
      )
      expect(screen.queryByText(/LIVE/)).not.toBeInTheDocument()
      expect(screen.queryByText('AS OF CLOSE')).not.toBeInTheDocument()
      unmount()
    }
  })
})
