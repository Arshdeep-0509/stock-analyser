import { Star } from 'lucide-react'
import { Tooltip } from './Tooltip'
import { cn } from '../../lib/cn'

/**
 * The small coloured dot beside some symbols in the reference dashboard's
 * Breakout/BreakDown tables (see src/store/starredStore.ts for why this is
 * OUR OWN marker, not a reproduction of an undocumented one). The tooltip
 * is the in-product disclosure — it must stay attached wherever this
 * renders, not just live in a docs file.
 */
export interface StarMarkerProps {
  starred: boolean
  onToggle: () => void
  className?: string
}

export function StarMarker({ starred, onToggle, className }: StarMarkerProps) {
  return (
    <Tooltip label="Your own marker, saved in this browser only. It carries no signal of its own." side="top">
      <button
        type="button"
        aria-label={starred ? 'Remove your marker' : 'Add your marker'}
        aria-pressed={starred}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        className={cn('inline-flex h-4 w-4 items-center justify-center rounded-full text-text-muted hover:text-text-primary', className)}
      >
        <Star className={cn('h-3 w-3', starred && 'fill-warning text-warning')} aria-hidden="true" />
      </button>
    </Tooltip>
  )
}
