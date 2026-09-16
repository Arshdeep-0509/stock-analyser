import { createContext, useContext } from 'react'
import type { Candle, Exchange, MarketTick } from '../types/domain'
import type { ScripRow, SearchResponse } from '../types/api'

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'replaying'

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
   */
  subscribeTicks(tokens: string[], onTick: (tick: MarketTick) => void): () => void

  getConnectionState(): ConnectionState
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
