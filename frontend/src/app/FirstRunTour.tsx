import { useEffect, useRef } from 'react'
import { Button } from '../components/ui/Button'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import { useUiStore } from '../store/uiStore'

interface TourStep {
  title: string
  body: string
}

const STEPS: readonly TourStep[] = [
  {
    title: 'What this screener does',
    body:
      'It scans a generated (simulated) universe of NSE equities and stock futures every few minutes, computing RSI and Heikin-Ashi candles for each, and surfaces the instruments where both line up — the same logic as the reference Python screener, ported 1:1.',
  },
  {
    title: 'What the bands mean',
    body:
      'A BUY needs RSI inside the buy band on a candle that is exactly the 2nd green Heikin-Ashi candle in a row — not the 5th, not the 1st. SELL mirrors that with the sell band and a 2nd red candle. Breakouts are a separate, independent check against a rolling price range.',
  },
  {
    title: 'The replay bar',
    body:
      'The bar at the bottom drives the same mock market backward and forward in simulated time — scrub it, step one bar at a time, or jump straight to the next bar where something fires. The table always reflects exactly what a real scan would have shown at that moment.',
  },
]

export function FirstRunTour() {
  const step = useUiStore((s) => s.tourStep)
  const nextStep = useUiStore((s) => s.nextTourStep)
  const dismiss = useUiStore((s) => s.dismissTour)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (step !== null) headingRef.current?.focus()
  }, [step])

  useEscapeToClose(step !== null, dismiss)

  if (step === null) return null

  const current = STEPS[step]
  if (!current) return null
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <div className="absolute inset-0 bg-surface/70" />
      <div className="relative flex w-full max-w-md flex-col rounded-lg border border-border bg-panel p-5 shadow-lg">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 ref={headingRef} tabIndex={-1} className="mb-2 text-base font-semibold text-text-primary outline-none">
          {current.title}
        </h2>
        <p className="mb-5 text-sm leading-relaxed text-text-secondary">{current.body}</p>
        <div className="flex items-center justify-between">
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Skip
          </Button>
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === step ? 'bg-neutral' : 'bg-border'}`} />
            ))}
          </div>
          <Button size="sm" variant="primary" onClick={nextStep}>
            {isLast ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
