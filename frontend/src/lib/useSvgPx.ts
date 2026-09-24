import { useLayoutEffect, useState } from 'react'

/** Assumed until the first measurement (and in environments without ResizeObserver, e.g. jsdom). */
const DEFAULT_SCALE = 2

/** Smallest chart-text size anywhere on /intraday, in screen pixels. */
export const CHART_FONT_PX = 10

export interface SvgSize {
  width: number
  height: number
}

export interface SvgBox {
  /** A callback ref — measurement starts whenever the <svg> actually mounts, even if that's after an early-return empty state. */
  ref: (el: SVGSVGElement | null) => void
  /** The SVG's measured CSS box, or null before the first measurement (or without ResizeObserver). */
  size: SvgSize | null
}

/** Measures an <svg>'s rendered CSS box and keeps it current with a ResizeObserver. */
export function useSvgBox(): SvgBox {
  const [el, setEl] = useState<SVGSVGElement | null>(null)
  const [size, setSize] = useState<SvgSize | null>(null)

  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      setSize((prev) =>
        prev && Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5 ? prev : { width: rect.width, height: rect.height },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])

  return { ref: setEl, size }
}

/** Rendered pixels per viewBox unit under preserveAspectRatio "meet" (the smaller of the two axis scales). */
export function svgScale(size: SvgSize | null, viewWidth: number, viewHeight: number): number {
  return size ? Math.min(size.width / viewWidth, size.height / viewHeight) : DEFAULT_SCALE
}

/**
 * For a row of `count` equal groups in a chart whose HEIGHT is fixed: the
 * group width (viewBox units) that makes the row exactly fill the measured
 * width — so a height-bound chart uses its whole panel instead of leaving
 * the right half empty — never narrower than `minGroupWidth`, and never
 * wider than `maxGroupWidth` (a 5-bar chart stretched across a wide panel
 * would otherwise turn into slabs).
 */
export function fillGroupWidth(size: SvgSize | null, viewHeight: number, count: number, minGroupWidth: number, maxGroupWidth = Infinity): number {
  if (!size || count === 0) return minGroupWidth
  const unitsWide = size.width / (size.height / viewHeight)
  return Math.min(maxGroupWidth, Math.max(minGroupWidth, unitsWide / count))
}

export interface SvgPx extends SvgBox {
  /** Screen pixels -> viewBox units, for this SVG's CURRENT rendered scale. */
  px: (pixels: number) => number
  /** Rendered pixels per viewBox unit. */
  scale: number
}

/**
 * Chart text in a viewBox-scaled SVG shrinks with the chart: a fontSize of
 * 2.6 units is 8px at one width and 5px at another. This measures the SVG's
 * actual rendered scale and lets callers size text in real screen pixels
 * instead — the /intraday "every chart legible" rule at every supported width.
 */
export function useSvgPx(viewWidth: number, viewHeight: number): SvgPx {
  const box = useSvgBox()
  const scale = svgScale(box.size, viewWidth, viewHeight)
  return { ...box, px: (pixels) => pixels / scale, scale }
}
