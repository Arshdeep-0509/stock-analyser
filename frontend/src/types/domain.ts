/**
 * The app's own normalised types. Raw upstream shapes live in ./api.ts;
 * everything on this side of the boundary should already be coerced to the
 * right JS types (numbers are numbers, timestamps are epoch seconds).
 */

export type Exchange = 'NSE' | 'NFO'
export type InstrumentName = 'EQ' | 'FUTSTK' | 'OPTSTK'
export type OptionType = 'CE' | 'PE'

export interface Candle {
  /** Epoch seconds, IST. */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface HaCandle extends Candle {
  haOpen: number
  haHigh: number
  haLow: number
  haClose: number
  haColor: 'green' | 'red'
}

/**
 * A candle carrying both the RSI and Heikin-Ashi columns at once — the
 * shape of a DataFrame row in mastertrust_rsi_ha_screener.py's
 * scan_watchlist() by the time check_signal()/check_breakout() run (after
 * both compute_rsi() and compute_heikin_ashi() have been applied). `rsi` is
 * NaN wherever computeRsi() left it NaN (see STRATEGY-CONTRACT.md /
 * indicators.ts) — never null, never 0.
 */
export interface AnalyzedCandle extends HaCandle {
  rsi: number
}

export interface Instrument {
  symbol: string
  token: string
  exchange: Exchange
  instrumentName: InstrumentName
  companyName?: string
  /** Epoch seconds. */
  expiry?: number
  strike?: number
  optionType?: OptionType
  /** Cached scrip-master close price — a snapshot, not a live quote. See
   * STRATEGY-CONTRACT.md §4 (ATM strike selection uses this, not live data). */
  cachedClose: number
}

export type SignalKind = 'BUY' | 'SELL' | 'BREAKOUT-UP' | 'BREAKOUT-DOWN' | 'CE Buy' | 'PE Buy'

/**
 * PARITY: this shape is deliberately inconsistent across signal kinds,
 * matching mastertrust_rsi_ha_screener.py's scan_watchlist() /
 * add_option_recommendations() output (see STRATEGY-CONTRACT.md §4):
 *  - `level` is only ever populated for BREAKOUT-UP / BREAKOUT-DOWN rows.
 *  - `derivedFrom` (the underlying symbol) is only populated for
 *    "CE Buy" / "PE Buy" rows, and those rows copy the underlying's `rsi`
 *    and `time` verbatim rather than computing their own.
 * Do not normalise these away.
 */
export interface SignalRow {
  id: string
  symbol: string
  exchange: Exchange
  signal: SignalKind
  price: number
  rsi: number
  /** Epoch seconds. */
  time: number
  level?: number
  derivedFrom?: string
}

/**
 * Normalised live-tick shape. The data layer is responsible for adapting
 * whatever the real feed sends (see PrimusTick in ./api.ts, UNCONFIRMED)
 * into this — nothing outside the data layer should ever see a raw tick.
 */
export interface MarketTick {
  token: string
  exchange: Exchange
  ltp: number
  /** Epoch seconds. */
  time: number
  volume?: number
  open?: number
  high?: number
  low?: number
  close?: number
}
