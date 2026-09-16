import { getMarketSession, type MarketSession } from '../../lib/marketSession'

export type ClockMode = 'live' | 'fixed'
export type ClockSpeed = 1 | 10 | 60 | 300

export interface ClockOptions {
  mode?: ClockMode
  /** Epoch seconds. The fixed instant (mode: 'fixed'), or the starting anchor for 'live'. */
  startTimestamp?: number
  speed?: ClockSpeed
  forceSessionOpen?: boolean
}

/**
 * The single injectable clock every module under src/data/mock/ reads
 * through — nothing else in the mock should call Date.now() or `new Date()`
 * directly. Supports running live (optionally sped up so a 5-minute scan
 * cycle can be demoed in seconds) or pinned to a fixed instant, and can
 * force the market session to OPEN so the demo works outside real trading
 * hours.
 */
export class MockClock {
  private mode: ClockMode
  private speed: ClockSpeed
  private forceSessionOpen: boolean
  private anchorRealMs: number
  private anchorSimSeconds: number

  constructor(options: ClockOptions = {}) {
    this.mode = options.mode ?? 'live'
    this.speed = options.speed ?? 1
    this.forceSessionOpen = options.forceSessionOpen ?? false
    this.anchorRealMs = Date.now()
    this.anchorSimSeconds = options.startTimestamp ?? Math.floor(this.anchorRealMs / 1000)
  }

  /** Current simulated time, epoch seconds. */
  now(): number {
    if (this.mode === 'fixed') {
      return this.anchorSimSeconds
    }
    const elapsedRealSeconds = (Date.now() - this.anchorRealMs) / 1000
    return Math.floor(this.anchorSimSeconds + elapsedRealSeconds * this.speed)
  }

  getMarketSession(): MarketSession {
    if (this.forceSessionOpen) return 'OPEN'
    return getMarketSession(new Date(this.now() * 1000))
  }

  setMode(mode: ClockMode, startTimestamp?: number): void {
    const currentSim = this.now()
    this.mode = mode
    this.anchorRealMs = Date.now()
    this.anchorSimSeconds = startTimestamp ?? currentSim
  }

  /** Re-anchors so changing speed never causes the simulated instant to jump. */
  setSpeed(speed: ClockSpeed): void {
    const currentSim = this.now()
    this.speed = speed
    this.anchorRealMs = Date.now()
    this.anchorSimSeconds = currentSim
  }

  setForceSessionOpen(force: boolean): void {
    this.forceSessionOpen = force
  }

  getState(): { mode: ClockMode; speed: ClockSpeed; forceSessionOpen: boolean; now: number } {
    return { mode: this.mode, speed: this.speed, forceSessionOpen: this.forceSessionOpen, now: this.now() }
  }
}
