export type MarketSession = 'PRE-OPEN' | 'OPEN' | 'CLOSED'

const istPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
})

const MARKET_OPEN_MINUTES = 9 * 60 + 15
const MARKET_CLOSE_MINUTES = 15 * 60 + 30
const WEEKEND_DAYS = new Set(['Sat', 'Sun'])

const IST_OFFSET_SECONDS = 330 * 60

/**
 * The "today" the universe loaders' expiry filter must be given — the TS
 * equivalent of the Python's `pd.Timestamp.now().normalize()` (midnight of
 * today's IST date), expressed the way src/strategy/universe.ts's
 * parseExpiry() expresses an expiry date: epoch seconds at UTC midnight of
 * that calendar date.
 *
 * PARITY: pass THIS to loadFnoFuturesUniverse()/loadFnoAtmOptions(), never
 * the raw clock time. The raw time compares greater than the expiry date's
 * midnight from 05:30 IST on expiry day, which would drop the expiring
 * contract a full day before the Python does.
 */
export function expiryFilterToday(nowEpochSeconds: number): number {
  const ist = new Date((nowEpochSeconds + IST_OFFSET_SECONDS) * 1000)
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) / 1000
}

export function getMarketSession(now: Date = new Date()): MarketSession {
  const parts = istPartsFormatter.formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''

  if (WEEKEND_DAYS.has(weekday)) return 'CLOSED'

  const minutesSinceMidnight = hour * 60 + minute

  if (minutesSinceMidnight < MARKET_OPEN_MINUTES) return 'PRE-OPEN'
  if (minutesSinceMidnight <= MARKET_CLOSE_MINUTES) return 'OPEN'
  return 'CLOSED'
}
