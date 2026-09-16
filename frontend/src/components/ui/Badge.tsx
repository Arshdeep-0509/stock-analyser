import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

type BadgeVariant = 'bullish' | 'bearish' | 'warning' | 'neutral' | 'default'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  /** Transparent background, colour carried only by the border + text — used for breakout rows so BUY/SELL stay visually distinct from BREAKOUT-UP/DOWN. */
  outline?: boolean
  icon?: ReactNode
}

const variantClasses: Record<BadgeVariant, string> = {
  bullish: 'bg-bullish/15 text-bullish border-bullish/30',
  bearish: 'bg-bearish/15 text-bearish border-bearish/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  neutral: 'bg-neutral/15 text-neutral border-neutral/30',
  default: 'bg-panel text-text-secondary border-border',
}

const outlineVariantClasses: Record<BadgeVariant, string> = {
  bullish: 'bg-transparent text-bullish border-bullish/60',
  bearish: 'bg-transparent text-bearish border-bearish/60',
  warning: 'bg-transparent text-warning border-warning/60',
  neutral: 'bg-transparent text-neutral border-neutral/60',
  default: 'bg-transparent text-text-secondary border-border',
}

export function Badge({ className, variant = 'default', outline = false, icon, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium leading-none',
        outline ? outlineVariantClasses[variant] : variantClasses[variant],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  )
}
