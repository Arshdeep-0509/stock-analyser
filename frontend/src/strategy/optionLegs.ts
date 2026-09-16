import type { Candle, SignalRow } from '../types/domain'
import type { AtmMap } from './universe'

/**
 * Transliteration of add_option_recommendations() (mastertrust_rsi_ha_screener.py
 * lines 417–446). For every NSE equity BUY/SELL row, appends a
 * recommendation to buy the corresponding ATM option contract:
 * BUY -> CE Buy, SELL -> PE Buy. Breakout rows are skipped — there is no
 * option leg for a breakout, only for BUY/SELL.
 *
 * `getCandles` mirrors fetch_historical_candles(opt_token, exchange="NFO")
 * — the recommendation's price is the option's own last close.
 *
 * PARITY: `rsi` and `time` are COPIED from the underlying equity row, not
 * recomputed from the option's own candles — the original's comment
 * explains this is deliberate, since option premiums are driven by time
 * decay/volatility as much as direction. Do not "fix" this to compute the
 * option's own RSI. In the UI these two fields should be rendered with a
 * tooltip noting they're inherited from the underlying.
 *
 * PARITY: like the original, this does not guard against `getCandles`
 * resolving to an empty array — the original calls `.iloc[-1]` unguarded
 * and outside any try/except, so an empty result crashes the scan. Indexing
 * an empty array here throws the same way; that is intentional, not an
 * oversight.
 */
export async function addOptionRecommendations(
  signals: SignalRow[],
  atmMap: AtmMap,
  getCandles: (token: string) => Promise<Candle[]>,
): Promise<SignalRow[]> {
  const extra: SignalRow[] = []

  for (const row of signals) {
    if (row.exchange !== 'NSE') continue
    if (row.signal !== 'BUY' && row.signal !== 'SELL') continue

    const baseSymbol = row.symbol.replace('-EQ', '')
    const legs = atmMap[baseSymbol]
    if (!legs) continue

    const optionType = row.signal === 'BUY' ? 'CE' : 'PE'
    const leg = legs[optionType]
    if (!leg) continue
    const [optSymbol, optToken] = leg

    const optCandles = await getCandles(optToken)
    const price = optCandles[optCandles.length - 1].close

    extra.push({
      id: `${optSymbol}-${row.time}`,
      symbol: optSymbol,
      exchange: 'NFO',
      signal: optionType === 'CE' ? 'CE Buy' : 'PE Buy',
      price,
      rsi: row.rsi,
      time: row.time,
      derivedFrom: row.symbol,
    })
  }

  return extra
}
