import { cn } from '../../lib/cn'

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'replaying'

export interface StatusDotProps {
  status: ConnectionStatus
  className?: string
}

const statusConfig: Record<ConnectionStatus, { label: string; dotClass: string; pulse: boolean }> = {
  connected: { label: 'Connected', dotClass: 'bg-bullish', pulse: false },
  connecting: { label: 'Connecting', dotClass: 'bg-warning', pulse: true },
  disconnected: { label: 'Disconnected', dotClass: 'bg-bearish', pulse: false },
  replaying: { label: 'Replaying', dotClass: 'bg-neutral', pulse: true },
}

export function StatusDot({ status, className }: StatusDotProps) {
  const config = statusConfig[status]

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-text-secondary', className)}>
      <span className="relative flex h-1.5 w-1.5">
        {config.pulse && (
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', config.dotClass)} />
        )}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', config.dotClass)} />
      </span>
      {config.label}
    </span>
  )
}
