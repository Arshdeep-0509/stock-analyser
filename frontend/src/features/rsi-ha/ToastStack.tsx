import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { useAlertStore, type AlertNotification } from '../../store/alertStore'
import { useScreenerStore } from '../../app/screenerStore'
import { playChime } from './chime'

const TOAST_DURATION_MS = 6000

export function ToastStack() {
  const notifications = useAlertStore((s) => s.notifications)
  const soundEnabled = useAlertStore((s) => s.soundEnabled)
  const [visible, setVisible] = useState<AlertNotification[]>([])
  const seenIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const fresh = notifications.filter((n) => !seenIds.current.has(n.id))
    if (fresh.length === 0) return

    for (const n of fresh) seenIds.current.add(n.id)
    setVisible((prev) => [...fresh, ...prev].slice(0, 5))
    if (soundEnabled) playChime()

    const timers = fresh.map((n) => window.setTimeout(() => setVisible((prev) => prev.filter((v) => v.id !== n.id)), TOAST_DURATION_MS))
    return () => timers.forEach((t) => window.clearTimeout(t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications])

  if (visible.length === 0) return null

  return (
    <div className="fixed right-4 top-16 z-50 flex flex-col gap-2">
      {visible.map((n) => (
        <div
          key={n.id}
          role="alert"
          className={cn(
            'flex w-72 cursor-pointer items-start gap-2 rounded border border-border bg-panel px-3 py-2 text-xs text-text-primary shadow-lg',
          )}
          onClick={() => {
            useAlertStore.getState().markRead(n.id)
            useScreenerStore.getState().openRowDetail(n.rowId)
            setVisible((prev) => prev.filter((v) => v.id !== n.id))
          }}
        >
          <span className="flex-1">{n.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation()
              setVisible((prev) => prev.filter((v) => v.id !== n.id))
            }}
            className="text-text-muted hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
