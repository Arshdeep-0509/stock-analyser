import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { METRIC_DOCS } from '../../../analytics/metricDocs'
import { MetricInfo } from '../MetricInfo'
import { StrengthInfo } from '../StrengthCell'

describe('MetricInfo', () => {
  it('opens on click with the formula, the definition and a Limits section', async () => {
    const user = userEvent.setup()
    render(<MetricInfo metric="smartMoney" />)

    await user.click(screen.getByRole('button', { name: 'About the Smart Money metric' }))
    const dialog = screen.getByRole('dialog', { name: 'About the Smart Money metric' })
    expect(dialog).toHaveTextContent(METRIC_DOCS.smartMoney.formula)
    expect(dialog).toHaveTextContent('Limits')
    expect(dialog).toHaveTextContent(/cannot see who is trading/i)
    expect(dialog).toHaveTextContent(/not intended to match/i)
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(<MetricInfo metric="capWeight" />)

    await user.click(screen.getByRole('button', { name: /cap-weight/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays open when something scrolls while its button is still on screen (nested scrollers, momentum scrolling)', async () => {
    const user = userEvent.setup()
    render(<MetricInfo metric="marketMeter" />)

    await user.click(screen.getByRole('button', { name: 'About the Market Meter metric' }))
    fireEvent.scroll(window)
    fireEvent.scroll(document.body)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps the popover inside the viewport horizontally', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 })
    render(<MetricInfo metric="strength" />)

    await user.click(screen.getByRole('button', { name: 'About the Strength metric' }))
    const dialog = screen.getByRole('dialog')
    const left = parseFloat(dialog.style.left)
    const width = parseFloat(dialog.style.width)
    expect(left).toBeGreaterThanOrEqual(8)
    expect(left + width).toBeLessThanOrEqual(360 - 8)
  })

  it('StrengthInfo is the strength entry of the same popover', async () => {
    const user = userEvent.setup()
    render(<StrengthInfo />)
    await user.click(screen.getByRole('button', { name: 'About the Strength metric' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(/Unsigned/)
  })
})
