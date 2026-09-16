import { describe, expect, it } from 'vitest'
import type { HistoricalCandlesResponse } from '../../types/api'
import { parseHistoricalCandlesResponse } from '../parseCandles'

describe('parseHistoricalCandlesResponse', () => {
  it('coerces string-encoded OHLCV numbers and epoch-second-string timestamps', () => {
    const response: HistoricalCandlesResponse = {
      data: {
        candles: [
          ['1700000000', '100.5', '101.2', '99.8', '100.9', '12345'],
          ['1700000300', '100.9', '102.0', '100.1', '101.5', '54321'],
        ],
      },
    }

    const candles = parseHistoricalCandlesResponse(response, 5, 1700000600)

    expect(candles).toEqual([
      { time: 1700000000, open: 100.5, high: 101.2, low: 99.8, close: 100.9, volume: 12345 },
      { time: 1700000300, open: 100.9, high: 102.0, low: 100.1, close: 101.5, volume: 54321 },
    ])
  })

  it('drops the still-forming trailing candle', () => {
    const response: HistoricalCandlesResponse = {
      data: {
        candles: [
          ['0', '1', '1', '1', '1', '1'],
          ['300', '1', '1', '1', '1', '1'],
        ],
      },
    }

    // now=450 is mid-way through the bar starting at 300 (closes at 600)
    const candles = parseHistoricalCandlesResponse(response, 5, 450)
    expect(candles.map((c) => c.time)).toEqual([0])
  })

  it('sorts candles into ascending time order regardless of input order', () => {
    const response: HistoricalCandlesResponse = {
      data: {
        candles: [
          ['600', '1', '1', '1', '1', '1'],
          ['0', '1', '1', '1', '1', '1'],
          ['300', '1', '1', '1', '1', '1'],
        ],
      },
    }

    const candles = parseHistoricalCandlesResponse(response, 5, 900)
    expect(candles.map((c) => c.time)).toEqual([0, 300, 600])
  })
})
