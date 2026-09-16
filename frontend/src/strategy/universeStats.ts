import type { ScripRow } from '../types/api'
import type { UniverseMode } from '../store/types'
import type { StrategyParams } from './constants'
import { loadFnoFuturesUniverse, loadNseEquityUniverse } from './universe'

export interface UniverseStats {
  /** Instruments the current mode would include with no ₹ minPrice filter applied at all. */
  eligible: number
  /** Instruments actually in the scan universe — `eligible` minus those below params.minPrice. */
  included: number
}

/**
 * UI-only stat, not a strategy decision: calls loadNseEquityUniverse() /
 * loadFnoFuturesUniverse() twice, once with the real params and once with
 * minPrice forced to 0, and compares the two counts. Reuses those functions
 * completely unchanged rather than re-deriving the eligibility criteria, so
 * this can never drift from what the real universe build actually does.
 */
export function computeUniverseStats(
  scripRows: ScripRow[],
  mode: UniverseMode,
  params: StrategyParams,
  todayEpochSeconds: number,
  watchlistTokens: ReadonlySet<string>,
): UniverseStats {
  const noPriceFilter: StrategyParams = { ...params, minPrice: 0 }

  function sizeFor(p: StrategyParams): number {
    switch (mode) {
      case 'equity':
        return loadNseEquityUniverse(scripRows, p).length
      case 'futures':
        return loadFnoFuturesUniverse(scripRows, p, todayEpochSeconds).length
      case 'both':
        return loadNseEquityUniverse(scripRows, p).length + loadFnoFuturesUniverse(scripRows, p, todayEpochSeconds).length
      case 'watchlist': {
        const combined = [...loadNseEquityUniverse(scripRows, p), ...loadFnoFuturesUniverse(scripRows, p, todayEpochSeconds)]
        return combined.filter((entry) => watchlistTokens.has(entry.token)).length
      }
    }
  }

  return { eligible: sizeFor(noPriceFilter), included: sizeFor(params) }
}
