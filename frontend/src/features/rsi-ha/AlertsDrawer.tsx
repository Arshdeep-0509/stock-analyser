import { useState } from 'react'
import { Bell, BellOff, Plus, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { Toggle } from '../../components/ui/Toggle'
import { cn } from '../../lib/cn'
import { formatISTDate, formatISTTime } from '../../lib/formatters'
import { useEscapeToClose } from '../../lib/useEscapeToClose'
import { useAlertStore, type AlertRule } from '../../store/alertStore'
import { useScreenerStore } from '../../app/screenerStore'

export interface AlertsDrawerProps {
  open: boolean
  onClose: () => void
}

function ruleLabel(rule: AlertRule): string {
  switch (rule.type) {
    case 'any-buy':
      return 'Any BUY signal'
    case 'symbol':
      return `${rule.symbol} fires any signal`
    case 'rsi-threshold':
      return `RSI crosses ${rule.direction} ${rule.value}`
  }
}

function groupByDay(notifications: ReturnType<typeof useAlertStore.getState>['notifications']) {
  const groups = new Map<string, typeof notifications>()
  for (const n of notifications) {
    const key = formatISTDate(new Date(n.time * 1000))
    const list = groups.get(key) ?? []
    list.push(n)
    groups.set(key, list)
  }
  return groups
}

export function AlertsDrawer({ open, onClose }: AlertsDrawerProps) {
  const rules = useAlertStore((s) => s.rules)
  const notifications = useAlertStore((s) => s.notifications)
  const soundEnabled = useAlertStore((s) => s.soundEnabled)
  const browserEnabled = useAlertStore((s) => s.browserNotificationsEnabled)

  const [newSymbol, setNewSymbol] = useState('')
  const [rsiDirection, setRsiDirection] = useState<'above' | 'below'>('above')
  const [rsiValue, setRsiValue] = useState(70)
  const [permissionNote, setPermissionNote] = useState<string | null>(null)

  useEscapeToClose(open, onClose)

  if (!open) return null

  const unreadCount = notifications.filter((n) => !n.read).length
  const grouped = groupByDay(notifications)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-surface/70" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col border-l border-border bg-panel sm:w-96" role="dialog" aria-modal="true" aria-label="Alerts">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-panel px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">
            Alerts {unreadCount > 0 && <span className="ml-1 text-xs text-bearish">({unreadCount} unread)</span>}
          </h2>
          <div className="flex items-center gap-1 sm:gap-2">
            {notifications.length > 0 && (
              <>
                <Button size="sm" variant="ghost" onClick={() => useAlertStore.getState().markAllRead()}>
                  Mark all read
                </Button>
                <Button size="sm" variant="ghost" onClick={() => useAlertStore.getState().clearAll()}>
                  Clear
                </Button>
              </>
            )}
            <IconButton aria-label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <div className="border-b border-border-hairline px-4 py-3">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-secondary">Rules</h3>

          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-text-secondary">Any BUY signal</span>
            <Toggle
              checked={rules.some((r) => r.type === 'any-buy' && r.enabled)}
              onChange={(checked) => {
                const existing = rules.find((r) => r.type === 'any-buy')
                if (existing) useAlertStore.getState().toggleRule(existing.id)
                else if (checked) useAlertStore.getState().addRule({ type: 'any-buy', enabled: true })
              }}
            />
          </div>

          <div className="mb-2 flex items-center gap-1.5">
            <Input value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} placeholder="Symbol (e.g. RELIANCE-EQ)" className="flex-1" />
            <Button
              size="sm"
              variant="secondary"
              disabled={!newSymbol.trim()}
              onClick={() => {
                useAlertStore.getState().addRule({ type: 'symbol', symbol: newSymbol.trim(), enabled: true })
                setNewSymbol('')
              }}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="mb-2 flex items-center gap-1.5">
            <Select value={rsiDirection} onChange={(e) => setRsiDirection(e.target.value as 'above' | 'below')}>
              <option value="above">RSI above</option>
              <option value="below">RSI below</option>
            </Select>
            <Input type="number" value={rsiValue} onChange={(e) => setRsiValue(Number(e.target.value))} className="w-16" />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => useAlertStore.getState().addRule({ type: 'rsi-threshold', direction: rsiDirection, value: rsiValue, enabled: true })}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>

          {rules.filter((r) => r.type !== 'any-buy').length > 0 && (
            <ul className="mt-2 space-y-1">
              {rules
                .filter((r) => r.type !== 'any-buy')
                .map((rule) => (
                  <li key={rule.id} className="flex items-center justify-between text-xs">
                    <span className={cn(rule.enabled ? 'text-text-primary' : 'text-text-muted line-through')}>{ruleLabel(rule)}</span>
                    <span className="flex items-center">
                      <IconButton aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'} onClick={() => useAlertStore.getState().toggleRule(rule.id)}>
                        {rule.enabled ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
                      </IconButton>
                      <IconButton
                        aria-label="Remove rule"
                        onClick={() => useAlertStore.getState().removeRule(rule.id)}
                        className="hover:text-bearish"
                      >
                        <Trash2 className="h-3 w-3" />
                      </IconButton>
                    </span>
                  </li>
                ))}
            </ul>
          )}

          <div className="mt-3 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-text-secondary">
              {soundEnabled ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />} Sound
            </span>
            <Toggle checked={soundEnabled} onChange={(v) => useAlertStore.getState().setSoundEnabled(v)} />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-text-secondary">Browser notifications</span>
            <Toggle
              checked={browserEnabled}
              onChange={(checked) => {
                if (!checked) return
                void useAlertStore
                  .getState()
                  .enableBrowserNotifications()
                  .then((permission) => {
                    if (permission === 'denied') setPermissionNote('Browser notifications were denied — you can still see alerts here.')
                    else setPermissionNote(null)
                  })
              }}
            />
          </div>
          {permissionNote && <p className="mt-1 text-[11px] text-text-muted">{permissionNote}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <p className="p-4 text-xs text-text-muted">No alerts yet — they'll show up here as rules match new signals.</p>
          ) : (
            Array.from(grouped.entries()).map(([day, items]) => (
              <div key={day}>
                <div className="sticky top-0 border-b border-border-hairline bg-surface px-4 py-1 text-[11px] font-medium text-text-muted">{day}</div>
                {items.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      useAlertStore.getState().markRead(n.id)
                      useScreenerStore.getState().openRowDetail(n.rowId)
                      onClose()
                    }}
                    className={cn('flex w-full items-start justify-between gap-2 border-b border-border-hairline px-4 py-2 text-left text-xs hover:bg-surface', !n.read && 'bg-neutral/5')}
                  >
                    <span className="flex items-start gap-2">
                      {!n.read && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral" />}
                      <span className={n.read ? 'text-text-secondary' : 'text-text-primary'}>{n.message}</span>
                    </span>
                    <span className="shrink-0 font-mono text-text-muted">{formatISTTime(new Date(n.time * 1000))}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
