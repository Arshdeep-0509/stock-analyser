import * as Comlink from 'comlink'
import type { MarketDataSource } from '../../data/MarketDataSource'
import type { StrategyParams } from '../../strategy/constants'
import type { AtmMap, UniverseEntry } from '../../strategy/universe'
import { runFullScan, type ScanProgressListener, type ScanResult } from './scanner'

export interface ScanWorkerApi {
  runScan(
    universe: readonly UniverseEntry[],
    dataSource: Pick<MarketDataSource, 'fetchHistoricalCandles'>,
    atmMap: AtmMap,
    params: StrategyParams,
    onProgress?: ScanProgressListener,
  ): Promise<ScanResult>
}

/**
 * Runs entirely inside a Web Worker. `dataSource` arrives as a Comlink proxy
 * back to the real MarketDataSource living on the main thread (the mock's
 * live-tick state must stay a single source of truth there) — every
 * fetchHistoricalCandles() call here round-trips to the main thread, but the
 * CPU-bound RSI/HA/signal computation over the whole scan universe happens
 * here, off the UI thread.
 */
const api: ScanWorkerApi = {
  runScan(universe, dataSource, atmMap, params, onProgress) {
    return runFullScan(universe, dataSource, atmMap, params, onProgress)
  },
}

Comlink.expose(api)
