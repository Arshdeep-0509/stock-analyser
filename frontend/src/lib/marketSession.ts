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
