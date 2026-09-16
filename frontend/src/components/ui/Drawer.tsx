import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  side?: 'left' | 'right'
}

export function Drawer({ open, onClose, title, children, side = 'right' }: DrawerProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-surface/70" onClick={onClose} />
      <div
        className={cn(
          'relative flex h-full w-80 flex-col border-border bg-panel',
          side === 'right' ? 'ml-auto border-l' : 'border-r',
        )}
      >
        <div className="flex h-topbar items-center justify-between border-b border-border-hairline px-4">
          <h2 className="text-sm font-medium text-text-primary">{title}</h2>
          <button type="button" onClick={onClose} className="text-text-secondary hover:text-text-primary" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
