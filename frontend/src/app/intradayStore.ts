import { createIntradayStore } from '../store/intradayStore'
import { useScreenerStore } from './screenerStore'
import { dataSource } from './dataSource'

/**
 * The single intraday store instance, wired to the same `dataSource` (and
 * therefore the same Master Trust endpoints / Primus feed / clock) as
 * useScreenerStore. `getCachedScripRows` checks the screener's already-
 * loaded scrip master first — see ScreenerState.scripRows — so switching
 * from /rsi-ha to /intraday doesn't pay loadScripMaster()'s simulated
 * network latency a second time.
 */
export const useIntradayStore = createIntradayStore({
  dataSource,
  now: () => dataSource.getNow(),
  getCachedScripRows: () => {
    const rows = useScreenerStore.getState().scripRows
    return rows.length > 0 ? rows : undefined
  },
})
