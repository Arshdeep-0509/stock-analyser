import type { ScreenerStore } from '../../store/screenerStore'

export interface ScanPerfReadoutProps {
  store: ScreenerStore
}

/**
 * Dev-only performance readout for the scan loop: current scan state,
 * progress, universe size, and how long the last scan took. Takes the
 * store as a prop (like MockDevtoolsPanel takes `client`) rather than
 * importing an app-level singleton, so this feature module stays
 * decoupled from how the app happens to wire its store instance.
 */
export function ScanPerfReadout({ store }: ScanPerfReadoutProps) {
  const scanState = store((s) => s.scanState)
  const scanProgress = store((s) => s.scanProgress)
  const lastScanDurationMs = store((s) => s.lastScanDurationMs)
  const universeSize = store((s) => s.universe.length)

  if (!import.meta.env.DEV) return null

  return (
    <div className="fixed bottom-10 left-4 z-50 rounded border border-border bg-panel px-2 py-1 font-mono text-[10px] text-text-secondary shadow">
      scan: {scanState} · {scanProgress.done}/{scanProgress.total || universeSize} · last{' '}
      {lastScanDurationMs !== null ? `${lastScanDurationMs}ms` : '—'}
    </div>
  )
}
