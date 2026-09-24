/**
 * Turns a Strength value into the breakdown a hover/click popover shows —
 * "Strength 2.4 = zMove 1.8 × √rvol 1.3 × persistence-factor 1.0" — so a
 * viewer can see WHY a number is what it is, not just trust it. Reuses
 * computeStrengthBreakdown() (src/analytics/strength.ts) rather than
 * recomputing anything, so the explanation can never drift out of sync with
 * the displayed value.
 */
import { computeStrengthBreakdown, type StrengthBreakdown, type StrengthInputs } from './strength'

export interface StrengthExplanation {
  strength: number
  zMove: number
  sqrtRvol: number
  persistenceFactor: number
  /** "Strength 2.4 = zMove 1.8 × √rvol 1.3 × persistence-factor 1.0", or an explicit "not enough history" message when the inputs guard to NaN. */
  summary: string
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : '—'
}

/** Explains an already-computed breakdown — e.g. one rebuilt from an IntradayRow's own stored terms via breakdownFromTerms(). */
export function explainStrengthBreakdown(breakdown: StrengthBreakdown): StrengthExplanation {
  const summary = Number.isNaN(breakdown.strength)
    ? 'Strength — = not enough session history yet (need at least 5 sessions)'
    : `Strength ${fmt(breakdown.strength)} = zMove ${fmt(breakdown.zMove)} × √rvol ${fmt(breakdown.sqrtRvol)} × persistence-factor ${fmt(breakdown.persistenceFactor)}`

  return { ...breakdown, summary }
}

export function explainStrength(inputs: StrengthInputs): StrengthExplanation {
  return explainStrengthBreakdown(computeStrengthBreakdown(inputs))
}
