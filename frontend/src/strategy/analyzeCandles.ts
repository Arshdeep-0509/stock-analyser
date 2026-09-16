import type { AnalyzedCandle, Candle } from '../types/domain'
import type { StrategyParams } from './constants'
import { computeHeikinAshi, computeRsi } from './indicators'

/**
 * Merges computeRsi() + computeHeikinAshi() into the combined AnalyzedCandle
 * shape checkSignal()/checkBreakout() consume. Every place that needs a
 * symbol's analyzed candles (the scanner, the mock universe generator, the
 * detail drawer's chart) calls this ONE function, so the numbers behind a
 * signal, its chart, and its explanation checklist can never drift apart.
 */
export function analyzeCandles(candles: Candle[], params: StrategyParams): AnalyzedCandle[] {
  const rsi = computeRsi(candles, params.rsiPeriod)
  const ha = computeHeikinAshi(candles)
  return ha.map((candle, i) => ({ ...candle, rsi: rsi[i] }))
}
