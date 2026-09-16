import * as Comlink from 'comlink'
import type { MarketDataSource } from '../../data/MarketDataSource'
import type { StrategyParams } from '../../strategy/constants'
import type { AtmMap, UniverseEntry } from '../../strategy/universe'
import type { ScanProgressListener, ScanResult } from './scanner'
import type { ScanWorkerApi } from './scanner.worker'

let workerApi: Comlink.Remote<ScanWorkerApi> | null = null

function getWorkerApi(): Comlink.Remote<ScanWorkerApi> {
  if (!workerApi) {
    const worker = new Worker(new URL('./scanner.worker.ts', import.meta.url), { type: 'module' })
    workerApi = Comlink.wrap<ScanWorkerApi>(worker)
  }
  return workerApi
}

/**
 * Runs a full scan (scan_watchlist + option legs + visibility) inside the
 * scan Web Worker, so a 400-symbol scan never blocks the UI thread.
 * `dataSource` is Comlink.proxy()'d rather than cloned, so every candle
 * fetch the worker makes actually round-trips to this one, real,
 * main-thread MarketDataSource instance — never a second, diverging copy.
 */
export async function runScanInWorker(
  universe: readonly UniverseEntry[],
  dataSource: MarketDataSource,
  atmMap: AtmMap,
  params: StrategyParams,
  onProgress?: ScanProgressListener,
): Promise<ScanResult> {
  const api = getWorkerApi()
  const proxiedDataSource = Comlink.proxy(dataSource)
  const proxiedProgress = onProgress ? Comlink.proxy(onProgress) : undefined
  return api.runScan(universe, proxiedDataSource, atmMap, params, proxiedProgress)
}
