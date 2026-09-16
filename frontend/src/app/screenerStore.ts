import { createScreenerStore } from '../store/screenerStore'
import { dataSource } from './dataSource'

/**
 * The single screener store instance, wired to the same `dataSource` the
 * rest of the app uses (see dataSource.ts) and to its clock — scan
 * scheduling reads `now()` through here, so the mock's speed multiplier
 * compresses the demo automatically. Nothing else should call
 * createScreenerStore() directly outside of tests.
 */
export const useScreenerStore = createScreenerStore({
  dataSource,
  now: () => dataSource.getNow(),
})
