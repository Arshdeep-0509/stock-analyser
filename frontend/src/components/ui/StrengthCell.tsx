import { strengthTone, type StrengthTone } from '../../analytics/strength'
import { cn } from '../../lib/cn'
import { MetricInfo } from './MetricInfo'

// ---------------------------------------------------------------------------
// StrengthInfo — the in-product honesty disclosure (non-negotiable, see
// docs/STRENGTH.md). Every "Strength" column header must render this beside
// its label. A thin wrapper over MetricInfo, whose text (formula, definition,
// limits) lives in analytics/metricDocs.ts.
// ---------------------------------------------------------------------------

export function StrengthInfo({ className }: { className?: string }) {
  return <MetricInfo metric="strength" className={className} />
}

// ---------------------------------------------------------------------------
// StrengthCell — the value + colour-coded dot, driven entirely by
// strengthTone() (the one place the colour thresholds live).
// ---------------------------------------------------------------------------

const TONE_DOT_CLASS: Record<StrengthTone, string> = {
  high: 'bg-bullish',
  medium: 'bg-warning',
  low: 'bg-warning/50',
  none: 'bg-text-muted/30',
}

export interface StrengthCellProps {
  value: number
}

export function StrengthCell({ value }: StrengthCellProps) {
  const tone = strengthTone(value)
  const finite = Number.isFinite(value)
  const display = finite ? value.toFixed(1) : '—'

  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono tabular-nums text-text-primary"
      aria-label={finite ? `Strength ${display}` : 'Strength not available — not enough session history yet'}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT_CLASS[tone])} aria-hidden="true" />
      {finite ? display : <span className="text-text-muted">—</span>}
    </span>
  )
}
