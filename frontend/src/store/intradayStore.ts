import { enableMapSet } from 'immer'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { IndexQuote, MarketDataSource } from '../data/MarketDataSource'
import { INDEX_PANELS } from '../data/reference/indices'
import { mapWithConcurrency } from '../lib/concurrent'
import { expiryFilterToday } from '../lib/marketSession'
import {
  breakoutCountsBySector,
  headerCounts,
  indexMeter,
  intradayIndex,
  marketMeter,
  sectorStrength,
  smartMoney,
  SMART_MONEY_DEFAULT_MIN_RVOL,
  SMART_MONEY_DEFAULT_MIN_ZMOVE,
  type BreakoutCountEntry,
  type HeaderCounts,
  type IndexMeterEntry,
  type IntradayIndexEntry,
  type MarketMeterResult,
  type SectorStrengthEntry,
  type SmartMoneyEntry,
} from '../analytics/aggregate'
import { enrichInstrument } from '../analytics/enrich'
import { computeIntradayRow, marketAsOf } from '../analytics/intraday'
import { deriveStrengthInputs } from '../analytics/strength'
import { DEFAULT_PARAMS, parseIntervalMinutes } from '../strategy/constants'
import { loadFnoFuturesUniverse } from '../strategy/universe'
import type { ScripRow } from '../types/api'
import type { Candle, Exchange, IndexKey, Instrument, IntradayRow, MarketTick } from '../types/domain'
import { usePauseStore } from './pauseStore'
import { useStarredStore } from './starredStore'
import type { ScanError } from './types'

enableMapSet()

const DEFAULT_POLL_INTERVAL_MS = 250
const METER_THROTTLE_MS = 1000
/** Partial-result commits during the FIRST load — faster than the meter cadence so the page fills in progressively within the 2s first-paint budget. */
const PROGRESS_COMMIT_MS = 300
/** Same tuning rationale as scanner.ts's CONCURRENCY — bounded, not unlimited, so this still behaves like a real rate-limited backend. The F&O universe here (~90 max, see scripMaster.ts) never gets close to needing more. */
const CONCURRENCY = 50
/**
 * How far back each candle/daily-bar fetch reaches. Generously larger than
 * CandleEngine's fixed 5-trading-day grid could ever be, because the
 * cutoff those endpoints apply is a wall-clock window, not a trading-day
 * count — see RAW_FETCH_DAYS_BACK in MockMarketDataSource.ts for the exact
 * same reasoning (asking for more than exists is harmless; asking for too
 * little silently clips real sessions).
 */
const CANDLE_DAYS_BACK = 10
const INDEX_QUOTE_KEYS = ['NIFTY', 'BANKNIFTY', 'INDIAVIX'] as const

export interface IntradayFilters {
  sector: string | null
  index: IndexKey | null
  q: string
  minStrength: number
  direction: 'all' | 'up' | 'down'
  breakoutOnly: boolean
  /**
   * An explicit whitelist of instrument tokens — set by SmartMoney's click,
   * which filters to the specific qualifying names in a sector, not the
   * whole sector (unlike `sector`, which SectorStrength's click sets).
   * null means no such restriction. Deliberately NOT one of the 7 URL-
   * persisted filter dimensions (see urlFilters.ts) — it's a derived,
   * click-scoped whitelist rather than a named criterion a shared link
   * should carry.
   */
  tokens: string[] | null
  /** True narrows to rows currently meeting the SAME crowding test SmartMoney's own default thresholds use (rvol ≥ SMART_MONEY_DEFAULT_MIN_RVOL and |zMove| ≥ SMART_MONEY_DEFAULT_MIN_ZMOVE) — a standing "just show me the crowded names" toggle, independent of `tokens` (which freezes one sector's specific qualifying set at click time). */
  smartMoneyOnly: boolean
}

export const DEFAULT_FILTERS: IntradayFilters = {
  sector: null,
  index: null,
  q: '',
  minStrength: 0,
  direction: 'all',
  breakoutOnly: false,
  tokens: null,
  smartMoneyOnly: false,
}

export interface IntradayMeters {
  marketMeter: MarketMeterResult
  indexMeter: IndexMeterEntry[]
  sectorStrength: SectorStrengthEntry[]
  smartMoney: SmartMoneyEntry[]
  intradayIndex: IntradayIndexEntry[]
  breakoutUpBySector: BreakoutCountEntry[]
  breakoutDownBySector: BreakoutCountEntry[]
  headerCounts: HeaderCounts
}

export type IntradayLoadState = 'idle' | 'loading' | 'ready' | 'error'

export interface IntradayState {
  /** Live rows — cmp/changePct/change3dPct move with ticks (at most one write per animation frame). Tables read this. */
  rows: IntradayRow[]
  /** Bumped on every write to `rows` (tick flush, bar-close recompute, load commit). A cheap "did rows change" signal for diagnostics. */
  rowsVersion: number
  /**
   * A snapshot of `rows` refreshed at most once per METER_THROTTLE_MS (and on
   * every load commit) — the ONLY rows the meters/charts read, so they
   * recompute on a 1-second cadence rather than per tick.
   */
  meterRows: IntradayRow[]
  /** Bumped every time `meterRows`/`meters` are re-snapshotted. */
  metersVersion: number
  bySector: Record<string, IntradayRow[]>
  indexQuotes: IndexQuote[]
  meters: IntradayMeters
  loadState: IntradayLoadState
  loadProgress: { done: number; total: number }
  lastComputedAt: number | null
  lastTickAt: number | null
  /** When the next scanEverySeconds auto-refresh is due (epoch seconds) — mirrors the load pipeline's own closure-private scheduling variable, exposed so a header countdown can read it. null before the first load completes. */
  nextRefreshAt: number | null
  filters: IntradayFilters
  starred: string[]
  errors: ScanError[]
  /** The token whose row a table most recently asked to drill into (a Symbol button's click) — read by InstrumentDrawer, and also used by the originating table to highlight the "selected" row. */
  selectedToken: string | null

  /** Idempotent: a second call while already running is a no-op. `source` overrides deps.dataSource for this call, mainly for tests. */
  init: (source?: MarketDataSource) => Promise<void>
  /** Tears down polling/tick subscriptions but keeps `rows`/`meters` as-is, so revisiting the page (via init() again) shows the last computed state instantly instead of a blank slate. */
  stop: () => void
  /** Re-runs the full load pipeline — also what the scanEverySeconds poll calls. */
  refreshAll: () => Promise<void>
  setFilters: (patch: Partial<IntradayFilters>) => void
  toggleStar: (token: string) => void
  /** Sets or clears (`null`) the drill-down selection — clicking the same row's Symbol button again is the caller's job to toggle, this just sets the value it's given. */
  selectToken: (token: string | null) => void
  /** Fetches this token's closed-candle history for the drill-down drawer's chart — the same fetchHistoricalCandles() the rest of this store calls, un-cached (the drawer opens rarely enough that re-fetching each time is simpler than invalidating a cache on every bar close). */
  fetchCandlesForToken: (token: string, exchange: Exchange) => Promise<Candle[]>
  /** Fetches this token's daily bars — the same fetchDailyBars() computeIntradayRow() itself calls, needed alongside fetchCandlesForToken() so the drawer can re-derive StrengthInputs via deriveStrengthInputs() and call explainStrength() on EXACTLY the inputs the row's own Strength was computed from. */
  fetchDailyBarsForToken: (token: string, exchange: Exchange) => Promise<Candle[]>
}

export type IntradayStore = UseBoundStore<StoreApi<IntradayState>>

export interface IntradayStoreDeps {
  dataSource: MarketDataSource
  /** Epoch seconds. Every "now" in this store reads through here — never Date.now() directly — so the mock's replay scrubber/speed moves this page exactly like it moves /rsi-ha. */
  now: () => number
  /**
   * Checked before calling dataSource.loadScripMaster(): if it returns a
   * non-empty array (the screener already has the scrip master in memory),
   * that's reused instead of paying loadScripMaster()'s simulated network
   * latency a second time when the user switches tabs. See
   * ScreenerState.scripRows.
   */
  getCachedScripRows?: () => ScripRow[] | undefined
  /** Real-ms poll interval for refresh scheduling. Defaults to 250ms, matching screenerStore. */
  pollIntervalMs?: number
  /**
   * Schedules one tick-buffer flush. Defaults to requestAnimationFrame (a
   * 16ms setTimeout outside a browser), so however many ticks arrive in a
   * frame, the store is written ONCE. Tests inject a synchronous or manual
   * scheduler to assert on the flushed state deterministically.
   */
  scheduleFrame?: (flush: () => void) => void
}

function defaultScheduleFrame(flush: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => flush())
  else setTimeout(flush, 16)
}

/** The fields defined on CLOSED candles only — see assertBarBoundaryInvariant(). */
export interface BarLockedFields {
  strength: number
  breakout: IntradayRow['breakout']
  breakoutLevel: number | null
  intradayDir: IntradayRow['intradayDir']
}

function barLockedFieldsOf(row: IntradayRow): BarLockedFields {
  return { strength: row.strength, breakout: row.breakout, breakoutLevel: row.breakoutLevel, intradayDir: row.intradayDir }
}

function sameNumber(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b
  return Object.is(a, b) || a === b
}

/**
 * Dev-only: throws if any row's strength/breakout/breakoutLevel/intradayDir
 * differs from the value its last FULL recompute (load or bar close)
 * produced — i.e. something other than a bar boundary changed them. Exported
 * for its own unit test.
 */
export function assertBarBoundaryInvariant(rows: readonly IntradayRow[], lockedByToken: ReadonlyMap<string, BarLockedFields>): void {
  for (const row of rows) {
    const locked = lockedByToken.get(row.token)
    if (!locked) continue
    if (
      !sameNumber(row.strength, locked.strength) ||
      row.breakout !== locked.breakout ||
      !sameNumber(row.breakoutLevel, locked.breakoutLevel) ||
      row.intradayDir !== locked.intradayDir
    ) {
      throw new Error(
        `[intradayStore] bar-boundary invariant violated for ${row.symbol}: strength/breakout/intradayDir changed between bar closes ` +
          `(expected ${JSON.stringify(locked)}, got ${JSON.stringify(barLockedFieldsOf(row))})`,
      )
    }
  }
}

function emptyMeters(): IntradayMeters {
  return {
    marketMeter: marketMeter([]),
    indexMeter: indexMeter([], INDEX_PANELS),
    sectorStrength: sectorStrength([]),
    smartMoney: smartMoney([]),
    intradayIndex: intradayIndex([]),
    breakoutUpBySector: breakoutCountsBySector([], 'BREAKOUT-UP'),
    breakoutDownBySector: breakoutCountsBySector([], 'BREAKOUT-DOWN'),
    headerCounts: headerCounts([]),
  }
}

function computeMeters(rows: IntradayRow[]): IntradayMeters {
  return {
    marketMeter: marketMeter(rows),
    indexMeter: indexMeter(rows, INDEX_PANELS),
    sectorStrength: sectorStrength(rows),
    smartMoney: smartMoney(rows),
    intradayIndex: intradayIndex(rows),
    breakoutUpBySector: breakoutCountsBySector(rows, 'BREAKOUT-UP'),
    breakoutDownBySector: breakoutCountsBySector(rows, 'BREAKOUT-DOWN'),
    headerCounts: headerCounts(rows),
  }
}

function computeBySector(rows: IntradayRow[]): Record<string, IntradayRow[]> {
  const map: Record<string, IntradayRow[]> = {}
  for (const row of rows) {
    const list = map[row.sector]
    if (list) list.push(row)
    else map[row.sector] = [row]
  }
  return map
}

/**
 * Applies `filters` to decide which rows count as "currently visible" —
 * used to bias tick priority (see MarketDataSource.subscribeTicks) AND
 * exported so a header chart can scope its OWN computation to whatever
 * another chart's click just filtered to ("every other panel narrows"),
 * without re-deriving the same intersection logic per chart. Never used to
 * hide rows in `rows` itself — that stays a UI-layer (table) concern.
 */
export function matchesFilters(row: IntradayRow, filters: IntradayFilters): boolean {
  if (filters.tokens !== null && !filters.tokens.includes(row.token)) return false
  if (filters.sector !== null && row.sector !== filters.sector) return false
  if (filters.index !== null && !row.indices.includes(filters.index)) return false
  if (filters.q.trim() !== '' && !row.symbol.toUpperCase().includes(filters.q.trim().toUpperCase())) return false
  if (!Number.isNaN(row.strength) && row.strength < filters.minStrength) return false
  if (filters.direction === 'up' && row.intradayDir !== 'up') return false
  if (filters.direction === 'down' && row.intradayDir !== 'down') return false
  if (filters.breakoutOnly && row.breakout === null) return false
  if (filters.smartMoneyOnly && !(row.rvol >= SMART_MONEY_DEFAULT_MIN_RVOL && Math.abs(row.zMove) >= SMART_MONEY_DEFAULT_MIN_ZMOVE)) return false
  return true
}

/** A leading+trailing throttle: fires immediately if idle, otherwise schedules exactly one trailing call — never more than one pending call at a time. Real wall-clock timing (setTimeout), deliberately separate from the simulated market clock (`deps.now()`): this paces UI re-renders, not market time. */
function createThrottle(intervalMs: number, fn: () => void): { trigger: () => void; flushNow: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastRun = 0

  function trigger(): void {
    const elapsed = Date.now() - lastRun
    if (elapsed >= intervalMs) {
      lastRun = Date.now()
      fn()
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null
        lastRun = Date.now()
        fn()
      }, intervalMs - elapsed)
    }
  }

  function flushNow(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    lastRun = Date.now()
    fn()
  }

  function cancel(): void {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return { trigger, flushNow, cancel }
}

/**
 * Builds the F&O underlying universe: the nearest-month FUTSTK set from
 * loadFnoFuturesUniverse() (src/strategy/universe.ts, PARITY-LOCKED —
 * dedupes to one nearest-expiry contract per company, untouched here),
 * enriched with sector via enrichInstrument(). The scrip master has no
 * FUTSTK "company_name is the base symbol" guarantee documented anywhere
 * outside scripMaster.ts's own comment, but it holds for every row the mock
 * generates, which is what enrichInstrument()/baseSymbolOf() rely on.
 */
function buildFnoUniverse(scripRows: ScripRow[], now: number): (Instrument & { sector: string })[] {
  // PARITY: compare expiries against TODAY, not the raw clock — see expiryFilterToday().
  const futuresUniverse = loadFnoFuturesUniverse(scripRows, DEFAULT_PARAMS, expiryFilterToday(now))
  const scripByToken = new Map(scripRows.map((row) => [String(row.exchange_token), row]))

  return futuresUniverse.map((entry) => {
    const scripRow = scripByToken.get(entry.token)
    const instrument: Instrument = {
      symbol: entry.symbol,
      token: entry.token,
      exchange: entry.exchange,
      instrumentName: 'FUTSTK',
      companyName: scripRow?.company_name,
      cachedClose: scripRow ? Number(scripRow.close_price) : NaN,
    }
    return enrichInstrument(instrument)
  })
}

/**
 * Factory rather than a bare `create(...)` singleton, matching
 * createScreenerStore()'s rationale exactly: tests inject a fake data
 * source / clock instead of the real mock's simulated latency.
 */
export function createIntradayStore(deps: IntradayStoreDeps): IntradayStore {
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const scheduleFrame = deps.scheduleFrame ?? defaultScheduleFrame
  /** Latest tick per token since the last flush — later ticks for the same token overwrite earlier ones (only the newest price matters). */
  const pendingTicks = new Map<string, MarketTick>()
  let frameScheduled = false
  /** token -> the bar-locked fields its last full recompute produced, for the dev-only assertion. */
  const barLockedByToken = new Map<string, BarLockedFields>()

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let unsubscribeTicks: (() => void) | null = null
  let unsubscribeStarred: (() => void) | null = null
  let currentSource: MarketDataSource | null = null
  let nextRefreshAt: number | null = null
  /** Bumped by every stop() — lets an init() that was awaiting a load notice it has been cancelled in the meantime. */
  let runGeneration = 0
  const lastBarStartByToken = new Map<string, number>()
  /** token -> its 3-sessions-ago closing price, refreshed every time that instrument's full IntradayRow is (re)computed. Not part of IntradayRow itself; kept here purely so an ON-TICK cmp update can recompute change3dPct without redoing the full computeIntradayRow (which would also touch strength/breakout/intradayDir — forbidden on a mid-bar tick). */
  const threeSessionsAgoCloseByToken = new Map<string, number>()
  /** token -> its enriched Instrument, from the most recent load — used by the bar-close handler to re-fetch+recompute just that one instrument. */
  let instrumentByToken = new Map<string, Instrument & { sector: string }>()

  const store = create<IntradayState>()(
    immer((set, get) => ({
      rows: [],
      rowsVersion: 0,
      meterRows: [],
      metersVersion: 0,
      bySector: {},
      indexQuotes: [],
      meters: emptyMeters(),
      loadState: 'idle',
      loadProgress: { done: 0, total: 0 },
      lastComputedAt: null,
      lastTickAt: null,
      nextRefreshAt: null,
      filters: DEFAULT_FILTERS,
      starred: Array.from(useStarredStore.getState().tokens),
      errors: [],
      selectedToken: null,

      async init(source) {
        const activeSource = source ?? deps.dataSource
        currentSource = activeSource

        if (pollTimer) return // already running

        const generation = runGeneration
        if (get().loadState !== 'ready') {
          await loadAndCompute(activeSource)
        }
        // stop() ran while we were loading (e.g. StrictMode's dev unmount/remount),
        // or another init() already finished wiring up — don't subscribe twice.
        if (generation !== runGeneration || pollTimer) return

        subscribeToUniverseTicks(activeSource)

        unsubscribeStarred = useStarredStore.subscribe((s) => {
          store.setState((draft) => {
            draft.starred = Array.from(s.tokens)
            for (const row of draft.rows) row.starred = s.tokens.has(row.token)
            draft.bySector = computeBySector(draft.rows)
            draft.rowsVersion += 1
          })
        })

        pollTimer = setInterval(() => pollTick(), pollIntervalMs)
      },

      stop() {
        runGeneration += 1
        if (pollTimer) clearInterval(pollTimer)
        pollTimer = null
        unsubscribeTicks?.()
        unsubscribeTicks = null
        unsubscribeStarred?.()
        unsubscribeStarred = null
        pendingTicks.clear()
        meterThrottle.cancel()
      },

      async refreshAll() {
        const source = currentSource ?? deps.dataSource
        await loadAndCompute(source)
        subscribeToUniverseTicks(source)
      },

      setFilters(patch) {
        set((draft) => {
          draft.filters = { ...draft.filters, ...patch }
        })
      },

      toggleStar(token) {
        useStarredStore.getState().toggleStar(token)
        // The useStarredStore subscription (set up in init()) mirrors this
        // into `starred`/row.starred too; setting it directly here as well
        // means toggleStar() still works correctly even before init() has
        // run (e.g. in a unit test that never subscribes).
        set((draft) => {
          const starredNow = useStarredStore.getState().isStarred(token)
          draft.starred = Array.from(useStarredStore.getState().tokens)
          const row = draft.rows.find((r) => r.token === token)
          if (row) row.starred = starredNow
          draft.rowsVersion += 1
        })
      },

      selectToken(token) {
        set((draft) => {
          draft.selectedToken = token
        })
      },

      async fetchCandlesForToken(token, exchange) {
        const source = currentSource ?? deps.dataSource
        return source.fetchHistoricalCandles(token, exchange, '5minute', CANDLE_DAYS_BACK)
      },

      async fetchDailyBarsForToken(token, exchange) {
        const source = currentSource ?? deps.dataSource
        return source.fetchDailyBars({ token, exchange }, CANDLE_DAYS_BACK)
      },
    })),
  )

  /** Records the bar-locked fields of rows a FULL recompute just produced, immediately before they're committed — the baseline assertBarBoundaryInvariant() checks tick flushes against. */
  function lockBarFields(rows: readonly IntradayRow[]): void {
    for (const row of rows) barLockedByToken.set(row.token, barLockedFieldsOf(row))
  }

  /** The one place `dailyCloses[length-3]` gets cached for the tick fast-path — see threeSessionsAgoCloseByToken's own comment. */
  function recordThreeSessionsAgoClose(token: string, sessions: Candle[], candles: Candle[], cmp: number, now: number): void {
    const { dailyCloses } = deriveStrengthInputs(sessions, candles, cmp, marketAsOf(candles, now))
    if (dailyCloses.length >= 3) threeSessionsAgoCloseByToken.set(token, dailyCloses[dailyCloses.length - 3])
    else threeSessionsAgoCloseByToken.delete(token)
  }

  /**
   * The full load pipeline: scrip master -> F&O universe -> candles/daily
   * bars for every instrument (bounded concurrency, partial results
   * committed as they arrive) + index quotes, all concurrently -> rows +
   * meters. Used by both init() (first load) and refreshAll() (the
   * scanEverySeconds poll and the manual "refresh now" path).
   */
  /**
   * Single-flight: a second caller while a load is already running (React
   * StrictMode's dev double-mount calling init() twice, a refreshAll() racing
   * the first load, a replay scrub mid-load) shares the in-flight promise
   * instead of starting a parallel pipeline that doubles every request and
   * whose partial commits would overwrite the other's rows.
   */
  let inFlightLoad: Promise<void> | null = null
  function loadAndCompute(source: MarketDataSource): Promise<void> {
    if (inFlightLoad) return inFlightLoad
    inFlightLoad = runLoadAndCompute(source).finally(() => {
      inFlightLoad = null
    })
    return inFlightLoad
  }

  async function runLoadAndCompute(source: MarketDataSource): Promise<void> {
    // Partial (progress) commits only make sense while the page has nothing
    // to show yet. On a refresh, the previous full set stays on screen until
    // the new one is complete — never a regression to a half-loaded subset.
    const commitPartials = store.getState().rows.length === 0
    store.setState((draft) => {
      draft.loadState = 'loading'
    })

    let scripRows: ScripRow[]
    try {
      const cached = deps.getCachedScripRows?.()
      scripRows = cached && cached.length > 0 ? cached : await source.loadScripMaster()
    } catch (err) {
      store.setState((draft) => {
        draft.loadState = 'error'
        draft.errors = [{ symbol: '*', message: err instanceof Error ? err.message : String(err) }]
      })
      return
    }

    const nowAtLoad = deps.now()
    const instruments = buildFnoUniverse(scripRows, nowAtLoad)
    instrumentByToken = new Map(instruments.map((i) => [i.token, i]))

    const total = instruments.length
    store.setState((draft) => {
      draft.loadProgress = { done: 0, total }
    })

    const workingRows: IntradayRow[] = []
    const errors: ScanError[] = []
    let done = 0

    // Progress (and, on a first load, the partial rows) are committed on this
    // throttle — never one store write per finished instrument, which made
    // every subscriber re-render ~90 times during a load.
    const progressThrottle = createThrottle(PROGRESS_COMMIT_MS, () => {
      if (!commitPartials) {
        store.setState((draft) => {
          draft.loadProgress = { done, total }
        })
        return
      }
      const snapshot = workingRows.slice()
      lockBarFields(snapshot)
      store.setState((draft) => {
        draft.rows = snapshot
        draft.rowsVersion += 1
        draft.meterRows = snapshot
        draft.metersVersion += 1
        draft.bySector = computeBySector(snapshot)
        draft.meters = computeMeters(snapshot)
        draft.lastComputedAt = deps.now()
        draft.loadProgress = { done, total }
      })
    })

    const rowsPromise = mapWithConcurrency(instruments, CONCURRENCY, async (instrument): Promise<IntradayRow | null> => {
      try {
        const [candles, sessions] = await Promise.all([
          source.fetchHistoricalCandles(instrument.token, instrument.exchange, '5minute', CANDLE_DAYS_BACK),
          source.fetchDailyBars(instrument, CANDLE_DAYS_BACK),
        ])
        const nowSec = deps.now()
        const row = computeIntradayRow({
          instrument,
          candles,
          sessions,
          ltp: undefined,
          now: nowSec,
          params: DEFAULT_PARAMS,
          starred: useStarredStore.getState().isStarred(instrument.token),
        })
        recordThreeSessionsAgoClose(instrument.token, sessions, candles, row.cmp, nowSec)
        workingRows.push(row)
        done += 1
        progressThrottle.trigger()
        return row
      } catch (err) {
        errors.push({ symbol: instrument.symbol, message: err instanceof Error ? err.message : String(err) })
        done += 1
        progressThrottle.trigger()
        return null
      }
    })

    const indexQuotesPromise = source.fetchIndexQuotes([...INDEX_QUOTE_KEYS]).catch((err: unknown) => {
      errors.push({ symbol: '*INDEX*', message: err instanceof Error ? err.message : String(err) })
      return [] as IndexQuote[]
    })

    const [rowResults, indexQuotes] = await Promise.all([rowsPromise, indexQuotesPromise])
    progressThrottle.cancel()

    const rows = rowResults.filter((r): r is IntradayRow => r !== null)
    const nowAfterLoad = deps.now()
    nextRefreshAt = nowAfterLoad + DEFAULT_PARAMS.scanEverySeconds

    lockBarFields(rows)
    store.setState((draft) => {
      draft.rows = rows
      draft.rowsVersion += 1
      draft.meterRows = rows
      draft.metersVersion += 1
      draft.bySector = computeBySector(rows)
      draft.indexQuotes = indexQuotes
      draft.meters = computeMeters(rows)
      draft.errors = errors
      draft.loadState = rows.length === 0 && errors.length > 0 ? 'error' : 'ready'
      draft.lastComputedAt = nowAfterLoad
      draft.nextRefreshAt = nextRefreshAt
      draft.loadProgress = { done: total, total }
    })
  }

  /**
   * Re-fetches and fully recomputes ONE instrument — used only when its bar
   * has just closed. This is the ONLY tick-driven path allowed to touch
   * strength/breakout/intradayDir (see computeIntradayRow), because a
   * closed bar is exactly the boundary the screener itself waits for.
   */
  async function recomputeOneInstrument(token: string, source: MarketDataSource): Promise<void> {
    const instrument = instrumentByToken.get(token)
    if (!instrument) return

    try {
      const [candles, sessions] = await Promise.all([
        source.fetchHistoricalCandles(instrument.token, instrument.exchange, '5minute', CANDLE_DAYS_BACK),
        source.fetchDailyBars(instrument, CANDLE_DAYS_BACK),
      ])
      const nowSec = deps.now()
      const row = computeIntradayRow({
        instrument,
        candles,
        sessions,
        ltp: undefined,
        now: nowSec,
        params: DEFAULT_PARAMS,
        starred: useStarredStore.getState().isStarred(token),
      })
      recordThreeSessionsAgoClose(token, sessions, candles, row.cmp, nowSec)
      barLockedByToken.set(token, barLockedFieldsOf(row))

      store.setState((draft) => {
        const idx = draft.rows.findIndex((r) => r.token === token)
        if (idx >= 0) draft.rows[idx] = row
        else draft.rows.push(row)
        draft.rowsVersion += 1
        draft.bySector = computeBySector(draft.rows)
        draft.errors = draft.errors.filter((e) => e.symbol !== instrument.symbol)
      })
      meterThrottle.trigger()
    } catch (err) {
      store.setState((draft) => {
        draft.errors = [
          ...draft.errors.filter((e) => e.symbol !== instrument.symbol),
          { symbol: instrument.symbol, message: err instanceof Error ? err.message : String(err) },
        ]
      })
    }
  }

  /** Recomputes meters (and refreshes index quotes) from whatever `rows` currently holds — throttled to at most once/second, shared by every tick and every bar-close recompute. Fetching index quotes is itself an async call, so it rides this same throttle rather than being "immediate" the way the trivial cmp arithmetic update is. */
  const meterThrottle = createThrottle(METER_THROTTLE_MS, () => {
    const rows = store.getState().rows
    store.setState((draft) => {
      draft.meterRows = rows
      draft.metersVersion += 1
      draft.meters = computeMeters(rows)
      draft.lastComputedAt = deps.now()
    })
    const source = currentSource
    if (source) {
      source
        .fetchIndexQuotes([...INDEX_QUOTE_KEYS])
        .then((indexQuotes) => {
          store.setState((draft) => {
            draft.indexQuotes = indexQuotes
          })
        })
        .catch(() => {
          // A single missed index-quote refresh isn't worth surfacing as a user-facing error — the next throttle tick tries again.
        })
    }
  })

  /**
   * PARITY-adjacent correctness rule (our own orchestration, same
   * discipline as screenerStore's identical function): a tick only ever
   * updates `cmp`/`changePct`/`change3dPct` — never strength, breakout or
   * intradayDir, all three of which are defined on CLOSED candles only.
   * Recomputing them mid-bar would show the dashboard disagreeing with what
   * /rsi-ha itself would report for the same instant.
   */
  function subscribeToUniverseTicks(source: MarketDataSource): void {
    unsubscribeTicks?.()
    lastBarStartByToken.clear()

    const tokens = Array.from(instrumentByToken.keys())
    const currentRows = store.getState().rows
    const currentFilters = store.getState().filters
    const priority = currentRows.filter((r) => matchesFilters(r, currentFilters)).map((r) => r.token)

    const intervalSeconds = parseIntervalMinutes(DEFAULT_PARAMS.candleInterval) * 60

    unsubscribeTicks = source.subscribeTicks(
      tokens,
      (tick: MarketTick) => {
        // ON TICK: buffer only — never a store write per tick. The buffered
        // prices land in ONE setState on the next animation frame.
        pendingTicks.set(tick.token, tick)
        if (!frameScheduled) {
          frameScheduled = true
          scheduleFrame(flushPendingTicks)
        }

        // ON BAR CLOSE: the bar-start bucket advancing between two ticks for
        // this token means a 5-minute candle just closed — re-fetch and
        // fully recompute only that one instrument.
        const barStart = Math.floor(tick.time / intervalSeconds) * intervalSeconds
        const previousBarStart = lastBarStartByToken.get(tick.token)
        lastBarStartByToken.set(tick.token, barStart)

        const barJustClosed = previousBarStart !== undefined && barStart > previousBarStart
        if (barJustClosed && !usePauseStore.getState().isPaused) {
          void recomputeOneInstrument(tick.token, source)
        }
      },
      { priority },
    )
  }

  /**
   * Applies every tick buffered since the last frame in a single store write.
   * Only cmp/changePct/change3dPct move here — see the PARITY-adjacent rule
   * on subscribeToUniverseTicks(). In dev, asserts that rule actually held.
   */
  function flushPendingTicks(): void {
    frameScheduled = false
    if (pendingTicks.size === 0) return
    const batch = Array.from(pendingTicks.values())
    pendingTicks.clear()
    const nowSec = deps.now()

    store.setState((draft) => {
      const indexByToken = new Map<string, number>()
      draft.rows.forEach((r, i) => indexByToken.set(r.token, i))
      for (const tick of batch) {
        const idx = indexByToken.get(tick.token)
        if (idx === undefined) continue
        const row = draft.rows[idx]
        row.cmp = tick.ltp
        row.changePct = Number.isNaN(row.prevClose) ? NaN : (tick.ltp / row.prevClose - 1) * 100
        const threeAgo = threeSessionsAgoCloseByToken.get(tick.token)
        row.change3dPct = threeAgo === undefined ? NaN : (tick.ltp / threeAgo - 1) * 100
      }
      draft.rowsVersion += 1
      draft.lastTickAt = nowSec
    })

    if (import.meta.env?.DEV) assertBarBoundaryInvariant(store.getState().rows, barLockedByToken)
    meterThrottle.trigger()
  }

  function pollTick(): void {
    const nowSec = deps.now()
    const paused = usePauseStore.getState().isPaused
    const state = store.getState()

    const due = !paused && nextRefreshAt !== null && nowSec >= nextRefreshAt && state.loadState !== 'loading'
    if (due) void store.getState().refreshAll()
  }

  return store
}
