import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../../strategy/constants'
import type { SignalKind } from '../../../types/domain'
import { LtpCell, RsiCell, SignalBadge } from '../cells'
import { SIGNAL_KINDS } from '../rowHelpers'

// Spec name mapping: bits.tsx -> cells.tsx; RsiMeter -> RsiCell's inline bar.
// "LtpCell never changes its own width" is a LAYOUT property (jsdom has no
// layout) and is checked in the browser suite instead — see e2e/.

const FLASH_MS = 400

describe('LtpCell — flash on change', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
  afterEach(() => vi.useRealTimers())

  const flashSpan = (): HTMLElement => {
    const el = screen.getByText(/₹/)
    return el.closest('span.inline-block') ?? el
  }

  it('flashes UP (green) on an increase and clears after the flash duration', () => {
    const { rerender } = render(<LtpCell ltp={100} />)
    expect(flashSpan().className).not.toMatch(/bg-(bullish|bearish)/)
    rerender(<LtpCell ltp={101} />)
    expect(flashSpan().className).toMatch(/bg-bullish/)
    act(() => {
      vi.advanceTimersByTime(FLASH_MS - 1)
    })
    expect(flashSpan().className).toMatch(/bg-bullish/)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(flashSpan().className).not.toMatch(/bg-(bullish|bearish)/)
  })

  it('flashes DOWN (red) on a decrease', () => {
    const { rerender } = render(<LtpCell ltp={101} />)
    rerender(<LtpCell ltp={100} />)
    expect(flashSpan().className).toMatch(/bg-bearish/)
  })

  it('does not flash on the first value, on an unchanged value, or when the value is missing', () => {
    const { rerender } = render(<LtpCell ltp={undefined} />)
    rerender(<LtpCell ltp={100} />) // first real value: nothing to compare against
    expect(flashSpan().className).not.toMatch(/bg-(bullish|bearish)/)
    rerender(<LtpCell ltp={100} />)
    expect(flashSpan().className).not.toMatch(/bg-(bullish|bearish)/)
  })

  it('renders the value with tabular digits (the column width, not the digits, keeps the row from reflowing)', () => {
    render(<LtpCell ltp={1888.88} />)
    expect(flashSpan().className).toMatch(/tabular-nums/)
    expect(flashSpan().textContent).toBe('₹1,888.88')
  })
})

describe('RsiCell — value + 0-100 meter', () => {
  const marker = (container: HTMLElement): HTMLElement => {
    const spans = Array.from(container.querySelectorAll<HTMLElement>('span[aria-hidden="true"]'))
    const m = spans.find((s) => s.className.includes('w-[2px]'))
    if (!m) throw new Error('no marker')
    return m
  }

  it.each([0, 37.5, 62.1, 100])('places the marker proportionally: RSI %s -> left %s%%', (rsi) => {
    const { container } = render(<RsiCell rsi={rsi} />)
    expect(marker(container).style.left).toBe(`${rsi}%`)
  })

  it('renders "—" and no meter for NaN', () => {
    const { container } = render(<RsiCell rsi={NaN} />)
    expect(container.textContent).toBe('—')
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  it('shades the bands the strategy is ACTUALLY using, not hardcoded 35-40 / 60-65', () => {
    const bands = { rsiBuyLow: 55, rsiBuyHigh: 70, rsiSellLow: 25, rsiSellHigh: 45 }
    const { container } = render(<RsiCell rsi={50} bands={bands} />)
    const shades = Array.from(container.querySelectorAll<HTMLElement>('span[aria-hidden="true"]')).filter((s) => /bg-(bullish|bearish)\/25/.test(s.className))
    const buy = shades.find((s) => s.className.includes('bg-bullish'))
    const sell = shades.find((s) => s.className.includes('bg-bearish'))
    expect(buy?.style.left).toBe('55%')
    expect(buy?.style.width).toBe('15%')
    expect(sell?.style.left).toBe('25%')
    expect(sell?.style.width).toBe('20%')
  })

  it('defaults to the reference bands when none are passed', () => {
    const { container } = render(<RsiCell rsi={50} />)
    const buy = Array.from(container.querySelectorAll<HTMLElement>('span.bg-bullish\\/25'))[0]
    expect(buy.style.left).toBe(`${DEFAULT_PARAMS.rsiBuyLow}%`)
    expect(buy.style.width).toBe(`${DEFAULT_PARAMS.rsiBuyHigh - DEFAULT_PARAMS.rsiBuyLow}%`)
  })
})

describe('SignalBadge — never colour alone', () => {
  it.each(SIGNAL_KINDS.map((k) => [k]))('%s renders a glyph AND its text label', (signal: SignalKind) => {
    const { container } = render(<SignalBadge signal={signal} />)
    expect(container.textContent).toContain(signal)
    const glyph = container.querySelector('svg, [data-glyph]')
    expect(glyph).not.toBeNull()
  })

  it('every kind is distinguishable without colour: distinct text labels', () => {
    const labels = SIGNAL_KINDS.map((signal) => {
      const { container, unmount } = render(<SignalBadge signal={signal} />)
      const text = container.textContent ?? ''
      unmount()
      return text
    })
    expect(new Set(labels).size).toBe(SIGNAL_KINDS.length)
  })
})
