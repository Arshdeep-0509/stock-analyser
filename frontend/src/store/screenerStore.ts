import { enableMapSet } from 'immer'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ConnectionState, MarketDataSource } from '../data/MarketDataSource'
import type { ScannedRow } from '../features/rsi-ha/scanner'
import { scanWatchlist } from '../features/rsi-ha/scanner'
import { runScanInWorker } from '../features/rsi-ha/scannerClient'
import { DEFAULT_PARAMS, parseIntervalMinutes, type StrategyParams } from '../strategy/constants'
import { selectVisibleRows } from '../strategy/signals'
import { loadFnoAtmOptions, loadFnoFuturesUniverse, loadNseEquityUniverse, type AtmMap, type UniverseEntry } from '../strategy/universe'
import { computeUniverseStats, type UniverseStats } from '../strategy/universeStats'
import { expiryFilterToday } from '../lib/marketSession'
import { loadVersioned, removeVersioned, saveVersioned } from '../lib/persistence'
import type { ScripRow } from '../types/api'
import type { Candle, Exchange, MarketTick } from '../types/domain'
import { useAlertStore } from './alertStore'
import { mergeScanRows } from './mergeScanRows'
import { usePauseStore } from './pauseStore'
import type { ScanError, ScanProgress, ScanState, ScreenerRow, UniverseMode } from './types'

enableMapSet()

const DEFAULT_POLL_INTERVAL_MS = 250

const PARAMS_STORAGE_KEY = 'rsi-ha:params-override'
const PARAMS_STORAGE_VERSION = 1

function loadStoredParams(): StrategyParams {
  const stored = loadVersioned<StrategyParams>(PARAMS_STORAGE_KEY, PARAMS_STORAGE_VERSION, () => null)
  return stored ?? DEFAULT_PARAMS
}

export interface ParamsDiff {
  added: string[]
  removed: string[]
}

export interface ScreenerStoreDeps {
  dataSource: MarketDataSource
  /** Epoch seconds. Scheduling/fade-timing all read through this — never Date.now() directly. */
  now: () => number
  /** Injectable so tests can bypass the real Web Worker. Defaults to runScanInWorker. */
  runScan?: typeof runScanInWorker
  /** Real-ms poll interval for scan scheduling / connection-state checks. Defaults to 250ms. */
  pollIntervalMs?: number
}

export interface ScreenerState {
  /** The raw scrip master rows fetched by loadUniverse(), cached here so src/store/intradayStore.ts can reuse them (via a cross-store check, see IntradayStoreDeps.getCachedScripRows) instead of paying loadScripMaster()'s simulated network latency a second time when the user switches tabs. Empty until the first loadUniverse() completes. */
  scripRows: ScripRow[]
  universe: UniverseEntry[]
  /** How many instruments the current mode/watchlist would include before vs. after the ₹ minPrice filter — for the "Scanning X of Y" display. */
  universeStats: UniverseStats
  universeMode: UniverseMode
  watchlistTokens: Set<string>
  params: StrategyParams
  rows: ScreenerRow[]
  /** Derived from `rows` + `showNseEquityRows` — recomputed by every action that touches `rows`, never by components. */
  visibleRows: ScreenerRow[]
  showNseEquityRows: boolean
  candleCache: Map<string, Candle[]>
  /** Live LTP per token from WS ticks — never used to recompute a signal, only to render a live price column. */
  liveLtp: Map<string, number>
  scanState: ScanState
  scanProgress: ScanProgress
  lastScanDurationMs: number | null
  /** True only while a parameter-change-triggered rescan is in flight — distinct from the normal scheduled-scan cadence. */
  paramsRecalculating: boolean
  /** Set once a parameter-change rescan completes; cleared by the next scan of any kind. */
  paramsDiff: ParamsDiff | null
  errors: ScanError[]
  lastScanAt: number | null
  nextScanAt: number | null
  history: ScreenerRow[]
  /**
   * Ids of rows that are genuinely NEW since the previous scheduled scan —
   * the one source of "this is news" for alerts, the new-row accent, the
   * chime and the aria-live announcement. Always empty after the FIRST scan
   * (that's the starting state, not news) and after an immediateReplace
   * rescan (a parameter what-if or a replay seek replaces every row, and
   * none of that is news either).
   */
  freshIds: string[]
  /**
   * The store's injected clock (epoch seconds) — the SIMULATED market time the
   * scans run on. Anything that counts down to nextScanAt must read this, never
   * Date.now(): the two only agree while the mock clock runs live at 1x.
   */
  clockNow: () => number
  selectedRowId: string | null
  /**
   * Set by anything outside SignalsTable (the alerts inbox, history view)
   * that wants to OPEN a row's detail drawer, not just highlight it — the
   * nonce guarantees the request is noticed even if it targets the same
   * row twice in a row. Distinct from `selectedRowId`, which j/k keyboard
   * nav also touches without opening anything.
   */
  detailOpenRequest: { rowId: string; nonce: number } | null
  /** Mirrors src/store/pauseStore.ts's usePauseStore — kept in this store's own state too so existing `store((s) => s.isPaused)` selectors keep working, but usePauseStore is the source of truth (see start()'s subscription). */
  isPaused: boolean
  connectionState: ConnectionState

  start: () => void
  stop: () => void
  loadUniverse: () => Promise<void>
  /**
   * `immediateReplace: true` (used by setParams()) replaces `rows` outright
   * instead of going through the fade-over-two-cycles merge: a deliberate
   * "what would this parameter set show" exploration should feel snappy,
   * not leave ghost rows lingering the way natural scan-to-scan turnover
   * does. Doesn't touch `history` either — a what-if replacement isn't a
   * real signal event worth logging.
   */
  runScanNow: (options?: { immediateReplace?: boolean }) => Promise<void>
  setUniverseMode: (mode: UniverseMode) => void
  /** Applies new params, persists them, and immediately re-loads the universe + rescans, computing a before/after signal diff. */
  setParams: (params: StrategyParams) => Promise<void>
  /** Restores DEFAULT_PARAMS exactly (byte-identical to the pre-edit state) and clears the persisted override. */
  resetParams: () => Promise<void>
  selectRow: (id: string | null) => void
  /** Requests that a row's detail drawer be opened — used by the alerts inbox and history view, which aren't inside SignalsTable. */
  openRowDetail: (rowId: string) => void
  togglePause: () => void
  setShowNseEquityRows: (show: boolean) => void
  /** Set by the watchlist wiring whenever the active watchlist changes — the universe for universeMode 'watchlist' is filtered to these tokens. */
  setWatchlistTokens: (tokens: Iterable<string>) => void
  togglePin: (id: string) => void
  /** Fetches (and caches in candleCache) the full closed-candle history for one instrument — the same fetchHistoricalCandles() the scanner itself calls. */
  fetchCandlesForToken: (token: string, exchange: Exchange) => Promise<Candle[]>
}

export type ScreenerStore = UseBoundStore<StoreApi<ScreenerState>>

function computeVisibleRows(rows: ScreenerRow[], showNseEquityRows: boolean): ScreenerRow[] {
  return showNseEquityRows ? rows : (selectVisibleRows(rows) as ScreenerRow[])
}

async function buildUniverse(
  dataSource: MarketDataSource,
  mode: UniverseMode,
  params: StrategyParams,
  now: number,
  watchlistTokens: ReadonlySet<string>,
): Promise<{ universe: UniverseEntry[]; atmMap: AtmMap; stats: UniverseStats; scripRows: ScripRow[] }> {
  const scripRows = await dataSource.loadScripMaster()
  // PARITY: the loaders compare expiries against TODAY (Timestamp.now().normalize()), not the raw clock — see expiryFilterToday().
  const today = expiryFilterToday(now)
  const atmMap = loadFnoAtmOptions(scripRows, params, today)

  const equity = loadNseEquityUniverse(scripRows, params)
  const futures = loadFnoFuturesUniverse(scripRows, params, today)

  let universe: UniverseEntry[]
  switch (mode) {
    case 'equity':
      universe = equity
      break
    case 'futures':
      universe = futures
      break
    case 'both':
      universe = [...equity, ...futures]
      break
    case 'watchlist':
      universe = [...equity, ...futures].filter((entry) => watchlistTokens.has(entry.token))
      break
  }

  const stats = computeUniverseStats(scripRows, mode, params, today, watchlistTokens)
  return { universe, atmMap, stats, scripRows }
}

/**
 * Factory rather than a bare `create(...)` singleton, so tests can inject a
 * fake data source / clock / scan runner instead of reaching for a real
 * Web Worker and the real mock's live latency simulation.
 */
export function createScreenerStore(deps: ScreenerStoreDeps): ScreenerStore {
  const runScan = deps.runScan ?? runScanInWorker
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  let atmMap: AtmMap = {}
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let unsubscribeTicks: (() => void) | null = null
  let unsubscribePause: (() => void) | null = null
  const lastBarStartByToken = new Map<string, number>()

  const store = create<ScreenerState>()(
    immer((set, get) => ({
      scripRows: [],
      universe: [],
      universeStats: { eligible: 0, included: 0 },
      universeMode: 'both',
      watchlistTokens: new Set<string>(),
      params: loadStoredParams(),
      rows: [],
      visibleRows: [],
      showNseEquityRows: false,
      candleCache: new Map<string, Candle[]>(),
      liveLtp: new Map<string, number>(),
      scanState: 'idle',
      scanProgress: { done: 0, total: 0 },
      lastScanDurationMs: null,
      paramsRecalculating: false,
      paramsDiff: null,
      errors: [],
      lastScanAt: null,
      nextScanAt: null,
      history: [],
      freshIds: [],
      clockNow: () => deps.now(),
      selectedRowId: null,
      detailOpenRequest: null,
      isPaused: usePauseStore.getState().isPaused,
      connectionState: deps.dataSource.getConnectionState(),

      start() {
        if (pollTimer) return
        pollTimer = setInterval(() => pollTick(), pollIntervalMs)
        unsubscribePause = usePauseStore.subscribe((s) => {
          store.setState((draft) => {
            draft.isPaused = s.isPaused
          })
        })
        void get().loadUniverse().then(() => get().runScanNow())
      },

      stop() {
        if (pollTimer) clearInterval(pollTimer)
        pollTimer = null
        unsubscribeTicks?.()
        unsubscribeTicks = null
        unsubscribePause?.()
        unsubscribePause = null
      },

      async loadUniverse() {
        set((draft) => {
          draft.scanState = 'loading-universe'
        })

        const {
          universe,
          atmMap: freshAtmMap,
          stats,
          scripRows,
        } = await buildUniverse(deps.dataSource, get().universeMode, get().params, deps.now(), get().watchlistTokens)
        atmMap = freshAtmMap

        set((draft) => {
          draft.scripRows = scripRows
          draft.universe = universe
          draft.universeStats = stats
          draft.scanState = 'idle'
        })

        subscribeToUniverseTicks()
      },

      async runScanNow(options) {
        const state = get()
        if (state.scanState === 'scanning' || state.scanState === 'loading-universe') return

        set((draft) => {
          draft.scanState = 'scanning'
          draft.scanProgress = { done: 0, total: state.universe.length }
          // Cleared unconditionally; setParams() re-sets it with the real
          // diff right after this call resolves, so it only survives for a
          // params-triggered rescan, not a normal scheduled one.
          draft.paramsDiff = null
        })

        const startedAt = Date.now()

        try {
          const result = await runScan(state.universe, deps.dataSource, atmMap, state.params, (done, total) => {
            set((draft) => {
              draft.scanProgress = { done, total }
            })
          })

          if (options?.immediateReplace) {
            applyImmediateScanOutcome(result.rows, result.errors)
          } else {
            // A full scan is authoritative over every symbol it COULD have
            // produced a row for — not just the current universe. Without
            // also including existing rows' symbols and this scan's fresh
            // output, a symbol that drops out of the universe (e.g. a
            // minPrice change) or an option whose underlying stops firing
            // would never be recognised as "no longer present", and its
            // stale row would sit there forever instead of fading out.
            const scannedSymbols = new Set([
              ...state.universe.map((e) => e.symbol),
              ...state.rows.map((r) => r.symbol),
              ...result.rows.map((r) => r.symbol),
            ])
            applyScanOutcome(result.rows, scannedSymbols, result.errors)
          }

          const nowSec = deps.now()
          set((draft) => {
            draft.scanState = 'done'
            draft.lastScanAt = nowSec
            draft.nextScanAt = nowSec + draft.params.scanEverySeconds
            draft.lastScanDurationMs = Date.now() - startedAt
            // A full scan just re-fetched every symbol's latest closed bar —
            // any cached candle history is now stale.
            draft.candleCache.clear()
          })
        } catch (err) {
          set((draft) => {
            draft.scanState = 'error'
            draft.errors = [...draft.errors, { symbol: '*', message: err instanceof Error ? err.message : String(err) }]
          })
        }
      },

      setUniverseMode(mode) {
        set((draft) => {
          draft.universeMode = mode
        })
        void get().loadUniverse()
      },

      async setParams(newParams) {
        const dedupeKey = (r: Pick<ScreenerRow, 'symbol' | 'signal'>) => `${r.symbol}:${r.signal}`
        const before = new Set(get().visibleRows.map(dedupeKey))

        set((draft) => {
          draft.params = newParams
          draft.paramsRecalculating = true
          draft.paramsDiff = null
        })
        saveVersioned(PARAMS_STORAGE_KEY, PARAMS_STORAGE_VERSION, newParams)

        // minPrice affects which instruments are even IN the universe, so a
        // full reload (not just a rescan) is required for correctness —
        // harmless for params that don't affect universe composition too.
        await get().loadUniverse()
        await get().runScanNow({ immediateReplace: true })

        const after = new Set(get().visibleRows.map(dedupeKey))
        const added = Array.from(after).filter((key) => !before.has(key))
        const removed = Array.from(before).filter((key) => !after.has(key))

        set((draft) => {
          draft.paramsRecalculating = false
          draft.paramsDiff = { added, removed }
        })
      },

      async resetParams() {
        removeVersioned(PARAMS_STORAGE_KEY)
        await get().setParams(DEFAULT_PARAMS)
      },

      selectRow(id) {
        set((draft) => {
          draft.selectedRowId = id
        })
      },

      openRowDetail(rowId) {
        set((draft) => {
          draft.selectedRowId = rowId
          draft.detailOpenRequest = { rowId, nonce: (draft.detailOpenRequest?.nonce ?? 0) + 1 }
        })
      },

      togglePause() {
        usePauseStore.getState().togglePause()
        // Also set directly (not just via the start()-time subscription) so
        // this works even if called before start() has wired the mirror.
        set((draft) => {
          draft.isPaused = usePauseStore.getState().isPaused
        })
      },

      setShowNseEquityRows(show) {
        set((draft) => {
          draft.showNseEquityRows = show
          draft.visibleRows = computeVisibleRows(draft.rows, show)
        })
      },

      setWatchlistTokens(tokens) {
        set((draft) => {
          draft.watchlistTokens = new Set(tokens)
        })
        if (get().universeMode === 'watchlist') void get().loadUniverse()
      },

      togglePin(id) {
        set((draft) => {
          const row = draft.rows.find((r) => r.id === id)
          if (row) row.pinned = !row.pinned
          draft.visibleRows = computeVisibleRows(draft.rows, draft.showNseEquityRows)
        })
      },

      async fetchCandlesForToken(token, exchange) {
        const cached = get().candleCache.get(token)
        if (cached) return cached

        // Always the mock's native 5-minute base series — see scanner.ts's
        // and MockMarketDataSource's comments. Callers that want a coarser
        // interval resample it themselves via src/strategy/resampleCandles.
        const candles = await deps.dataSource.fetchHistoricalCandles(token, exchange, '5minute', 5)
        set((draft) => {
          draft.candleCache.set(token, candles)
        })
        return candles
      },
    })),
  )

  /** Applies a scan's rows through the dedupe/fade merge and updates rows/visibleRows/history/errors together. */
  function applyScanOutcome(newRows: ScannedRow[], scannedSymbols: Set<string>, newErrors: ScanError[]): void {
    const nowSec = deps.now()
    const current = store.getState()
    const { rows, expired, created } = mergeScanRows(current.rows, newRows, scannedSymbols, nowSec)
    // On the very first scan every row is "created" — but that is the
    // starting state the user opens the app to, not news. Only rows that
    // appear on a LATER scheduled scan are fresh.
    const isFirstScan = current.lastScanAt === null
    const fresh = isFirstScan ? [] : created

    store.setState((draft) => {
      draft.rows = rows
      draft.visibleRows = computeVisibleRows(rows, draft.showNseEquityRows)
      draft.history = [...draft.history, ...created, ...expired]
      draft.errors = [...draft.errors.filter((e) => !scannedSymbols.has(e.symbol)), ...newErrors]
      draft.freshIds = fresh.map((r) => r.id)
    })

    // Alerts only fire for genuinely new signals from a real scan — never
    // for the first scan's starting state, and never for a params what-if
    // or replay seek (applyImmediateScanOutcome, below, never calls this).
    for (const row of fresh) {
      useAlertStore.getState().evaluateRow(row)
    }
  }

  /** Used only by a params-change rescan (see ScreenerState.runScanNow) — replaces `rows` outright rather than fading/dedupe-merging, and never touches `history`. */
  function applyImmediateScanOutcome(newRows: ScannedRow[], newErrors: ScanError[]): void {
    const nowSec = deps.now()
    const current = store.getState()
    const pinnedKeys = new Set(current.rows.filter((r) => r.pinned).map((r) => `${r.symbol}:${r.signal}`))

    const rows: ScreenerRow[] = newRows.map((row) => ({
      ...row,
      status: 'active',
      firstSeenAt: nowSec,
      lastSeenAt: nowSec,
      pinned: pinnedKeys.has(`${row.symbol}:${row.signal}`),
    }))

    store.setState((draft) => {
      draft.rows = rows
      draft.visibleRows = computeVisibleRows(rows, draft.showNseEquityRows)
      draft.errors = newErrors
      // A what-if / replay seek replaces every row; none of it is news.
      draft.freshIds = []
    })
  }

  /**
   * PARITY-adjacent correctness rule (this is our own orchestration, not
   * ported strategy logic, but the same discipline applies): a WS tick only
   * ever updates the live LTP column. The Python only evaluates signals on
   * a CLOSED candle — never on an in-progress tick — so we only re-run
   * checkSignal/checkBreakout for a token when its bar has just closed
   * (detected by the bar-start bucket advancing between two ticks), and
   * only for that one symbol.
   */
  function subscribeToUniverseTicks(): void {
    unsubscribeTicks?.()
    lastBarStartByToken.clear()

    const universe = store.getState().universe
    const tokens = universe.map((entry) => entry.token)
    const intervalSeconds = parseIntervalMinutes(store.getState().params.candleInterval) * 60

    unsubscribeTicks = deps.dataSource.subscribeTicks(tokens, (tick: MarketTick) => {
      store.setState((draft) => {
        draft.liveLtp.set(tick.token, tick.ltp)
      })

      const barStart = Math.floor(tick.time / intervalSeconds) * intervalSeconds
      const previousBarStart = lastBarStartByToken.get(tick.token)
      lastBarStartByToken.set(tick.token, barStart)

      const barJustClosed = previousBarStart !== undefined && barStart > previousBarStart
      if (!barJustClosed || store.getState().isPaused) return

      const entry = store.getState().universe.find((u) => u.token === tick.token)
      if (entry) void rescanSymbol(entry)
    })
  }

  /** Re-evaluates a single symbol whose bar just closed, on the main thread (cheap enough not to need the worker). */
  async function rescanSymbol(entry: UniverseEntry): Promise<void> {
    const { rows: newRows, errors: newErrors } = await scanWatchlist([entry], deps.dataSource, store.getState().params)
    applyScanOutcome(newRows, new Set([entry.symbol]), newErrors)
    // A new bar closed, so any cached candle history for this token is now
    // one bar stale — drop it so the next fetchCandlesForToken() re-fetches.
    store.setState((draft) => {
      draft.candleCache.delete(entry.token)
    })
  }

  function pollTick(): void {
    const state = store.getState()

    const connectionState = deps.dataSource.getConnectionState()
    if (connectionState !== state.connectionState) {
      store.setState((draft) => {
        draft.connectionState = connectionState
      })
    }

    const nowSec = deps.now()
    const dueForScan =
      !state.isPaused &&
      state.nextScanAt !== null &&
      nowSec >= state.nextScanAt &&
      state.scanState !== 'scanning' &&
      state.scanState !== 'loading-universe'

    if (dueForScan) {
      void store.getState().runScanNow()
    }
  }

  return store
}
