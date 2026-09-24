import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StarMarker } from '../StarMarker'

describe('StarMarker', () => {
  it('reflects the starred prop via aria-pressed', () => {
    const { rerender } = render(<StarMarker starred={false} onToggle={() => {}} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')

    rerender(<StarMarker starred={true} onToggle={() => {}} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })

  it('calls onToggle on click and does not bubble the click to a parent row', async () => {
    const onToggle = vi.fn()
    const onRowClick = vi.fn()
    const user = userEvent.setup()

    render(
      <div onClick={onRowClick}>
        <StarMarker starred={false} onToggle={onToggle} />
      </div>,
    )

    await user.click(screen.getByRole('button'))

    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('discloses that this is the user\'s own marker with no signal of its own, and names no other product', async () => {
    const user = userEvent.setup()
    render(<StarMarker starred={false} onToggle={() => {}} />)

    await user.hover(screen.getByRole('button'))

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent(/your own marker/i)
    expect(tooltip).toHaveTextContent(/no signal of its own/i)
    expect(tooltip).not.toHaveTextContent(/reference|dashboard/i)
  })
})
