import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PanelPlaceholder } from '../PanelPlaceholder'

describe('PanelPlaceholder', () => {
  it('shows a skeleton shape while loading', () => {
    const { container } = render(<PanelPlaceholder loading />)
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(screen.queryByText(/coming in a later step/i)).not.toBeInTheDocument()
  })

  it('shows the default "coming later" empty state once not loading', () => {
    render(<PanelPlaceholder loading={false} />)
    expect(screen.getByText('Chart coming in a later step')).toBeInTheDocument()
  })

  it('honours a custom label', () => {
    render(<PanelPlaceholder loading={false} label="Sector detail coming in a later step" />)
    expect(screen.getByText('Sector detail coming in a later step')).toBeInTheDocument()
  })
})
