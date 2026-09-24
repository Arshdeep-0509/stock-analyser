import { lazy, Suspense, type ComponentProps } from 'react'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { CHART_HEIGHT_CLASS } from './chartHeight'
import type { SignalChart as SignalChartComponent } from './SignalChart'

/**
 * The candlestick chart, loaded on first use. lightweight-charts is the
 * single largest dependency and only a detail drawer needs it, so it lives
 * in its own chunk instead of the startup bundle (the Layer 9 bundle budget).
 */
const SignalChart = lazy(() => import('./SignalChart').then((m) => ({ default: m.SignalChart })))

export function ChartSkeleton() {
  return (
    <div className={cn('flex flex-col justify-end gap-1 p-2', CHART_HEIGHT_CLASS)} aria-label="Loading chart" role="status">
      <div className="flex flex-1 items-end gap-1">
        {Array.from({ length: 24 }, (_, i) => (
          <Skeleton key={i} className="w-full" style={{ height: `${20 + ((i * 37) % 60)}%` }} />
        ))}
      </div>
      <Skeleton className="h-4 w-full" />
    </div>
  )
}

export function LazySignalChart(props: ComponentProps<typeof SignalChartComponent>) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <SignalChart {...props} />
    </Suspense>
  )
}
