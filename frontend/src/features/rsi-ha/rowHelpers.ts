import type { Exchange, SignalKind } from '../../types/domain'
import type { ScreenerRow } from '../../store/types'

export type InstrumentType = 'EQ' | 'FUT' | 'CE' | 'PE'

/**
 * Derived purely from exchange + signal kind — the engine never computes
 * this itself (options rows only ever arrive as "CE Buy"/"PE Buy", equity
 * signals only ever arrive on NSE, futures signals only ever arrive on
 * NFO as BUY/SELL/BREAKOUT-*), so it's a safe, lossless view-layer read.
 */
export function getInstrumentType(row: Pick<ScreenerRow, 'exchange' | 'signal'>): InstrumentType {
  if (row.signal === 'CE Buy') return 'CE'
  if (row.signal === 'PE Buy') return 'PE'
  return row.exchange === 'NFO' ? 'FUT' : 'EQ'
}

export function isDerivedRow(row: Pick<ScreenerRow, 'signal'>): boolean {
  return row.signal === 'CE Buy' || row.signal === 'PE Buy'
}

/** Percent change of the live LTP vs. the price the signal fired at. Null when no live tick has arrived yet. */
export function changePercent(row: Pick<ScreenerRow, 'price'>, liveLtp: number | undefined): number | null {
  if (liveLtp === undefined || row.price === 0) return null
  return ((liveLtp - row.price) / row.price) * 100
}

export const EXCHANGES: readonly Exchange[] = ['NSE', 'NFO']

export const SIGNAL_KINDS: readonly SignalKind[] = ['BUY', 'SELL', 'BREAKOUT-UP', 'BREAKOUT-DOWN', 'CE Buy', 'PE Buy']

export const INSTRUMENT_TYPES: readonly InstrumentType[] = ['EQ', 'FUT', 'CE', 'PE']
