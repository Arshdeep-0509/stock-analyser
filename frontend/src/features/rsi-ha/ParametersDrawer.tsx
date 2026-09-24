import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { Input } from '../../components/ui/Input'
import { RangeSlider } from '../../components/ui/RangeSlider'
import { Select } from '../../components/ui/Select'
import { cn } from '../../lib/cn'
import { useEscapeToClose } from '../../lib/useEscapeToClose'
import type { ScreenerStore } from '../../store/screenerStore'
import { overriddenParamKeys, parseIntervalMinutes, type StrategyParams } from '../../strategy/constants'

export interface ParametersDrawerProps {
  open: boolean
  onClose: () => void
  store: ScreenerStore
}

const DEBOUNCE_MS = 400
const INTERVAL_OPTIONS = [1, 3, 5, 15, 30, 60] as const

/**
 * A labelled setting. Single-control fields render a real <label> around the
 * control, so the input/select gets its accessible name from the visible text
 * (axe: label / select-name). The two-handle band sliders pass `group`: their
 * inputs carry their own aria-labels, and one <label> can't name two controls.
 */
function Field({ label, overridden, group = false, children }: { label: string; overridden: boolean; group?: boolean; children: ReactNode }) {
  const Wrapper = group ? 'div' : 'label'
  return (
    <Wrapper className="block py-2.5">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
        {label}
        {overridden && <span className="h-1.5 w-1.5 rounded-full bg-warning" title="Differs from the reference strategy default" />}
      </span>
      {children}
    </Wrapper>
  )
}

export function ParametersDrawer({ open, onClose, store }: ParametersDrawerProps) {
  const activeParams = store((s) => s.params)
  const recalculating = store((s) => s.paramsRecalculating)
  const diff = store((s) => s.paramsDiff)

  const [draft, setDraft] = useState<StrategyParams>(activeParams)

  // Resync the local draft whenever the store's active params change from
  // OUTSIDE this drawer (e.g. a reset triggered elsewhere) — but not on
  // every keystroke, which would fight the debounce below.
  useEffect(() => {
    setDraft(activeParams)
  }, [activeParams])

  useEffect(() => {
    if (draft === activeParams) return
    const id = window.setTimeout(() => {
      void store.getState().setParams(draft)
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  useEscapeToClose(open, onClose)

  if (!open) return null

  const overridden = new Set(overriddenParamKeys(draft))

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-surface/70" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col border-l border-border bg-panel sm:w-96" role="dialog" aria-modal="true" aria-label="Parameters">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-panel px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Parameters</h2>
          <div className="flex items-center gap-2">
            {overridden.size > 0 && (
              <Button size="sm" variant="ghost" onClick={() => void store.getState().resetParams()}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
              </Button>
            )}
            <IconButton aria-label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {recalculating && <p className="py-2 text-xs text-neutral">Recalculating…</p>}

          {diff && (
            <div className="mb-2 rounded border border-border bg-surface p-2 text-xs">
              <p className="font-medium text-text-primary">
                {diff.added.length > 0 && <span className="text-bullish">+{diff.added.length} signals</span>}
                {diff.added.length > 0 && diff.removed.length > 0 && ' · '}
                {diff.removed.length > 0 && <span className="text-bearish">-{diff.removed.length} signal{diff.removed.length === 1 ? '' : 's'}</span>}
                {diff.added.length === 0 && diff.removed.length === 0 && <span className="text-text-secondary">No change</span>}
                {' vs previous parameters'}
              </p>
              {diff.added.length > 0 && <p className="mt-1 text-text-secondary">Added: {diff.added.map((k) => k.split(':')[0]).join(', ')}</p>}
              {diff.removed.length > 0 && <p className="mt-1 text-text-secondary">Removed: {diff.removed.map((k) => k.split(':')[0]).join(', ')}</p>}
            </div>
          )}

          <Field label="RSI period" overridden={overridden.has('rsiPeriod')}>
            <Input
              type="number"
              min={2}
              max={50}
              value={draft.rsiPeriod}
              onChange={(e) => setDraft({ ...draft, rsiPeriod: clamp(Number(e.target.value), 2, 50) })}
              className="w-full"
            />
          </Field>

          <Field group label={`BUY band ${draft.rsiBuyLow}–${draft.rsiBuyHigh}`} overridden={overridden.has('rsiBuyLow') || overridden.has('rsiBuyHigh')}>
            <RangeSlider
              min={0}
              max={100}
              label="BUY band RSI"
              valueMin={draft.rsiBuyLow}
              valueMax={draft.rsiBuyHigh}
              onChange={(rsiBuyLow, rsiBuyHigh) => setDraft({ ...draft, rsiBuyLow, rsiBuyHigh })}
            />
          </Field>

          <Field group label={`SELL band ${draft.rsiSellLow}–${draft.rsiSellHigh}`} overridden={overridden.has('rsiSellLow') || overridden.has('rsiSellHigh')}>
            <RangeSlider
              min={0}
              max={100}
              label="SELL band RSI"
              valueMin={draft.rsiSellLow}
              valueMax={draft.rsiSellHigh}
              onChange={(rsiSellLow, rsiSellHigh) => setDraft({ ...draft, rsiSellLow, rsiSellHigh })}
            />
          </Field>

          <Field label="Minimum price (₹)" overridden={overridden.has('minPrice')}>
            <Input
              type="number"
              min={0}
              value={draft.minPrice}
              onChange={(e) => setDraft({ ...draft, minPrice: Math.max(0, Number(e.target.value)) })}
              className="w-full"
            />
          </Field>

          <Field label="Breakout lookback (bars)" overridden={overridden.has('breakoutLookback')}>
            <Input
              type="number"
              min={5}
              max={100}
              value={draft.breakoutLookback}
              onChange={(e) => setDraft({ ...draft, breakoutLookback: clamp(Number(e.target.value), 5, 100) })}
              className="w-full"
            />
          </Field>

          <Field label="Candle interval" overridden={overridden.has('candleInterval')}>
            <Select
              value={parseIntervalMinutes(draft.candleInterval)}
              onChange={(e) => setDraft({ ...draft, candleInterval: `${e.target.value}minute` })}
              className="w-full"
            >
              {INTERVAL_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes} disabled={minutes < 5}>
                  {minutes} min{minutes < 5 ? ' (unavailable — mock base data is 5-minute)' : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Scan interval (seconds)" overridden={overridden.has('scanEverySeconds')}>
            <Input
              type="number"
              min={30}
              step={30}
              value={draft.scanEverySeconds}
              onChange={(e) => setDraft({ ...draft, scanEverySeconds: Math.max(30, Number(e.target.value)) })}
              className="w-full"
            />
          </Field>
        </div>

        <p className={cn('border-t border-border px-4 py-2 text-[11px]', overridden.size > 0 ? 'text-warning' : 'text-text-muted')}>
          {overridden.size > 0
            ? `Running with ${overridden.size} modified parameter${overridden.size === 1 ? '' : 's'} — not the reference strategy`
            : 'Matches the reference strategy defaults'}
        </p>
      </div>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}
