import { Maximize, Minimize, Pause, Play, RefreshCw, Rows2, Rows3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui'
import { usePauseStore } from '../../store/pauseStore'
import type { IntradayStore } from '../../store/intradayStore'
import type { Density } from './DensityContext'

export interface DashboardControlsProps {
  store: IntradayStore
  density: Density
  onDensityChange: (density: Density) => void
  /** Epoch seconds, the SAME simulated clock everything else on the page reads — countdown math must never use Date.now() directly, or it would run at real-world speed while the replay clock is sped up or paused. */
  now: number
}

/**
 * The page-level controls that make /intraday feel like ONE instrument
 * rather than a pile of independent panels: refresh-now + a countdown to
 * the next automatic one, pause/resume (the SAME usePauseStore every poll
 * loop already reads — this button and the global 'p' key both just flip
 * the one shared flag), density, and fullscreen. Deliberately does NOT
 * duplicate clock-speed/session controls: those live only in the mock
 * devtools panel (`~`), shared globally — a second copy here would just be
 * two controls fighting over the same clock.
 */
export function DashboardControls({ store, density, onDensityChange, now }: DashboardControlsProps) {
  const isPaused = usePauseStore((s) => s.isPaused)
  const nextRefreshAt = store((s) => s.nextRefreshAt)
  const loadState = store((s) => s.loadState)
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement !== null)

  useEffect(() => {
    function onFullscreenChange(): void {
      setIsFullscreen(document.fullscreenElement !== null)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  function toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
    }
  }

  const secondsToRefresh = nextRefreshAt !== null ? Math.max(0, Math.round(nextRefreshAt - now)) : null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" onClick={() => void store.getState().refreshAll()} disabled={loadState === 'loading'}>
        <RefreshCw className="h-3.5 w-3.5" />
        Refresh now
      </Button>
      {secondsToRefresh !== null && (
        <span className="font-mono text-xs tabular-nums text-text-secondary" title="Time until the next automatic refresh">
          next in {secondsToRefresh}s
        </span>
      )}

      <span className="h-4 w-px bg-border" aria-hidden="true" />

      <Button size="sm" variant="ghost" onClick={() => usePauseStore.getState().togglePause()} aria-pressed={isPaused}>
        {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        {isPaused ? 'Resume' : 'Pause'}
      </Button>

      <span className="h-4 w-px bg-border" aria-hidden="true" />

      <Button
        size="sm"
        variant="ghost"
        onClick={() => onDensityChange(density === 'compact' ? 'comfortable' : 'compact')}
        aria-pressed={density === 'compact'}
      >
        {density === 'compact' ? <Rows3 className="h-3.5 w-3.5" /> : <Rows2 className="h-3.5 w-3.5" />}
        {density === 'compact' ? 'Comfortable' : 'Compact'}
      </Button>

      <Button size="sm" variant="ghost" onClick={toggleFullscreen} aria-pressed={isFullscreen}>
        {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
        {isFullscreen ? 'Exit full screen' : 'Full screen'}
      </Button>
    </div>
  )
}
