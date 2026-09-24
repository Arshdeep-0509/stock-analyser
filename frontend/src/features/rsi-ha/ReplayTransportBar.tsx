import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Pause, Play, RotateCcw, SkipForward, Zap } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { cn } from '../../lib/cn'
import { formatISTDate, formatISTTime } from '../../lib/formatters'
import { findNextSignalTimestamp } from './findNextSignal'
import type { ClockSpeed } from '../../data/mock'
import type { MockMarketDataSource } from '../../data/mock'
import type { ScreenerStore } from '../../store/screenerStore'

export interface ReplayTransportBarProps {
  dataSource: MockMarketDataSource
  store: ScreenerStore
}

const SPEED_OPTIONS: readonly ClockSpeed[] = [1, 10, 60, 300]
const DISPLAY_POLL_MS = 250
// findNextSignalTimestamp() locates a candidate bar directly (see its own
// comment for how), so each loop iteration here is one confirming rescan at
// an already-known signal-bearing bar, not a blind step-by-step sweep — this
// bound only guards the rare edge case where a found candidate's full scan
// (option-leg derivation etc.) turns up no visible row and the search has to
// keep going.
const MAX_JUMP_STEPS = 50

export function ReplayTransportBar({ dataSource, store }: ReplayTransportBarProps) {
  const devState = useSyncExternalStore(
    (onStoreChange) => dataSource.subscribeDevState(onStoreChange),
    () => dataSource.getDevState(),
  )

  const [displayNow, setDisplayNow] = useState(() => dataSource.getNow())
  const [isPlaying, setIsPlaying] = useState(false)
  const [seedInput, setSeedInput] = useState(String(devState.seed))
  const [jumping, setJumping] = useState(false)
  const [jumpProgress, setJumpProgress] = useState(0)
  const jumpCancelled = useRef(false)
  const intervalMinutes = 5

  useEffect(() => {
    const id = window.setInterval(() => setDisplayNow(dataSource.getNow()), DISPLAY_POLL_MS)
    return () => window.clearInterval(id)
  }, [dataSource])

  // While playing, keep rescanning periodically so newly-closed bars show up
  // as the sped-up clock advances — the same engine the whole app uses, not
  // a recorded log.
  const rescanTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!isPlaying) {
      if (rescanTimer.current) window.clearInterval(rescanTimer.current)
      return
    }
    rescanTimer.current = window.setInterval(() => {
      void store.getState().runScanNow({ immediateReplace: true })
    }, 1000)
    return () => {
      if (rescanTimer.current) window.clearInterval(rescanTimer.current)
    }
  }, [isPlaying, store])

  function pinAndRescan(timestamp: number) {
    dataSource.setClockMode('fixed', timestamp)
    setDisplayNow(timestamp)
    void store.getState().runScanNow({ immediateReplace: true })
  }

  function play() {
    dataSource.setClockMode('live', displayNow)
    setIsPlaying(true)
  }

  function pause() {
    dataSource.setClockMode('fixed', dataSource.getNow())
    setDisplayNow(dataSource.getNow())
    setIsPlaying(false)
  }

  function restart() {
    setIsPlaying(false)
    pinAndRescan(devState.sessionStart)
  }

  function stepForward() {
    setIsPlaying(false)
    pinAndRescan(Math.min(devState.sessionEnd, displayNow + intervalMinutes * 60))
  }

  async function jumpToNextSignal() {
    setIsPlaying(false)
    setJumping(true)
    setJumpProgress(0)
    jumpCancelled.current = false
    const resumeAt = displayNow
    dataSource.setFastForward(true)
    try {
      let cursor = displayNow
      let found = false
      for (let attempt = 0; attempt < MAX_JUMP_STEPS; attempt++) {
        if (jumpCancelled.current) break
        setJumpProgress(attempt + 1)

        // Pin the clock past the end of the session so the search sees each
        // symbol's full history, not one truncated at "still forming".
        dataSource.setClockMode('fixed', devState.sessionEnd)
        const nextTs = await findNextSignalTimestamp(store.getState().universe, dataSource, store.getState().params, cursor, () => jumpCancelled.current)
        if (nextTs == null || jumpCancelled.current) break

        dataSource.setClockMode('fixed', nextTs)
        await store.getState().runScanNow({ immediateReplace: true })
        setDisplayNow(nextTs)
        cursor = nextTs
        if (store.getState().visibleRows.length > 0) {
          found = true
          break
        }
      }
      if (!found && !jumpCancelled.current) {
        dataSource.setClockMode('fixed', resumeAt)
        await store.getState().runScanNow({ immediateReplace: true })
        setDisplayNow(resumeAt)
      }
    } finally {
      dataSource.setFastForward(false)
      setJumping(false)
    }
  }

  function cancelJump() {
    jumpCancelled.current = true
  }

  function newMarket() {
    const parsed = Number(seedInput)
    if (!Number.isFinite(parsed)) return
    setIsPlaying(false)
    dataSource.setSeed(parsed)
    dataSource.setClockMode('fixed', dataSource.getDevState().sessionStart)
    void store.getState().loadUniverse().then(() => store.getState().runScanNow({ immediateReplace: true }))
  }

  const sessionSpan = Math.max(1, devState.sessionEnd - devState.sessionStart)
  const progress = ((displayNow - devState.sessionStart) / sessionSpan) * 100

  const transportButtons = (
    <div className="flex shrink-0 items-center gap-1">
      <Button size="sm" variant="ghost" onClick={restart} aria-label="Restart">
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={isPlaying ? pause : play} aria-label={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <Button size="sm" variant="ghost" onClick={stepForward} aria-label="Step forward one bar" disabled={isPlaying}>
        <SkipForward className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={jumping ? cancelJump : () => void jumpToNextSignal()} disabled={isPlaying}>
        <Zap className="h-3.5 w-3.5" />{' '}
        {jumping ? (jumpProgress > 1 ? `Searching… (attempt ${jumpProgress}, click to cancel)` : 'Searching… (click to cancel)') : 'Next signal'}
      </Button>
    </div>
  )

  const scrubber = (
    <input
      type="range"
      min={devState.sessionStart}
      max={devState.sessionEnd}
      value={displayNow}
      onChange={(e) => {
        setIsPlaying(false)
        pinAndRescan(Number(e.target.value))
      }}
      className={cn(
        'h-11 flex-1 accent-neutral sm:h-1 sm:w-32 sm:flex-none md:w-auto md:flex-1',
        '[&::-webkit-slider-thumb]:h-11 [&::-webkit-slider-thumb]:w-11 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-neutral [&::-webkit-slider-thumb]:bg-text-primary sm:[&::-webkit-slider-thumb]:h-3.5 sm:[&::-webkit-slider-thumb]:w-3.5',
      )}
      style={{ background: `linear-gradient(to right, rgb(var(--color-neutral)) ${progress}%, rgb(var(--color-border)) ${progress}%)` }}
      aria-label="Session scrubber"
    />
  )

  const speedChips = (
    <div className="flex shrink-0 items-center gap-0.5">
      {SPEED_OPTIONS.map((speed) => (
        <button
          key={speed}
          type="button"
          onClick={() => dataSource.setSpeed(speed)}
          aria-pressed={devState.clockSpeed === speed}
          className={cn(
            'h-8 shrink-0 rounded border px-1.5 text-xs sm:h-auto sm:py-0.5',
            devState.clockSpeed === speed ? 'border-neutral text-neutral' : 'border-border text-text-secondary hover:text-text-primary',
          )}
        >
          {speed}x
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-border bg-panel px-4 py-1.5 text-xs sm:h-9 sm:flex-row sm:items-center sm:gap-3 sm:py-0">
      {/*
        Below sm: transport buttons + date on row one, speed chips + scrubber
        on row two, seed/new-market as an overflow-scrollable row three (the
        percentage/next-scan-style readout some rows would otherwise carry is
        dropped here, not just hidden, since there's nothing analogous to
        hide — the date/time text already does that job compactly). At sm+
        it collapses back to the single continuous strip, horizontally
        scrollable within itself if it's ever still too tight.
      */}
      <div className="flex items-center gap-2 overflow-x-auto sm:contents">
        {transportButtons}
        <span className="shrink-0 font-mono tabular-nums text-text-secondary sm:w-36">
          {formatISTDate(new Date(displayNow * 1000))} {formatISTTime(new Date(displayNow * 1000))}
        </span>
      </div>

      <div className="flex items-center gap-2 sm:contents">
        {speedChips}
        {scrubber}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto sm:contents">
        <Input value={seedInput} onChange={(e) => setSeedInput(e.target.value)} className="w-20 shrink-0" aria-label="Seed" />
        <Button size="sm" variant="secondary" className="shrink-0" onClick={newMarket}>
          New market
        </Button>
      </div>
    </div>
  )
}
