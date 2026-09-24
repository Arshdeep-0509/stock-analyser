import { create } from 'zustand'

/**
 * The one shared pause flag for both /rsi-ha and /intraday — "one clock,
 * one pause": pausing on either page must pause the other, since they read
 * ticks and bar-close events off the same underlying MarketDataSource.
 * Deliberately a single module-level store rather than state duplicated
 * inside screenerStore/intradayStore, which would drift the moment one
 * page's toggle didn't reach the other.
 */
export interface PauseState {
  isPaused: boolean
  togglePause: () => void
  setPaused: (paused: boolean) => void
}

export const usePauseStore = create<PauseState>()((set, get) => ({
  isPaused: false,
  togglePause() {
    set({ isPaused: !get().isPaused })
  },
  setPaused(paused) {
    set({ isPaused: paused })
  },
}))
