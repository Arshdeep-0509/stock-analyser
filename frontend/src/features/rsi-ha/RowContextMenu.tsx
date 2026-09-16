import { useEffect, useRef } from 'react'
import { Copy, ExternalLink, FileJson, Pin, PinOff } from 'lucide-react'
import { cn } from '../../lib/cn'

export interface ContextMenuState {
  x: number
  y: number
  rowId: string
}

export interface RowContextMenuProps {
  state: ContextMenuState
  pinned: boolean
  onClose: () => void
  onCopySymbol: () => void
  onCopyJson: () => void
  onTogglePin: () => void
  onOpenChart: () => void
}

const itemClass = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface'

export function RowContextMenu({ state, pinned, onClose, onCopySymbol, onCopyJson, onTogglePin, onOpenChart }: RowContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      className={cn('fixed z-50 w-48 rounded border border-border bg-panel py-1 shadow-lg')}
      style={{ left: state.x, top: state.y }}
    >
      <button type="button" role="menuitem" className={itemClass} onClick={onCopySymbol}>
        <Copy className="h-3.5 w-3.5" /> Copy symbol
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={onCopyJson}>
        <FileJson className="h-3.5 w-3.5" /> Copy row as JSON
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={onTogglePin}>
        {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        {pinned ? 'Unpin' : 'Pin to top'}
      </button>
      <button type="button" role="menuitem" className={itemClass} onClick={onOpenChart}>
        <ExternalLink className="h-3.5 w-3.5" /> Open chart
      </button>
    </div>
  )
}
