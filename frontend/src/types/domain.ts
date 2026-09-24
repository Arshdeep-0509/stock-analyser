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
  /**
   * Sector name, e.g. 'Banks' | 'IT Software' (see src/data/reference/sectors.ts).
   * Not present on an Instrument as loaded by src/strategy/universe.ts — the
   * Master Trust scrip master has no sector column (docs/SECTOR-DATA.md).
   * Only src/analytics/enrich.ts's enrichInstrument() ever sets this.
   */
  sector?: string
}

/**
 * The sector-index dashboard panels (src/data/reference/indices.ts). A
 * closed set because the dashboard renders one card per key, in this order —
 * not an open string, so an unrecognised key is a type error, not a silently
 * dropped card.
 */
export type IndexKey =
  | 'NIFTY_50'
  | 'BANK_NIFTY'
  | 'METAL'
  | 'PHARMA'
  | 'PSU_BANK'
  | 'PVT_BANK'
  | 'AUTO'
  | 'FINANCIAL'
  | 'FMCG'
  | 'IT'
  | 'REALTY'
  | 'OTHERS'

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

/**
 * Every field the /intraday dashboard shows for one instrument, produced by
 * src/analytics/intraday.ts's computeIntradayRow() — a pure function of
 * already-fetched candles/sessions, never computed ad hoc in a component.
 * Numeric fields that genuinely can't be computed (not enough session
 * history, no bars yet today) are NaN, not 0 — see computeIntradayRow's own
 * doc comment for exactly which fields that applies to and why.
 */
export interface IntradayRow {
  symbol: string
  /** The underlying company name (src/analytics/enrich.ts's baseSymbolOf()) — "RELIANCE" for both "RELIANCE-EQ" and "RELIANCE26SEPFUT". Used to join an intraday FUTSTK row back to its /rsi-ha EQ row (InstrumentDrawer's "Screener status") without a fragile symbol-string heuristic. */
  baseSymbol: string
  token: string
  exchange: Exchange
  sector: string
  indices: IndexKey[]

  /** Live LTP, falling back to the last closed 5-minute candle's close when no live tick has arrived yet. */
  cmp: number
  /** The most recent COMPLETED session's close. NaN if no completed session exists yet. */
  prevClose: number
  /** (cmp / prevClose - 1) * 100. NaN when prevClose is NaN. */
  changePct: number
  /** (cmp / closeThreeSessionsAgo - 1) * 100, three SESSIONS back (not 72 hours — weekends don't shift it). NaN with fewer than 4 sessions of history (3 completed + today). */
  change3dPct: number

  /** Today's first closed 5-min bar's open. NaN before the first bar of the day closes. */
  dayOpen: number
  /** Max high across today's closed 5-min bars so far. NaN before the first bar closes. */
  dayHigh: number
  /** Min low across today's closed 5-min bars so far. NaN before the first bar closes. */
  dayLow: number
  /** Σ(typicalPrice × volume) / Σ(volume) over today's closed bars only, typicalPrice = (high+low+close)/3. NaN before the first bar closes. */
  vwap: number

  /** src/analytics/strength.ts's computeStrength() — our own metric, see docs/STRENGTH.md. */
  strength: number
  strengthTone: 'high' | 'medium' | 'low' | 'none'

  /** The colour of the LAST CLOSED Heikin-Ashi candle (src/strategy/indicators.ts computeHeikinAshi) — deliberately the same signal the /rsi-ha HA column shows, not a second definition of "direction". */
  intradayDir: 'up' | 'down'

  /** src/strategy/signals.ts checkBreakout(), same DEFAULT_PARAMS.breakoutLookback — not a second breakout rule. */
  breakout: 'BREAKOUT-UP' | 'BREAKOUT-DOWN' | null
  breakoutLevel: number | null

  /** The three raw Strength factors (not their transformed sqrt/persistence-factor form), exposed so a drill-down can explain the headline number — see src/analytics/explainStrength.ts. NaN together with `strength` whenever Strength itself is NaN. */
  rvol: number
  zMove: number
  persistence: number

  /**
   * Carried straight through from Instrument.cachedClose — a scrip-master
   * SNAPSHOT close, not a live price. The only consumer today is
   * src/analytics/aggregate.ts's intradayIndex() 'cap-weight (approx.)'
   * option, which uses it as a stand-in for real market cap because no real
   * cap figure exists anywhere in this app's data. NaN if the instrument
   * had no scrip-master row to read it from.
   */
  cachedClose: number

  /** Epoch seconds of the price `cmp` is as-of: `now` if a live tick was available, otherwise the last closed candle's own time. */
  lastTickAt: number

  /**
   * The user's own marker (a coloured dot in the reference dashboard's
   * Breakout/BreakDown tables, whose meaning is undocumented there — see
   * StarMarker.tsx's tooltip). computeIntradayRow() takes this as an
   * optional input (defaulting to false) rather than reading it from
   * anywhere itself — the actual localStorage-backed persistence lives in
   * src/store/starredStore.ts, kept out of this pure function.
   */
  starred: boolean
}
