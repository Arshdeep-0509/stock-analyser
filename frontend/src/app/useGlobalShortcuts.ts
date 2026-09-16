import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ClockSpeed, MockMarketDataSource } from '../data/mock'
import type { ScreenerStore } from '../store/screenerStore'
import { useUiStore } from '../store/uiStore'

const SPEED_BY_DIGIT: Record<string, ClockSpeed> = { '1': 1, '2': 10, '3': 60, '4': 300 }
const G_CHORD_TIMEOUT_MS = 800

/**
 * App-wide shortcuts that make sense regardless of what's focused: pause,
 * rescan, replay speed, section navigation, and the cheat sheet itself.
 * Row-scoped nav (j/k/Enter, `/` to search) stays local to SignalsTable —
 * those only make sense when the table is what's on screen.
 */
export function useGlobalShortcuts(store: ScreenerStore, dataSource: MockMarketDataSource): void {
  const navigate = useNavigate()
  const pendingG = useRef(false)
  const pendingGTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null
      const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if (event.key === 'Escape' && useUiStore.getState().shortcutsOverlayOpen) {
        useUiStore.getState().setShortcutsOverlayOpen(false)
        return
      }
      if (isTyping) return

      if (pendingG.current) {
        pendingG.current = false
        if (pendingGTimer.current) clearTimeout(pendingGTimer.current)
        const key = event.key.toLowerCase()
        if (key === 's') {
          event.preventDefault()
          useUiStore.getState().setOpenPanel(null)
          navigate('/rsi-ha')
        } else if (key === 'w') {
          event.preventDefault()
          navigate('/rsi-ha')
          useUiStore.getState().togglePanel('watchlists')
        } else if (key === 'h') {
          event.preventDefault()
          navigate('/rsi-ha')
          useUiStore.getState().togglePanel('history')
        }
        return
      }

      if (event.key === 'g') {
        pendingG.current = true
        pendingGTimer.current = setTimeout(() => {
          pendingG.current = false
        }, G_CHORD_TIMEOUT_MS)
        return
      }

      if (event.key === '?') {
        event.preventDefault()
        useUiStore.getState().setShortcutsOverlayOpen(true)
        return
      }

      if (event.key === 'p') {
        event.preventDefault()
        store.getState().togglePause()
        return
      }

      if (event.key === 'r') {
        event.preventDefault()
        void store.getState().runScanNow()
        return
      }

      const speed = SPEED_BY_DIGIT[event.key]
      if (speed) {
        event.preventDefault()
        dataSource.setSpeed(speed)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (pendingGTimer.current) clearTimeout(pendingGTimer.current)
    }
  }, [store, dataSource, navigate])
}
