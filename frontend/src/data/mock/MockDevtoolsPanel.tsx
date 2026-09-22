import { useEffect, useState, useSyncExternalStore } from 'react'
import { formatISTTime } from '../../lib/formatters'
import type { ClockSpeed } from './clock'
import type { MockMarketDataSource } from './MockMarketDataSource'

export interface MockDevtoolsPanelProps {
  client: MockMarketDataSource
}

const SPEED_OPTIONS: readonly ClockSpeed[] = [1, 10, 60, 300]

const buttonClass = 'rounded border border-border px-2 py-0.5 hover:bg-surface hover:text-text-primary'

/**
 * Dev-only control panel for MockMarketDataSource, toggled with `~`.
 * Deliberately imports the concrete mock class (not the MarketDataSource
 * interface) — these controls (seed, speed, force-disconnect, force-error,
 * regenerate universe) are mock-only and must never leak onto the
 * interface real code depends on.
 */
export function MockDevtoolsPanel({ client }: MockDevtoolsPanelProps) {
  const [visible, setVisible] = useState(false)
  const [seedInput, setSeedInput] = useState(() => String(client.getDevState().seed))
  const [, forceTick] = useState(0)

  const devState = useSyncExternalStore(
    (onStoreChange) => client.subscribeDevState(onStoreChange),
    () => client.getDevState(),
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === '`' || event.key === '~') {
        setVisible((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!visible) return
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [visible])

  if (!visible) return null

  return (
    // z-40, below every real drawer/modal — same rationale as ScanPerfReadout.
    <div className="fixed bottom-10 right-4 z-40 w-80 rounded border border-border bg-panel p-3 font-mono text-xs text-text-primary shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-text-secondary">MOCK DEVTOOLS</span>
        <button type="button" onClick={() => setVisible(false)} aria-label="Close" className="text-text-secondary hover:text-text-primary">
          ×
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 tabular-nums">
        <dt className="text-text-secondary">Connection</dt>
        <dd>{devState.connection}</dd>
        <dt className="text-text-secondary">Clock</dt>
        <dd>
          {devState.clockMode} / {devState.clockSpeed}x
        </dd>
        <dt className="text-text-secondary">Now (IST)</dt>
        <dd>{formatISTTime(new Date(client.getNow() * 1000))}</dd>
        <dt className="text-text-secondary">Session</dt>
        <dd>{devState.forceSessionOpen ? 'FORCED OPEN' : 'natural'}</dd>
        <dt className="text-text-secondary">Signals</dt>
        <dd>
          {devState.signalCount} ({devState.attempts} attempt{devState.attempts === 1 ? '' : 's'})
        </dd>
        <dt className="text-text-secondary">Universe</dt>
        <dd>{devState.universeSize} symbols</dd>
        <dt className="text-text-secondary">Seed</dt>
        <dd>
          {devState.seed} (epoch {devState.regenerateEpoch})
        </dd>
      </dl>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={seedInput}
          onChange={(event) => setSeedInput(event.target.value)}
          className="h-6 w-24 rounded border border-border bg-surface px-1 text-text-primary"
          aria-label="Seed"
        />
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            const parsed = Number(seedInput)
            if (Number.isFinite(parsed)) client.setSeed(parsed)
          }}
        >
          Set seed
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {SPEED_OPTIONS.map((speed) => (
          <button
            key={speed}
            type="button"
            className={`${buttonClass} ${devState.clockSpeed === speed ? 'border-neutral text-neutral' : ''}`}
            onClick={() => client.setSpeed(speed)}
          >
            {speed}x
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <button type="button" className={buttonClass} onClick={() => client.setForceSessionOpen(!devState.forceSessionOpen)}>
          {devState.forceSessionOpen ? 'Unforce session' : 'Force OPEN'}
        </button>
        <button type="button" className={buttonClass} onClick={() => client.forceDisconnect()}>
          Force disconnect
        </button>
        <button type="button" className={buttonClass} onClick={() => client.forceNextRequestError()}>
          Force next error
        </button>
        <button type="button" className={buttonClass} onClick={() => client.regenerateUniverse()}>
          Regenerate universe
        </button>
      </div>

      <p className="mt-2 text-[10px] text-text-muted">Press ~ to toggle</p>
    </div>
  )
}
