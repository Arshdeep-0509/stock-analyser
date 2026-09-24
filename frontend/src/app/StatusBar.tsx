import { Fragment, useEffect, useState } from 'react'
import { formatISTTime } from '../lib/formatters'
import { useScreenerStore } from './screenerStore'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span>
      {label}: <span className="font-mono tabular-nums text-text-primary">{value}</span>
    </span>
  )
}

export function StatusBar() {
  const universeSize = useScreenerStore((s) => s.universe.length)
  const scanState = useScreenerStore((s) => s.scanState)
  const scanProgress = useScreenerStore((s) => s.scanProgress)
  const visibleCount = useScreenerStore((s) => s.visibleRows.length)
  const lastScanAt = useScreenerStore((s) => s.lastScanAt)
  const nextScanAt = useScreenerStore((s) => s.nextScanAt)
  const connectionState = useScreenerStore((s) => s.connectionState)
  const isPaused = useScreenerStore((s) => s.isPaused)
  const lastScanDurationMs = useScreenerStore((s) => s.lastScanDurationMs)

  // Simulated market time — nextScanAt is on the store's injected clock, not the wall clock.
  const [now, setNow] = useState(() => useScreenerStore.getState().clockNow())
  useEffect(() => {
    const id = window.setInterval(() => setNow(useScreenerStore.getState().clockNow()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const scanned = scanState === 'scanning' ? scanProgress.done : universeSize > 0 ? universeSize : 0
  const secondsToNext = nextScanAt !== null ? Math.max(0, nextScanAt - now) : null

  const fields = [
    { label: 'Universe', value: universeSize > 0 ? String(universeSize) : '—' },
    { label: 'Scanned', value: universeSize > 0 ? `${scanned}/${universeSize}` : '—' },
    { label: 'Signals', value: universeSize > 0 ? String(visibleCount) : '—' },
    { label: 'Last scan', value: lastScanAt !== null ? formatISTTime(new Date(lastScanAt * 1000)) : '—' },
    // Paused: no scan is coming, so no countdown (it used to keep ticking to 0 while nothing would run).
    { label: 'Next scan', value: isPaused ? 'paused' : secondsToNext !== null ? `${secondsToNext}s` : '—' },
    { label: 'WS', value: connectionState },
  ]

  return (
    // data-*: the last scan's wall-clock duration and (simulated) time, machine-readable in any build: the perf E2E reads them.
    <footer
      data-last-scan-ms={lastScanDurationMs ?? undefined}
      data-last-scan-at={lastScanAt ?? undefined}
      className="flex h-statusbar shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-t border-border bg-panel px-4 text-xs text-text-secondary">
      {fields.map((field, index) => (
        <Fragment key={field.label}>
          {index > 0 && (
            <span className="text-border" aria-hidden="true">
              ·
            </span>
          )}
          <Field label={field.label} value={field.value} />
        </Fragment>
      ))}
    </footer>
  )
}
