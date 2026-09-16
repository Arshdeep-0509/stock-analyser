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

/** Surfaces the detected wire format in the dev console — once per format, not once per candle. */
function logDetectedFormatOnce(format: string, sample: string | number): void {
  if (!import.meta.env.DEV || loggedFormats.has(format)) return
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
