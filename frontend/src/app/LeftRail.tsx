import { Tooltip } from '../components/ui/Tooltip'
import { AlertsDrawer } from '../features/rsi-ha/AlertsDrawer'
import { HistoryDrawer } from '../features/rsi-ha/HistoryDrawer'
import { ParametersDrawer } from '../features/rsi-ha/ParametersDrawer'
import { SettingsDrawer } from '../features/rsi-ha/SettingsDrawer'
import { WatchlistsDrawer } from '../features/rsi-ha/WatchlistsDrawer'
import { PanelErrorBoundary } from '../components/ui/PanelErrorBoundary'
import { useAlertStore } from '../store/alertStore'
import { useUiStore } from '../store/uiStore'
import { cn } from '../lib/cn'
import { dataSource } from './dataSource'
import { railItems } from './railItems'
import { useScreenerStore } from './screenerStore'

/** Vertical icon rail — the desktop/tablet nav, hidden below `sm` in favour of MobileNavChips. */
export function LeftRail() {
  const openPanel = useUiStore((s) => s.openPanel)
  const togglePanel = useUiStore((s) => s.togglePanel)
  const unreadCount = useAlertStore((s) => s.notifications.filter((n) => !n.read).length)

  return (
    <>
      <nav aria-label="Sections" className="hidden w-rail shrink-0 flex-col items-center gap-1 border-r border-border bg-panel py-3 sm:flex">
        {railItems.map(({ icon: Icon, label, panel }, index) => (
          <Tooltip key={label} label={label} side="right">
            <button
              type="button"
              aria-label={label}
              aria-pressed={panel !== null && openPanel === panel}
              onClick={() => panel && togglePanel(panel)}
              className={cn(
                'relative flex h-9 w-9 items-center justify-center rounded text-text-secondary transition-colors hover:bg-surface hover:text-text-primary',
                (index === 0 && !openPanel) || openPanel === panel ? 'bg-surface text-neutral' : '',
              )}
            >
              <Icon className="h-4 w-4" />
              {panel === 'alerts' && unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-bearish px-0.5 text-[9px] font-medium leading-none text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </Tooltip>
        ))}
      </nav>

      <PanelErrorBoundary panelName="Parameters">
        <ParametersDrawer open={openPanel === 'parameters'} onClose={() => useUiStore.getState().setOpenPanel(null)} store={useScreenerStore} />
      </PanelErrorBoundary>
      <PanelErrorBoundary panelName="Watchlists">
        <WatchlistsDrawer
          open={openPanel === 'watchlists'}
          onClose={() => useUiStore.getState().setOpenPanel(null)}
          dataSource={dataSource}
          store={useScreenerStore}
        />
      </PanelErrorBoundary>
      <PanelErrorBoundary panelName="Alerts">
        <AlertsDrawer open={openPanel === 'alerts'} onClose={() => useUiStore.getState().setOpenPanel(null)} />
      </PanelErrorBoundary>
      <PanelErrorBoundary panelName="History">
        <HistoryDrawer open={openPanel === 'history'} onClose={() => useUiStore.getState().setOpenPanel(null)} store={useScreenerStore} />
      </PanelErrorBoundary>
      <PanelErrorBoundary panelName="Settings">
        <SettingsDrawer open={openPanel === 'settings'} onClose={() => useUiStore.getState().setOpenPanel(null)} dataSource={dataSource} />
      </PanelErrorBoundary>
    </>
  )
}
