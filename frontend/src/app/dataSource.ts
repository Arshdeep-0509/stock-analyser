import { DEFAULT_FAILURE_RATE, DEFAULT_SEED, MockMarketDataSource } from '../data/mock'

/**
 * TEST HOOK: `VITE_SEED` (build-time env) pins the mock market's seed, so an
 * end-to-end run against a production build is reproducible. Unset, blank or
 * non-integer -> DEFAULT_SEED, exactly as before.
 */
export function seedFromEnv(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SEED
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) ? parsed : DEFAULT_SEED
}

/**
 * TEST HOOK: `VITE_MOCK_FAILURE_RATE` (build-time env, 0..1) sets the share of
 * mock requests that fail. The end-to-end build pins it to 0 so two scans of
 * the same market return the same rows. Unset or invalid -> the standing 2%.
 */
export function failureRateFromEnv(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_FAILURE_RATE
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_FAILURE_RATE
}

/**
 * The single place the app decides which MarketDataSource implementation is
 * active. To point at a real backend later, this is the one line that
 * changes — swap `new MockMarketDataSource()` for a real implementation of
 * the same interface. Nothing else in the app should construct a data
 * source directly.
 */
export const dataSource = new MockMarketDataSource(seedFromEnv(import.meta.env.VITE_SEED))
dataSource.setFailureRate(failureRateFromEnv(import.meta.env.VITE_MOCK_FAILURE_RATE))
