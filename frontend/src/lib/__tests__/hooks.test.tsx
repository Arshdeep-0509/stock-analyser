import { act, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRenderCount, getRenderCounts, resetRenderCounts, useRenderCount } from '../renderCounter'
import { useEscapeToClose } from '../useEscapeToClose'
import { fillGroupWidth, svgScale, useSvgPx } from '../useSvgPx'

afterEach(() => {
  resetRenderCounts()
  document.body.style.overflow = ''
})

describe('useEscapeToClose', () => {
  it('while open: Escape closes, other keys do not, and background scroll is locked then restored', () => {
    document.body.style.overflow = 'auto'
    const onClose = vi.fn()
    const { rerender, unmount } = renderHook(({ open }) => useEscapeToClose(open, onClose), { initialProps: { open: true } })
    expect(document.body.style.overflow).toBe('hidden')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(onClose).not.toHaveBeenCalled()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender({ open: false })
    expect(document.body.style.overflow).toBe('auto')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('while closed it neither listens nor locks scroll', () => {
    const onClose = vi.fn()
    renderHook(() => useEscapeToClose(false, onClose))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('')
  })
})

describe('renderCounter (dev-only)', () => {
  function Counted({ name }: { name: string }) {
    useRenderCount(name)
    return null
  }

  it('counts commits per name and reports them highest first, ties by name', () => {
    const { rerender } = render(
      <>
        <Counted name="b" />
        <Counted name="a" />
      </>,
    )
    rerender(
      <>
        <Counted name="b" />
        <Counted name="a" />
      </>,
    )
    render(<Counted name="c" />)
    expect(getRenderCount('a')).toBe(2)
    expect(getRenderCount('missing')).toBe(0)
    expect(getRenderCounts()).toEqual([
      { name: 'a', count: 2 },
      { name: 'b', count: 2 },
      { name: 'c', count: 1 },
    ])
    resetRenderCounts()
    expect(getRenderCounts()).toEqual([])
  })
})

describe('useSvgPx and friends', () => {
  it('svgScale: the smaller axis scale ("meet"), or 2 before the first measurement', () => {
    expect(svgScale(null, 100, 50)).toBe(2)
    expect(svgScale({ width: 400, height: 100 }, 100, 50)).toBe(2)
    expect(svgScale({ width: 300, height: 600 }, 100, 50)).toBe(3)
  })

  it('fillGroupWidth: fills the measured width, clamped to [min, max]', () => {
    expect(fillGroupWidth(null, 50, 5, 8)).toBe(8)
    expect(fillGroupWidth({ width: 400, height: 100 }, 50, 0, 8)).toBe(8)
    // 400px wide at 2px/unit = 200 units over 5 groups = 40 units each.
    expect(fillGroupWidth({ width: 400, height: 100 }, 50, 5, 8)).toBe(40)
    expect(fillGroupWidth({ width: 400, height: 100 }, 50, 5, 8, 30)).toBe(30)
    expect(fillGroupWidth({ width: 400, height: 100 }, 50, 5, 60)).toBe(60)
  })

  it('measures the mounted <svg>, ignores sub-half-pixel jitter and zero sizes, and converts px to units', () => {
    let rect = { width: 300, height: 150 }
    let fire: (() => void) | null = null
    const RealRO = window.ResizeObserver
    class RecordingRO {
      constructor(cb: () => void) {
        fire = cb
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    window.ResizeObserver = RecordingRO as unknown as typeof ResizeObserver
    try {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      el.getBoundingClientRect = () => ({ ...rect, x: 0, y: 0, top: 0, left: 0, right: rect.width, bottom: rect.height, toJSON: () => ({}) })
      const { result } = renderHook(() => useSvgPx(100, 50))
      expect(result.current.size).toBeNull()
      expect(result.current.scale).toBe(2)

      act(() => result.current.ref(el))
      expect(result.current.size).toEqual({ width: 300, height: 150 })
      expect(result.current.scale).toBe(3)
      expect(result.current.px(12)).toBe(4)

      const before = result.current.size
      rect = { width: 300.2, height: 150.1 }
      act(() => fire?.())
      expect(result.current.size).toBe(before)

      rect = { width: 0, height: 0 }
      act(() => fire?.())
      expect(result.current.size).toBe(before)

      rect = { width: 600, height: 150 }
      act(() => fire?.())
      expect(result.current.size).toEqual({ width: 600, height: 150 })
    } finally {
      window.ResizeObserver = RealRO
    }
  })
})
