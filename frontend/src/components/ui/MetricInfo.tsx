import { Info } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { METRIC_DOCS, OWN_DEFINITION_NOTE, type MetricKey } from '../../analytics/metricDocs'
import { cn } from '../../lib/cn'

const POPOVER_MAX_WIDTH = 300
const VIEWPORT_MARGIN = 8
/** Gap between the (i) button and the popover. */
const GAP = 6
/** Below this much room under the button, the popover opens ABOVE it instead (if there's more room there). */
const MIN_COMFORTABLE_HEIGHT = 240

/** Either `top` (opens below the button) or `bottom` (opens above it) is set, never both. */
interface Position {
  top?: number
  bottom?: number
  left: number
  width: number
  maxHeight: number
}

/**
 * The (i) popover for an invented metric: formula, definition and — the
 * honesty part — its limits, all from analytics/metricDocs.ts. Click to
 * open (not hover: this is meant to be read). Positioned `fixed` and
 * clamped to the viewport, so it never causes horizontal page scroll at
 * phone widths and is never clipped by a panel's own overflow. Follows its
 * (i) button while anything scrolls (flipping above it when there's no room
 * below), and closes on outside pointer-down, Escape, or once the button has
 * scrolled out of view — never on scroll as such: nested scrollers and
 * momentum scrolling on a phone fire scroll events the reader didn't cause.
 */
export function MetricInfo({ metric, className }: { metric: MetricKey; className?: string }) {
  const doc = METRIC_DOCS[metric]
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)
  const containerRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()
  const label = `About the ${doc.title} metric`

  useLayoutEffect(() => {
    if (!open) return

    /** Recomputes the popover's box from the button's CURRENT position; returns false once the button is off screen. */
    function place(): boolean {
      const button = buttonRef.current
      if (!button) return false
      const rect = button.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      if (rect.bottom < 0 || rect.top > viewportHeight || rect.right < 0 || rect.left > viewportWidth) return false

      const width = Math.min(POPOVER_MAX_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2)
      const centred = rect.left + rect.width / 2 - width / 2
      const left = Math.max(VIEWPORT_MARGIN, Math.min(centred, viewportWidth - width - VIEWPORT_MARGIN))
      const spaceBelow = viewportHeight - rect.bottom - GAP - VIEWPORT_MARGIN
      const spaceAbove = rect.top - GAP - VIEWPORT_MARGIN
      setPosition(
        spaceBelow >= MIN_COMFORTABLE_HEIGHT || spaceBelow >= spaceAbove
          ? { top: rect.bottom + GAP, left, width, maxHeight: spaceBelow }
          : {
              bottom: viewportHeight - rect.top + GAP,
              left,
              width,
              maxHeight: spaceAbove,
            },
      )
      return true
    }

    place()

    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Node
      // The popover is portalled to <body>, so it isn't inside containerRef — both count as "inside".
      if (containerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    function onScrollOrResize(): void {
      if (!place()) setOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open])

  return (
    <span ref={containerRef} className={cn('relative inline-flex', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        // A 16px icon with an invisible 40x40 hit area below md (the app-wide tap-target rule, see IconButton) — without bloating the panel header it sits in.
        className="relative inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted after:absolute after:-inset-3 after:content-[''] hover:text-text-primary md:after:hidden"
      >
        <Info className="h-3 w-3" />
      </button>

      {/* Portalled to <body>: inside a panel it would inherit that panel's stacking context (e.g. a sticky table header) and render UNDER the app's fixed bottom bars. */}
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="dialog"
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
            style={
              position
                ? {
                    top: position.top,
                    bottom: position.bottom,
                    left: position.left,
                    width: position.width,
                    maxHeight: position.maxHeight,
                  }
                : { visibility: 'hidden' }
            }
            className="fixed z-[60] overflow-y-auto rounded border border-border bg-panel p-3 text-left text-xs font-normal normal-case tracking-normal shadow-lg"
          >
            <p className="font-semibold text-text-primary">{doc.title}</p>
            <p className="mt-1 font-mono text-[11px] leading-relaxed text-text-secondary">{doc.formula}</p>
            <ul className="mt-2 space-y-1 text-text-secondary">
              {doc.definition.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Limits</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-text-secondary">
              {doc.limits.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-2 font-medium text-warning">{OWN_DEFINITION_NOTE}</p>
          </div>,
          document.body,
        )}
    </span>
  )
}
