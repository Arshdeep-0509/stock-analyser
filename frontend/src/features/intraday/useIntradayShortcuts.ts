import { useEffect } from 'react'
import { SECTORS } from '../../data/reference/sectors'
import { DEFAULT_FILTERS, type IntradayStore } from '../../store/intradayStore'
import { useUiStore } from '../../store/uiStore'

/**
 * /intraday's OWN keyboard shortcuts — scoped by mounting only while
 * IntradayPage is (called from IntradayPage.tsx, not AppShell), so pressing
 * these keys on /rsi-ha never does anything intraday-specific. Deliberately
 * does NOT touch 'p'/'r'/'?'/digit-speed keys — those are already global
 * (src/app/useGlobalShortcuts.ts) and already reach the SAME shared
 * pauseStore/dataSource intraday itself reads, so duplicating them here
 * would just be a second listener doing the identical thing.
 */
export function useIntradayShortcuts(store: IntradayStore, searchInputId: string): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // The global shortcuts overlay owns Escape while it's open — don't
      // also clear filters/close the drawer underneath it on the same press.
      if (useUiStore.getState().shortcutsOverlayOpen) return

      const target = event.target as HTMLElement | null
      const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (event.key === '/' && !isTyping) {
        event.preventDefault()
        document.getElementById(searchInputId)?.focus()
        return
      }
      if (isTyping) return

      if (event.key === 's') {
        event.preventDefault()
        const currentSector = store.getState().filters.sector
        const currentIndex = SECTORS.findIndex((s) => s === currentSector)
        const nextSector = currentIndex + 1 >= SECTORS.length ? null : SECTORS[currentIndex + 1]
        store.getState().setFilters({ sector: nextSector })
        return
      }

      if (event.key === 'b') {
        event.preventDefault()
        store.getState().setFilters({ breakoutOnly: !store.getState().filters.breakoutOnly })
        return
      }

      if (event.key === 'Escape') {
        if (store.getState().selectedToken !== null) {
          store.getState().selectToken(null)
        } else {
          store.getState().setFilters({ ...DEFAULT_FILTERS })
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store, searchInputId])
}
