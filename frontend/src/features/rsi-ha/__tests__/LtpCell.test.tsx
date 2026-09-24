import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LtpCell } from '../cells'

describe('LtpCell', () => {
  it('defaults to ₹ currency formatting when no `format` is given', () => {
    render(<LtpCell ltp={2500} />)
    expect(screen.getByText('₹2,500.00')).toBeInTheDocument()
  })

  it('uses a custom formatter when one is passed, without touching the flash mechanism', () => {
    render(<LtpCell ltp={23398.4} format={(v) => v.toFixed(1)} />)
    expect(screen.getByText('23398.4')).toBeInTheDocument()
  })

  it('renders an em-dash for an undefined ltp regardless of formatter', () => {
    render(<LtpCell ltp={undefined} format={(v) => v.toFixed(1)} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
