import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { PanelErrorBoundary } from '../components/ui/PanelErrorBoundary'
import { MockDevtoolsPanel } from '../data/mock'
import { ReplayTransportBar } from '../features/rsi-ha/ReplayTransportBar'
import { ScanPerfReadout } from '../features/rsi-ha/ScanPerfReadout'
import { ToastStack } from '../features/rsi-ha/ToastStack'
import { useUiStore } from '../store/uiStore'
import { dataSource } from './dataSource'
import { FirstRunTour } from './FirstRunTour'
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
    <div className="flex h-screen flex-col bg-surface">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftRail />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <PanelErrorBoundary panelName="Screener" diagnostics={() => ({ seed: dataSource.getDevState().seed })}>
            <Outlet />
          </PanelErrorBoundary>
        </main>
      </div>
      <PanelErrorBoundary panelName="Replay controls" diagnostics={() => ({ seed: dataSource.getDevState().seed })}>
        <ReplayTransportBar dataSource={dataSource} store={useScreenerStore} />
      </PanelErrorBoundary>
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
