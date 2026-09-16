import { create } from 'zustand'
import { loadVersioned, saveVersioned } from '../lib/persistence'

export type Theme = 'dark' | 'light'
export type PanelKey = 'watchlists' | 'parameters' | 'alerts' | 'history' | 'settings'

const THEME_KEY = 'rsi-ha:theme'
const THEME_VERSION = 1
const TOUR_KEY = 'rsi-ha:tour-dismissed'
const TOUR_VERSION = 1

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
      if (step >= 2) {
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
