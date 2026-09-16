import { describe, expect, it } from 'vitest'
import { addOptionRecommendations } from '../optionLegs'
import type { AtmMap } from '../universe'
import type { Candle, SignalRow } from '../../types/domain'

function signalRow(overrides: Partial<SignalRow> = {}): SignalRow {
  return {
    id: 'row-1',
    symbol: 'RELIANCE-EQ',
    exchange: 'NSE',
    signal: 'BUY',
    price: 2500,
    rsi: 61.5,
    time: 1_700_000_000,
    ...overrides,
  }
}

const ATM_MAP: AtmMap = {
  RELIANCE: { CE: ['RELIANCE26JAN2500CE', '10'], PE: ['RELIANCE26JAN2500PE', '11'] },
}

function candles(closes: number[]): Candle[] {
  return closes.map((close, i) => ({ time: i * 300, open: close, high: close, low: close, close, volume: 0 }))
}

describe('addOptionRecommendations', () => {
  it('BUY -> CE Buy, priced from the option candles own last close, rsi/time copied from the underlying', async () => {
    const rows = [signalRow({ signal: 'BUY', rsi: 61.5, time: 12345 })]
    const getCandles = async (token: string) => candles(token === '10' ? [45, 47.5] : [])
    const result = await addOptionRecommendations(rows, ATM_MAP, getCandles)
    expect(result).toEqual([
      {
        id: 'RELIANCE26JAN2500CE-12345',
        symbol: 'RELIANCE26JAN2500CE',
        exchange: 'NFO',
        signal: 'CE Buy',
        price: 47.5,
        rsi: 61.5,
        time: 12345,
        derivedFrom: 'RELIANCE-EQ',
      },
    ])
  })

  it('SELL -> PE Buy', async () => {
    const rows = [signalRow({ signal: 'SELL' })]
    const getCandles = async () => candles([30, 28.25])
    const result = await addOptionRecommendations(rows, ATM_MAP, getCandles)
    expect(result[0]?.signal).toBe('PE Buy')
    expect(result[0]?.symbol).toBe('RELIANCE26JAN2500PE')
    expect(result[0]?.price).toBe(28.25)
  })

  it('skips breakout rows — only BUY/SELL ever get an option leg', async () => {
    const rows = [signalRow({ signal: 'BREAKOUT-UP' })]
    const result = await addOptionRecommendations(rows, ATM_MAP, async () => candles([1]))
    expect(result).toEqual([])
  })

  it('skips non-NSE rows (a futures row can never derive an option leg)', async () => {
    const rows = [signalRow({ exchange: 'NFO', symbol: 'RELIANCE26JANFUT' })]
    const result = await addOptionRecommendations(rows, ATM_MAP, async () => candles([1]))
    expect(result).toEqual([])
  })

  it('skips a symbol with no ATM entry at all', async () => {
    const rows = [signalRow({ symbol: 'UNKNOWNCO-EQ' })]
    const result = await addOptionRecommendations(rows, ATM_MAP, async () => candles([1]))
    expect(result).toEqual([])
  })

  it('produces one row per qualifying signal, preserving input order', async () => {
    const rows = [signalRow({ id: 'a', symbol: 'RELIANCE-EQ', signal: 'BUY', time: 1 }), signalRow({ id: 'b', symbol: 'RELIANCE-EQ', signal: 'SELL', time: 2 })]
    const result = await addOptionRecommendations(rows, ATM_MAP, async () => candles([100]))
    expect(result.map((r) => r.signal)).toEqual(['CE Buy', 'PE Buy'])
  })
})
