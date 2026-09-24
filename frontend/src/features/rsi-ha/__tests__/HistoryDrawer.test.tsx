import { act, render, screen } from '@testing-library/react'
import { Profiler } from 'react'
import { describe, expect, it } from 'vitest'
import { makeRow, seededStore } from '../../../test-utils/fixtures'
import { HistoryDrawer } from '../HistoryDrawer'

/**
 * REGRESSION: while closed, HistoryDrawer handed useOutcomes() a fresh `[]`
 * every render, so its effect re-ran forever (effect -> setOutcomes -> render
 * -> new [] -> effect ...). From page load it churned React updates in the
 * background, and a click that re-rendered the left rail (Parameters, Alerts,
 * Watchlists) turned that into a synchronous loop that froze the page.
 */

async function settle(): Promise<void> {
  // Flush microtasks and React work repeatedly: a self-sustaining update loop keeps committing.
  for (let i = 0; i < 25; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

describe('HistoryDrawer', () => {
  it('closed, it settles: a bounded number of commits, not an endless update loop', async () => {
    const store = seededStore([makeRow()])
    let commits = 0
    render(
      <Profiler id="history" onRender={() => (commits += 1)}>
        <HistoryDrawer open={false} onClose={() => {}} store={store} />
      </Profiler>,
    )
    await settle()
    const settled = commits
    expect(settled).toBeLessThanOrEqual(3)
    await settle()
    expect(commits).toBe(settled)
  })

  it('open, it shows the "not a backtest" disclaimer', async () => {
    const store = seededStore([makeRow()])
    render(<HistoryDrawer open onClose={() => {}} store={store} />)
    await settle()
    expect(screen.getByText(/not a backtest/)).toBeInTheDocument()
  })
})
