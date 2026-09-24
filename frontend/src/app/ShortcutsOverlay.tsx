import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '../components/ui/IconButton'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import { useUiStore } from '../store/uiStore'

interface ShortcutGroup {
  title: string
  items: readonly [keys: string, description: string][]
}

const GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Table',
    items: [
      ['/', 'Focus symbol search'],
      ['j / k', 'Move selection down / up'],
      ['Enter', 'Open selected row'],
      ['Esc', 'Close drawer / overlay'],
    ],
  },
  {
    title: 'Scanning',
    items: [
      ['p', 'Pause / resume scanning'],
      ['r', 'Rescan now'],
      ['1 – 4', 'Replay speed: 1x / 10x / 60x / 300x'],
    ],
  },
  {
    title: 'Navigate',
    items: [
      ['g then s', 'Go to Screener'],
      ['g then w', 'Go to Watchlists'],
      ['g then h', 'Go to History'],
    ],
  },
  {
    title: 'Intraday',
    items: [
      ['/', 'Focus instrument search'],
      ['s', 'Cycle the sector filter'],
      ['b', 'Toggle breakout-only'],
      ['Esc', 'Close drawer, then clear filters'],
    ],
  },
  {
    title: 'Help',
    items: [['?', 'Show this cheat sheet']],
  },
]

export function ShortcutsOverlay() {
  const open = useUiStore((s) => s.shortcutsOverlayOpen)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) closeButtonRef.current?.focus()
  }, [open])

  useEscapeToClose(open, () => useUiStore.getState().setShortcutsOverlayOpen(false))

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="absolute inset-0 bg-surface/70" onClick={() => useUiStore.getState().setShortcutsOverlayOpen(false)} />
      <div className="relative flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-lg">
        <div className="flex items-center justify-between border-b border-border-hairline px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Keyboard shortcuts</h2>
          <IconButton ref={closeButtonRef} aria-label="Close" onClick={() => useUiStore.getState().setShortcutsOverlayOpen(false)}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="grid gap-4 overflow-y-auto p-4 md:grid-cols-2">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-secondary">{group.title}</h3>
              <dl className="flex flex-col gap-1">
                {group.items.map(([keys, description]) => (
                  <div key={keys} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="text-text-secondary">{description}</dt>
                    <dd className="flex shrink-0 gap-1">
                      {keys.split(' ').map((part, i) => (
                        <kbd
                          key={i}
                          className={
                            part === '/' || part === 'then' || part === '–' || part === '-'
                              ? 'self-center text-text-muted'
                              : 'rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs text-text-primary'
                          }
                        >
                          {part}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
