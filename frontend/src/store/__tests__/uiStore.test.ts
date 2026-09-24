import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '../uiStore'

/**
 * REGRESSION: nextTourStep() used a boundary hardcoded independently of
 * FirstRunTour's own STEPS array. When a step was removed from STEPS without
 * updating this store, clicking "Done" on the new last step advanced tourStep
 * PAST the end of the array instead of dismissing: FirstRunTour.tsx's
 * `STEPS[step]` came back undefined, the dialog silently vanished, and
 * dismissTour() — the only thing that persists tourDismissed — was never
 * called. The tour would then reopen on every subsequent visit, forever.
 */

const TOUR_KEY = 'rsi-ha:tour-dismissed'
// Kept in sync with FirstRunTour.tsx's STEPS.length - 1 by hand (see the store's own comment).
const LAST_STEP = 1

afterEach(() => {
  localStorage.clear()
})

beforeEach(() => {
  useUiStore.setState({ tourStep: 0, tourDismissed: false })
})

describe('uiStore — first-run tour', () => {
  it('nextTourStep advances one step at a time, short of the last step', () => {
    for (let step = 0; step < LAST_STEP; step++) {
      useUiStore.getState().nextTourStep()
      expect(useUiStore.getState().tourStep).toBe(step + 1)
      expect(useUiStore.getState().tourDismissed).toBe(false)
    }
  })

  it('nextTourStep on the LAST step dismisses (not: steps past the end of the array)', () => {
    useUiStore.setState({ tourStep: LAST_STEP })
    useUiStore.getState().nextTourStep()
    expect(useUiStore.getState().tourStep).toBeNull()
    expect(useUiStore.getState().tourDismissed).toBe(true)
  })

  it('dismissing on the last step actually persists — the tour will not reopen next visit', () => {
    useUiStore.setState({ tourStep: LAST_STEP })
    useUiStore.getState().nextTourStep()
    expect(JSON.parse(localStorage.getItem(TOUR_KEY) ?? 'null')).toEqual({ version: 1, data: true })
  })

  it('calling nextTourStep while no tour is open is a no-op', () => {
    useUiStore.setState({ tourStep: null, tourDismissed: false })
    useUiStore.getState().nextTourStep()
    expect(useUiStore.getState().tourStep).toBeNull()
    expect(useUiStore.getState().tourDismissed).toBe(false)
  })
})
