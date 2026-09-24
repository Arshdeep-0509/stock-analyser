import { createContext, useContext } from 'react'
import type { Candle, Exchange, Instrument, MarketTick } from '../types/domain'
import type { ScripRow, SearchResponse } from '../types/api'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'replaying'

/**
 * NIFTY 50 / NIFTY BANK / India VIX — the only three index quotes the
 * dashboard needs. Not something mastertrust_rsi_ha_screener.py ever
 * fetches (it only scans individual NSE/NFO equities and derivatives); see
 * INDEX_TOKENS in src/types/api.ts for how a real implementation would
 * resolve each key to a Master Trust instrument token.
 */
export type IndexQuoteKey = 'NIFTY' | 'BANKNIFTY' | 'INDIAVIX'

export interface IndexQuote {
  key: IndexQuoteKey
  label: string
  last: number
  prevClose: number
  changePct: number
  /** Epoch seconds. */
  time: number
}

/**
 * One method per mastertrust_rsi_ha_screener.py function (see
 * ../../docs/STRATEGY-CONTRACT.md), so a mock implementation (generated
 * candles, no network) and a future real client are interchangeable behind
 * the same shape. No implementation exists yet — this step is the contract
 * only.
 */
export interface MarketDataSource {
  /** Mirrors search_symbol(). */
  searchSymbol(keyword: string): Promise<SearchResponse>

  /**
   * Mirrors fetch_historical_candles(). Implementations must reproduce its
   * still-forming-candle exclusion (STRATEGY-CONTRACT.md §3.2): only closed
   * candles are ever returned.
   */
  fetchHistoricalCandles(token: string, exchange: Exchange, interval: string, daysBack: number): Promise<Candle[]>

  /** Mirrors _download_scrip_master() -> CompactScrip.csv, already parsed. */
  loadScripMaster(): Promise<ScripRow[]>

  /**
   * Subscribes to live ticks for the given tokens. Returns an unsubscribe
   * function. Backed by PrimusTick over the (UNCONFIRMED) Primus WebSocket
   * feed in a real implementation — callers only ever see the normalised
   * MarketTick.
   *
   * `opts.priority` marks tokens the caller currently has on screen (e.g.
   * visible table rows). A feed carrying the whole F&O universe (200+
   * tokens) cannot tick every token every frame without melting the
   * connection, so an implementation is expected to batch and to bias that
   * batching toward priority tokens — see MockPrimusSocket for the mock's
   * approach. Non-priority tokens must still eventually tick; `priority` is
   * a bias, not an exclusion filter.
   */
  subscribeTicks(tokens: string[], onTick: (tick: MarketTick) => void, opts?: { priority?: string[] }): () => void

  getConnectionState(): ConnectionState

  /**
   * Index-level quotes. See INDEX_TOKENS (src/types/api.ts) for how a real
   * implementation resolves each key to an instrument token — the UNCONFIRMED
   * TODO(contract) there applies here too.
   */
  fetchIndexQuotes(keys: IndexQuoteKey[]): Promise<IndexQuote[]>

  /**
   * Daily OHLC bars. See DAILY_DATA_DURATION_MINUTES_GUESS (src/types/api.ts):
   * the real day-level request parameter is UNCONFIRMED, so this is its own
   * method rather than fetchHistoricalCandles with a daily interval. Until
   * confirmed, an implementation may aggregate closed intraday bars itself —
   * see src/analytics/daily.ts's aggregateToSessions(), the one function
   * that aggregation is allowed to live in.
   */
  fetchDailyBars(instrument: Pick<Instrument, 'token' | 'exchange'>, days: number): Promise<Candle[]>
}

const MarketDataContext = createContext<MarketDataSource | null>(null)

export const MarketDataProvider = MarketDataContext.Provider

/**
 * Reads whichever MarketDataSource implementation is currently provided
 * (mock, real, or a replay fixture). Throws if used outside a
 * MarketDataProvider rather than silently falling back to a default, since
 * a silent fallback is exactly the kind of guess STRATEGY-CONTRACT.md §3.2
 * says not to make.
 */
export function useMarketData(): MarketDataSource {
  const context = useContext(MarketDataContext)
  if (!context) {
    throw new Error('useMarketData() must be used within a MarketDataProvider')
  }
  return context
}
