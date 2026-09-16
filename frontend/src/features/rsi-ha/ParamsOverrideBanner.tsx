import { RotateCcw } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import type { ScreenerStore } from '../../store/screenerStore'
import { overriddenParamKeys } from '../../strategy/constants'

export interface ParamsOverrideBannerProps {
  store: ScreenerStore
}

/** Persistent banner across the top of the screener whenever any param differs from the reference strategy defaults. */
export function ParamsOverrideBanner({ store }: ParamsOverrideBannerProps) {
  const params = store((s) => s.params)
  const overridden = overriddenParamKeys(params)

  if (overridden.length === 0) return null

  return (
    <div className="flex items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
      <span>
        Running with {overridden.length} modified parameter{overridden.length === 1 ? '' : 's'} — not the reference strategy
      </span>
      <Button size="sm" variant="ghost" onClick={() => void store.getState().resetParams()}>
        <RotateCcw className="h-3 w-3" /> Reset to screener defaults
      </Button>
    </div>
  )
}
