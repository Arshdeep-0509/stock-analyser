import { BarChart3 } from 'lucide-react'
import { EmptyState, Skeleton } from '../../components/ui'

export interface PanelPlaceholderProps {
  loading: boolean
  /** Shown once loaded — every grid panel on this page is chart-shaped but chartless for now; "Charts and tables come in later prompts" (this step is the skeleton). */
  label?: string
}

/**
 * The body every still-empty grid panel renders: a skeleton shape while
 * `loadState === 'loading'`, and a clear, honest "not built yet" empty
 * state once real (non-empty) data exists but no chart has been wired up
 * to show it. Never a fake chart image and never silently blank.
 */
export function PanelPlaceholder({ loading, label = 'Chart coming in a later step' }: PanelPlaceholderProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  return <EmptyState icon={<BarChart3 className="h-5 w-5" />} title={label} description="The data is already computed — only the chart/table for it isn't built yet." />
}
