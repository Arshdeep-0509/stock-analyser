import { useSyncExternalStore } from 'react'
import { Keyboard, Moon, Sun, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Toggle } from '../../components/ui/Toggle'
import { useEscapeToClose } from '../../lib/useEscapeToClose'
import type { MockMarketDataSource } from '../../data/mock'
import { useUiStore } from '../../store/uiStore'

export interface SettingsDrawerProps {
  open: boolean
  onClose: () => void
  dataSource: MockMarketDataSource
}

export function SettingsDrawer({ open, onClose, dataSource }: SettingsDrawerProps) {
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)

  const devState = useSyncExternalStore(
    (onStoreChange) => dataSource.subscribeDevState(onStoreChange),
    () => dataSource.getDevState(),
  )

  useEscapeToClose(open, onClose)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="absolute inset-0 bg-surface/70" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col border-l border-border bg-panel desktop:w-96">
        <div className="flex h-topbar shrink-0 items-center justify-between border-b border-border-hairline px-4">
          <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-text-secondary hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <section className="border-b border-border-hairline py-3">
            <h3 className="mb-2 text-xs font-medium text-text-secondary">Appearance</h3>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm text-text-primary">
                {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                {theme === 'dark' ? 'Dark theme' : 'Light theme'}
              </span>
              <Toggle checked={theme === 'light'} onChange={toggleTheme} aria-label="Toggle light theme" />
            </div>
          </section>

          <section className="border-b border-border-hairline py-3">
            <h3 className="mb-2 text-xs font-medium text-text-secondary">Keyboard</h3>
            <Button size="sm" variant="secondary" onClick={() => useUiStore.getState().setShortcutsOverlayOpen(true)}>
              <Keyboard className="h-3.5 w-3.5" /> Show shortcuts (?)
            </Button>
          </section>

          <section className="py-3">
            <h3 className="mb-2 text-xs font-medium text-text-secondary">Simulated market</h3>
            <dl className="grid grid-cols-2 gap-y-1.5 text-xs">
              <dt className="text-text-secondary">Seed</dt>
              <dd className="font-mono tabular-nums text-text-primary">{devState.seed}</dd>
              <dt className="text-text-secondary">Universe</dt>
              <dd className="font-mono tabular-nums text-text-primary">{devState.universeSize} symbols</dd>
            </dl>
            <p className="mt-2 text-[11px] text-text-muted">
              This seed fully determines the generated candles and every signal derived from them — share it to reproduce this exact demo.
            </p>
          </section>

          <p className="border-t border-border-hairline pt-3 text-[11px] text-text-muted">
            PROTOTYPE — all data on this screen is generated locally by a deterministic mock. No broker connection, no real market data, not
            investment advice.
          </p>
        </div>
      </div>
    </div>
  )
}
