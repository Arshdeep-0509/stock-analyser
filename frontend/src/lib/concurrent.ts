/**
 * Shared by src/features/rsi-ha/scanner.ts and src/store/intradayStore.ts —
 * both pages fetch candles for their own (different) instrument universes
 * against the same bounded-concurrency MarketDataSource, and must do it the
 * same way. Do not fork a second copy of this.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    for (;;) {
      const current = nextIndex
      nextIndex += 1
      if (current >= items.length) return
      const item = items[current]
      results[current] = await fn(item, current)
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
