import { cn } from '../lib/cn'
import { useAlertStore } from '../store/alertStore'
import { useUiStore } from '../store/uiStore'
import { railItems } from './railItems'

/**
 * The <sm counterpart to LeftRail's vertical icon rail: a horizontally
 * scrollable chip strip directly under the header, sharing the same
 * destinations — Parameters and Watchlists must never become unreachable
 * just because the icon rail is hidden at this width.
 */
export function MobileNavChips() {
  const openPanel = useUiStore((s) => s.openPanel)
  const togglePanel = useUiStore((s) => s.togglePanel)
  const unreadCount = useAlertStore((s) => s.notifications.filter((n) => !n.read).length)

  return (
    <nav
      aria-label="Sections"
      className="flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-panel px-4 py-2 sm:hidden"
    >
      {railItems.map(({ icon: Icon, label, panel }, index) => {
        const active = (index === 0 && !openPanel) || openPanel === panel
        return (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-pressed={panel !== null && openPanel === panel}
            onClick={() => panel && togglePanel(panel)}
            className={cn(
              'relative flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-3 text-xs font-medium transition-colors',
              active ? 'border-neutral bg-neutral/15 text-neutral' : 'border-border text-text-secondary hover:text-text-primary',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {label}
            {panel === 'alerts' && unreadCount > 0 && (
              <span className="flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-bearish px-0.5 text-[9px] font-medium leading-none text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
