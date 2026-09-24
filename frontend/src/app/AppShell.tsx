import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { PanelErrorBoundary } from '../components/ui/PanelErrorBoundary'
import { MockDevtoolsPanel } from '../data/mock'
import { ScanPerfReadout } from '../features/rsi-ha/ScanPerfReadout'
import { ToastStack } from '../features/rsi-ha/ToastStack'
import { useUiStore } from '../store/uiStore'
import { dataSource } from './dataSource'
import { FirstRunTour } from './FirstRunTour'
import { MobileNavChips } from './MobileNavChips'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { useGlobalShortcuts } from './useGlobalShortcuts'
import { useScreenerStore } from './screenerStore'
import { TopBar } from './TopBar'
import { LeftRail } from './LeftRail'
import { StatusBar } from './StatusBar'

export function AppShell() {
  const theme = useUiStore((s) => s.theme)

  useEffect(() => {
    useScreenerStore.getState().start()
    return () => useScreenerStore.getState().stop()
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useGlobalShortcuts(useScreenerStore, dataSource)

  return (
    // dvh, not vh: on mobile, browser chrome (the address bar) shows and
    // hides as the user scrolls, and vh doesn't account for that — it would
    // clip the status bar under the chrome instead of resizing around it the
    // way dvh does.
    <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-surface">
      <TopBar />
      <MobileNavChips />
      <div className="flex min-h-0 flex-1">
        <LeftRail />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <PanelErrorBoundary panelName="Screener" diagnostics={() => ({ seed: dataSource.getDevState().seed })}>
            <Outlet />
          </PanelErrorBoundary>
        </main>
      </div>
      <StatusBar />
      <footer role="contentinfo" className="border-t border-border bg-surface px-4 py-1 text-center text-[10px] text-text-muted">
        Mock market data generated locally. No broker connection. Not investment advice.
      </footer>
      <MockDevtoolsPanel client={dataSource} />
      <ScanPerfReadout store={useScreenerStore} />
      <ToastStack />
      <ShortcutsOverlay />
      <FirstRunTour />
    </div>
  )
}
