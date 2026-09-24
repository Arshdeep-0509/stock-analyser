import { expiryFilterToday } from '../../lib/marketSession'
import type { ScripRow } from '../../types/api'
import type { AnalyzedCandle } from '../../types/domain'
import { analyzeCandles } from '../../strategy/analyzeCandles'
import { DEFAULT_PARAMS, type StrategyParams } from '../../strategy/constants'
import { checkBreakout, checkSignal, type BreakoutResult, type SignalDecision } from '../../strategy/signals'
import { loadFnoFuturesUniverse, loadNseEquityUniverse, type UniverseEntry } from '../../strategy/universe'
import { parseHistoricalCandlesResponse } from '../parseCandles'
import { CandleEngine } from './candleEngine'
import { deriveSeed } from './rng'
import { generateScripMaster, type ScripMasterResult } from './scripMaster'

/** The tuner's stated target: distinct symbols with a signal or breakout on the final bar, and its retry budget. */
export const MIN_SIGNALS = 8
export const MAX_SIGNALS = 60
export const MAX_ATTEMPTS = 20
const DAYS_BACK = 5

export interface UniverseSymbolResult {
  entry: UniverseEntry
  candles: AnalyzedCandle[]
  signal: SignalDecision
  breakout: BreakoutResult
}

export interface GeneratedUniverse {
  seed: number
  referenceNow: number
  scripMaster: ScripMasterResult
  candleEngine: CandleEngine
  equityUniverse: UniverseEntry[]
  futuresUniverse: UniverseEntry[]
  results: UniverseSymbolResult[]
  signalCount: number
  attempts: number
}

function closePriceByToken(rows: ScripRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) {
    const price = Number(row.close_price)
    if (!Number.isNaN(price)) map.set(String(row.exchange_token), price)
  }
  return map
}

function analyzeSymbol(
  entry: UniverseEntry,
  candleEngine: CandleEngine,
  startPrice: number,
  params: StrategyParams,
  referenceNow: number,
): UniverseSymbolResult {
  const raw = candleEngine.getRawHistoricalResponse(entry.token, startPrice, DAYS_BACK)
  const closed = parseHistoricalCandlesResponse(raw, 5, referenceNow)
  const analyzed: AnalyzedCandle[] = analyzeCandles(closed, params)

  const signal = analyzed.length > 0 ? checkSignal(analyzed, params) : null
  const breakout = closed.length > 0 ? checkBreakout(closed, params) : { signal: null, level: null }

  return { entry, candles: analyzed, signal, breakout }
}

/**
 * Builds a full deterministic mock universe: scrip master -> equity/futures
 * scan universe (via src/strategy/universe.ts, unchanged) -> generated
 * candles -> RSI/HA -> checkSignal()/checkBreakout() (src/strategy/signals.ts,
 * unchanged) on the final bar of every scanned symbol.
 *
 * If the number of DISTINCT symbols producing a signal or breakout lands
 * outside [8, 60], the candle generation parameters are re-derived (a fresh
 * per-attempt sub-seed, mixed into the same top-level seed) and the whole
 * scan is redone, up to MAX_ATTEMPTS times. Only the generator's inputs
 * (vol/drift/reversion) are ever varied — never a signal outcome directly —
 * and the whole process is deterministic: a given (seed, referenceNow) pair
 * always lands on the same attempt with the same result.
 */
export function generateUniverse(
  seed: number,
  referenceNow: number,
  params: StrategyParams = DEFAULT_PARAMS,
): GeneratedUniverse {
  const scripMaster = generateScripMaster({ seed, referenceNow })
  const priceByToken = closePriceByToken(scripMaster.rows)

  const equityUniverse = loadNseEquityUniverse(scripMaster.rows, params)
  // Same "today" the app passes (see expiryFilterToday) so the tuner scans the universe the app will actually show.
  const futuresUniverse = loadFnoFuturesUniverse(scripMaster.rows, params, expiryFilterToday(referenceNow))
  const scanUniverse = [...equityUniverse, ...futuresUniverse]

  let attempt = 0
  let candleEngine = new CandleEngine(deriveSeed(seed, 'universe-attempt:0'), referenceNow)
  let results: UniverseSymbolResult[] = []
  let signalCount = 0

  for (;;) {
    const attemptSeed = deriveSeed(seed, `universe-attempt:${attempt}`)
    candleEngine = new CandleEngine(attemptSeed, referenceNow)

    results = scanUniverse.map((entry) => {
      const startPrice = priceByToken.get(entry.token) ?? 2500
      return analyzeSymbol(entry, candleEngine, startPrice, params, referenceNow)
    })

    const symbolsWithSignal = new Set<string>()
    for (const result of results) {
      if (result.signal !== null || result.breakout.signal !== null) {
        symbolsWithSignal.add(result.entry.token)
      }
    }
    signalCount = symbolsWithSignal.size

    const inRange = signalCount >= MIN_SIGNALS && signalCount <= MAX_SIGNALS
    const isLastAttempt = attempt >= MAX_ATTEMPTS - 1

    if (inRange || isLastAttempt) {
      if (inRange) {
        console.info(`[mock] generateUniverse: ${signalCount} signals after ${attempt + 1} attempt(s)`)
      } else {
        console.warn(
          `[mock] generateUniverse: gave up after ${attempt + 1} attempts, signalCount=${signalCount} (target ${MIN_SIGNALS}-${MAX_SIGNALS})`,
        )
      }
      break
    }

    attempt += 1
  }

  return {
    seed,
    referenceNow,
    scripMaster,
    candleEngine,
    equityUniverse,
    futuresUniverse,
    results,
    signalCount,
    attempts: attempt + 1,
  }
}
