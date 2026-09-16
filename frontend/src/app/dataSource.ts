import { MockMarketDataSource } from '../data/mock'

/**
 * The single place the app decides which MarketDataSource implementation is
 * active. To point at a real backend later, this is the one line that
 * changes — swap `new MockMarketDataSource()` for a real implementation of
 * the same interface. Nothing else in the app should construct a data
 * source directly.
 */
export const dataSource = new MockMarketDataSource()
