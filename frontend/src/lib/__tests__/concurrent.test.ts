import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '../concurrent'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('mapWithConcurrency', () => {
  it('returns results in input order regardless of completion order', async () => {
    const items = [30, 10, 20, 5]
    const results = await mapWithConcurrency(items, 4, async (ms) => {
      await delay(ms)
      return ms
    })
    expect(results).toEqual([30, 10, 20, 5])
  })

  it('never runs more than `limit` calls concurrently', async () => {
    let active = 0
    let maxActive = 0
    const items = Array.from({ length: 20 }, (_, i) => i)

    await mapWithConcurrency(items, 3, async (i) => {
      active++
      maxActive = Math.max(maxActive, active)
      await delay(5)
      active--
      return i
    })

    expect(maxActive).toBeLessThanOrEqual(3)
  })

  it('handles an empty item list without hanging', async () => {
    const results = await mapWithConcurrency([], 5, async (i: number) => i)
    expect(results).toEqual([])
  })

  it('handles a limit larger than the item count', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 100, async (i) => i * 2)
    expect(results).toEqual([2, 4, 6])
  })

  it('propagates a rejection from any worker', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (i) => {
        if (i === 2) throw new Error('boom')
        return i
      }),
    ).rejects.toThrow('boom')
  })
})
