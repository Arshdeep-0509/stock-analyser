import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useEscapeToClose } from '../../lib/useEscapeToClose'

export interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/** The mobile counterpart to a side drawer — slides up from the bottom, same dismiss semantics (backdrop, Escape). */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  useEscapeToClose(open, onClose)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-surface/70" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[80vh] w-full flex-col rounded-t-lg border-t border-border bg-panel pb-[env(safe-area-inset-bottom,0px)]"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden="true" />
        <div className="flex shrink-0 items-center justify-between border-b border-border-hairline px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-text-secondary hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
