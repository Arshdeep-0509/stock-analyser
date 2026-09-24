import { create } from 'zustand'
import { loadVersioned, saveVersioned } from '../lib/persistence'

export type Theme = 'dark' | 'light'
export type PanelKey = 'watchlists' | 'parameters' | 'alerts' | 'history' | 'settings'

const THEME_KEY = 'rsi-ha:theme'
const THEME_VERSION = 1
const TOUR_KEY = 'rsi-ha:tour-dismissed'
const TOUR_VERSION = 1
/** The last valid index into FirstRunTour's STEPS array (2 steps: 0, 1) — see nextTourStep(). */
const TOUR_LAST_STEP = 1

function loadTheme(): Theme {
  return loadVersioned<Theme>(THEME_KEY, THEME_VERSION, () => null) ?? 'dark'
}

function loadTourDismissed(): boolean {
  return loadVersioned<boolean>(TOUR_KEY, TOUR_VERSION, () => null) ?? false
}

export interface UiState {
  theme: Theme
  toggleTheme: () => void

  /** Which left-rail panel is open, if any — lifted out of LeftRail so the top bar and `g` shortcuts can drive it too. */
  openPanel: PanelKey | null
  setOpenPanel: (panel: PanelKey | null) => void
  togglePanel: (panel: PanelKey) => void

  shortcutsOverlayOpen: boolean
  setShortcutsOverlayOpen: (open: boolean) => void

  /** First-run tour: shown once, never auto-repeats once dismissed (persisted). */
  tourStep: number | null
  tourDismissed: boolean
  startTour: () => void
  nextTourStep: () => void
  dismissTour: () => void
}

export const useUiStore = create<UiState>()((set, get) => {
  const tourDismissed = loadTourDismissed()

  return {
    theme: loadTheme(),
    toggleTheme() {
      const theme: Theme = get().theme === 'dark' ? 'light' : 'dark'
      set({ theme })
      saveVersioned(THEME_KEY, THEME_VERSION, theme)
    },

    openPanel: null,
    setOpenPanel(panel) {
      set({ openPanel: panel })
    },
    togglePanel(panel) {
      set((s) => ({ openPanel: s.openPanel === panel ? null : panel }))
    },

    shortcutsOverlayOpen: false,
    setShortcutsOverlayOpen(open) {
      set({ shortcutsOverlayOpen: open })
    },

    tourStep: tourDismissed ? null : 0,
    tourDismissed,
    startTour() {
      if (get().tourDismissed) return
      set({ tourStep: 0 })
    },
    nextTourStep() {
      const step = get().tourStep
      if (step === null) return
      // Must track FirstRunTour's own STEPS.length - 1: on the last step this
      // dismisses (and persists tourDismissed) instead of advancing past the
      // end of the array, where the tour would silently vanish without ever
      // marking itself seen, and reappear on the next visit.
      if (step >= TOUR_LAST_STEP) {
        get().dismissTour()
        return
      }
      set({ tourStep: step + 1 })
    },
    dismissTour() {
      set({ tourStep: null, tourDismissed: true })
      saveVersioned(TOUR_KEY, TOUR_VERSION, true)
    },
  }
})
