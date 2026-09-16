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

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [])

  const scanned = scanState === 'scanning' ? scanProgress.done : universeSize > 0 ? universeSize : 0
  const secondsToNext = nextScanAt !== null ? Math.max(0, nextScanAt - now) : null

  const fields = [
    { label: 'Universe', value: universeSize > 0 ? String(universeSize) : '—' },
    { label: 'Scanned', value: universeSize > 0 ? `${scanned}/${universeSize}` : '—' },
    { label: 'Signals', value: universeSize > 0 ? String(visibleCount) : '—' },
    { label: 'Last scan', value: lastScanAt !== null ? formatISTTime(new Date(lastScanAt * 1000)) : '—' },
    { label: 'Next scan', value: secondsToNext !== null ? `${secondsToNext}s` : '—' },
    { label: 'WS', value: connectionState },
  ]

  return (
    <footer className="flex h-statusbar shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap border-t border-border bg-panel px-4 text-xs text-text-secondary">
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
