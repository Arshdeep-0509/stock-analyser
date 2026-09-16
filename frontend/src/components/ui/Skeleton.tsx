import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded bg-border/60', className)} {...props} />
}
