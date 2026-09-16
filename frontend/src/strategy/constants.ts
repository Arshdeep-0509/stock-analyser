/**
 * Mirrors the CONFIG constants in mastertrust_rsi_ha_screener.py (lines
 * 72–80) exactly — see STRATEGY-CONTRACT.md §1 for the source values.
 * Property names are camelCased for TS convention; the values themselves
 * are not open for reinterpretation.
 */
export interface StrategyParams {
  /** Python: CANDLE_INTERVAL. */
  candleInterval: string
  /** Python: MIN_PRICE. */
  minPrice: number
  /** Python: RSI_PERIOD. */
  rsiPeriod: number
  /** Python: RSI_BUY_LOW. */
  rsiBuyLow: number
  /** Python: RSI_BUY_HIGH. */
  rsiBuyHigh: number
  /** Python: RSI_SELL_LOW. */
  rsiSellLow: number
  /** Python: RSI_SELL_HIGH. */
  rsiSellHigh: number
  /** Python: BREAKOUT_LOOKBACK. */
  breakoutLookback: number
  /** Python: SCAN_EVERY_SECONDS. */
  scanEverySeconds: number
}

/**
 * Always equals the Python values. The UI clones-and-overrides this object
 * for user-adjustable parameters later — this constant itself never
 * changes.
 */
export const DEFAULT_PARAMS: Readonly<StrategyParams> = Object.freeze({
  candleInterval: '5minute',
  minPrice: 2000.0,
  rsiPeriod: 14,
  rsiBuyLow: 60,
  rsiBuyHigh: 65,
  rsiSellLow: 35,
  rsiSellHigh: 40,
  breakoutLookback: 20,
  scanEverySeconds: 300,
})

/**
 * Extracts the interval minutes from a candleInterval string (e.g.
 * "5minute" -> 5), mirroring fetch_historical_candles()'s
 * `int("".join(filter(str.isdigit, interval)))` (line 198). The one place
 * every consumer of `candleInterval` should parse it, so the scanner, the
 * WS tick bar-close detector, and the mock's dropFormingCandle cutoff can
 * never read it differently from one another.
 */
export function parseIntervalMinutes(candleInterval: string): number {
  return Number(candleInterval.replace(/\D/g, '')) || 5
}

/** Which params.StrategyParams keys differ from DEFAULT_PARAMS — for the "N modified parameters" UI. */
export function overriddenParamKeys(params: StrategyParams): (keyof StrategyParams)[] {
  return (Object.keys(DEFAULT_PARAMS) as (keyof StrategyParams)[]).filter((key) => params[key] !== DEFAULT_PARAMS[key])
}
