/**
 * Raw upstream API shapes, exactly as documented in
 * ../../docs/STRATEGY-CONTRACT.md — do not "clean up" these types to look
 * more like our domain types. They exist to describe what actually arrives
 * over the wire (or is UNCONFIRMED) so the normalisation step stays visible
 * and auditable, not to be pleasant to consume directly.
 */

// ---------------------------------------------------------------------------
// GET /api/v1/search?key=<keyword>
// ---------------------------------------------------------------------------

export interface SearchResult {
  exchange: string
  trading_symbol: string
  token: string | number
  [key: string]: unknown
}

export interface SearchResponse {
  error: unknown
  result: SearchResult[]
}

// ---------------------------------------------------------------------------
// GET /api/v1/charts/tdv (historical candles)
// ---------------------------------------------------------------------------

/**
 * Positional tuple, not an object: [datetime, open, high, low, close, volume].
 * Numeric fields may arrive as strings — the Python coerces all five with
 * pd.to_numeric, so any consumer of this type must coerce too.
 */
export type RawCandleRow = [
  datetime: string | number,
  open: string | number,
  high: string | number,
  low: string | number,
  close: string | number,
  volume: string | number,
]

export interface HistoricalCandlesResponse {
  data: {
    candles: RawCandleRow[]
  }
}

/**
 * PARITY NOTE: mastertrust_rsi_ha_screener.py does `pd.to_datetime(df["datetime"])`
 * with no explicit format, so the real wire format (ISO-8601 string vs.
 * epoch seconds/milliseconds) is UNCONFIRMED. This is the single place that
 * decides how a raw candle timestamp becomes our normalised epoch-seconds
 * `Candle.time` — do not duplicate this coercion elsewhere.
 *
 * TODO(contract): confirm the real format against a live Master Trust
 * response, then delete whichever branch turns out to be dead code.
 */
export function parseCandleTimestamp(raw: string | number): number {
  if (typeof raw === 'number') {
    const isMilliseconds = raw > 1e12
    logDetectedFormatOnce(isMilliseconds ? 'epoch-milliseconds (number)' : 'epoch-seconds (number)', raw)
    return isMilliseconds ? Math.floor(raw / 1000) : Math.floor(raw)
  }

  const trimmed = raw.trim()

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed)
    const isMilliseconds = numeric > 1e12
    logDetectedFormatOnce(isMilliseconds ? 'epoch-milliseconds (numeric string)' : 'epoch-seconds (numeric string)', raw)
    return isMilliseconds ? Math.floor(numeric / 1000) : Math.floor(numeric)
  }

  const parsed = Date.parse(trimmed)
  if (Number.isNaN(parsed)) {
    throw new Error(`parseCandleTimestamp: unrecognised timestamp format: ${raw}`)
  }
  logDetectedFormatOnce('ISO-8601', raw)
  return Math.floor(parsed / 1000)
}

const loggedFormats = new Set<string>()

/**
 * Surfaces the detected wire format in the dev console — once per format,
 * not once per candle. `import.meta.env` is a Vite-only global (undefined
 * when this module runs under plain Node/tsx, e.g. scripts/indexSmoke.ts),
 * hence the optional chain — not a change to the actual dev/prod behaviour
 * Vite itself sees.
 */
function logDetectedFormatOnce(format: string, sample: string | number): void {
  if (!import.meta.env?.DEV || loggedFormats.has(format)) return
  loggedFormats.add(format)
  console.debug(`[parseCandleTimestamp] detected "${format}" candle timestamp format, e.g.`, sample)
}

// ---------------------------------------------------------------------------
// GET /api/v1/contract/Compact?info=download -> CompactScrip.csv
// ---------------------------------------------------------------------------

/**
 * Only the columns mastertrust_rsi_ha_screener.py actually reads. The real
 * CSV has more columns; [key: string]: unknown accounts for the rest.
 */
export interface ScripRow {
  exchange: string
  instrument_name: string
  trading_symbol: string
  exchange_token: string | number
  close_price: string | number
  /** Format "%d-%b-%Y", e.g. "25-Jan-2026". */
  expiry: string
  company_name: string
  strike: string | number
  option_type: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Index quotes — GET /api/v1/charts/tdv against the index's OWN token
// ---------------------------------------------------------------------------

/**
 * TODO(contract): UNCONFIRMED. mastertrust_rsi_ha_screener.py never fetches
 * an index at all — it only scans individual NSE/NFO equities and
 * derivatives, so there is no line of the Python to transliterate here. A
 * real backend would fetch NIFTY 50 / NIFTY BANK / India VIX the exact same
 * way as any other instrument: GET /api/v1/charts/tdv against that index's
 * own `exchange_token`. Which tokens Master Trust assigns to these three in
 * its instrument master has not been confirmed against a live response —
 * these are placeholders, not real tokens.
 *
 * The intended resolution order for a real `HttpMarketDataSource`: call
 * `GET /api/v1/search?key=<name>` (search_symbol() already exists for
 * this — see §3.1) for `"NIFTY 50"` / `"NIFTY BANK"` / `"INDIA VIX"` at
 * runtime and use whatever token comes back; fall back to this map only if
 * search returns nothing. Replace the placeholder values below once the
 * real tokens are confirmed — don't ship them as real.
 */
export const INDEX_TOKENS: Readonly<Record<'NIFTY' | 'BANKNIFTY' | 'INDIAVIX', string>> = {
  NIFTY: 'UNCONFIRMED-NIFTY-50-TOKEN',
  BANKNIFTY: 'UNCONFIRMED-NIFTY-BANK-TOKEN',
  INDIAVIX: 'UNCONFIRMED-INDIA-VIX-TOKEN',
}

// ---------------------------------------------------------------------------
// Daily bars — GET /api/v1/charts/tdv with a day-level data_duration
// ---------------------------------------------------------------------------

/**
 * TODO(contract): UNCONFIRMED. fetch_historical_candles() (lines 190-226)
 * always sets `data_duration` to the digits pulled out of `CANDLE_INTERVAL`
 * ("5minute" -> 5) — the Python never requests a daily bar, so there is no
 * observed value for a one-day candle's `data_duration`. `1440` (minutes in
 * a day) is a reasonable guess by analogy with the intraday parameter, nothing
 * more — do not treat it as confirmed until checked against a live response.
 *
 * Until confirmed, the frontend never calls a day-level endpoint at all: it
 * aggregates the 5-minute bars it already has into session bars itself, in
 * exactly one function, `aggregateToSessions()`
 * (`src/analytics/daily.ts`), so swapping to a real daily endpoint later is
 * a one-line change in whichever `MarketDataSource.fetchDailyBars()`
 * implementation is active — not a change to any of its callers.
 */
export const DAILY_DATA_DURATION_MINUTES_GUESS = 1440

// ---------------------------------------------------------------------------
// Primus WebSocket tick (primusapi.tradelab.in) — UNCONFIRMED
// ---------------------------------------------------------------------------

/**
 * TODO(contract): not present anywhere in mastertrust_rsi_ha_screener.py —
 * the Python only polls REST on a timer. This describes the fields the UI
 * needs from a future live-tick feed; the exact real payload is
 * unconfirmed. Nothing outside the data layer may import this type directly
 * — consume the normalised MarketTick (src/types/domain.ts) instead.
 */
export interface PrimusTick {
  token: string | number
  exchange: string
  ltp: number
  /** Epoch seconds. */
  ltt: number
  volume?: number
  o?: number
  h?: number
  l?: number
  c?: number
  [key: string]: unknown
}
