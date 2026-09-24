import type { ScripRow } from '../../types/api'
import { NSE_SYMBOLS } from './nseSymbols'
import { deriveSeed, mulberry32, randomFloat, shuffle } from './rng'

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export function formatExpiry(year: number, month0: number, day: number): string {
  const abbr = MONTH_ABBR[month0]
  return `${String(day).padStart(2, '0')}-${abbr}-${year}`
}

function toIstYmd(epochSeconds: number): { year: number; month0: number; day: number } {
  const istMs = epochSeconds * 1000 + (5 * 60 + 30) * 60 * 1000
  const d = new Date(istMs)
  return { year: d.getUTCFullYear(), month0: d.getUTCMonth(), day: d.getUTCDate() }
}

function addMonths(year: number, month0: number, delta: number): { year: number; month0: number } {
  const total = year * 12 + month0 + delta
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 }
}

export function lastThursday(year: number, month0: number): { year: number; month0: number; day: number } {
  const daysInMonth = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
  let day = daysInMonth
  while (new Date(Date.UTC(year, month0, day)).getUTCDay() !== 4) {
    day -= 1
  }
  return { year, month0, day }
}

function strikeStepFor(spot: number): number {
  if (spot < 1000) return 20
  if (spot < 3000) return 50
  if (spot < 7000) return 100
  if (spot < 20000) return 250
  return 500
}

let tokenCounter = 0
function nextToken(): string {
  tokenCounter += 1
  return String(100000 + tokenCounter)
}

export interface ScripMasterOptions {
  seed: number
  /** Epoch seconds — anchors "current month" / "already expired" relative to this instant. */
  referenceNow: number
}

export interface ScripMasterResult {
  rows: ScripRow[]
  /** Base symbols (no "-EQ") chosen to have F&O futures — useful for tests. */
  futuresEligible: string[]
  /** Base symbols chosen to have an ATM options chain. */
  optionsEligible: string[]
  /** The one base symbol whose ATM strike is missing a PE leg, by design. */
  missingPeCompany: string | null
}

/**
 * Generates a deterministic, seeded scrip master with realistic Indian
 * market identity. Nothing here is wired to a strategy outcome — prices,
 * expiries and strikes come purely from the seed; whether any of it
 * produces a signal is decided later, by running the real strategy engine
 * (src/strategy/) over generated candles.
 */
export function generateScripMaster(options: ScripMasterOptions): ScripMasterResult {
  tokenCounter = 0
  const rng = mulberry32(deriveSeed(options.seed, 'scripMaster'))
  const today = toIstYmd(options.referenceNow)

  const shuffled = shuffle(rng, NSE_SYMBOLS)
  const targetHighCount = Math.round(0.6 * shuffled.length)

  const rows: ScripRow[] = []
  const equityBySymbol = new Map<string, { closePrice: number; token: string }>()

  shuffled.forEach((entry, index) => {
    const isHighTier = index < targetHighCount
    const closePrice = isHighTier
      ? Math.round(Math.exp(randomFloat(rng, Math.log(2000), Math.log(90000))) * 100) / 100
      : Math.round(Math.exp(randomFloat(rng, Math.log(200), Math.log(1999))) * 100) / 100

    const token = nextToken()
    equityBySymbol.set(entry.symbol, { closePrice, token })

    rows.push({
      exchange: 'NSE',
      instrument_name: 'EQ',
      trading_symbol: `${entry.symbol}-EQ`,
      exchange_token: token,
      close_price: String(closePrice),
      expiry: '',
      company_name: entry.symbol,
      strike: '',
      option_type: '',
    })
  })

  // F&O futures: preferentially the high-tier (liquid, >= MIN_PRICE) names —
  // real F&O eligibility correlates with liquidity/price the same way.
  const highTierSymbols = shuffled.slice(0, targetHighCount).map((s) => s.symbol)
  const futuresPool = highTierSymbols.length >= 90 ? highTierSymbols : shuffled.map((s) => s.symbol)
  const futuresEligible = shuffle(rng, futuresPool).slice(0, Math.min(90, futuresPool.length))

  const currentMonth = { year: today.year, month0: today.month0 }
  const nextMonth = addMonths(today.year, today.month0, 1)
  const farMonth = addMonths(today.year, today.month0, 2)
  const priorMonth = addMonths(today.year, today.month0, -1)

  const expiryMonths = [currentMonth, nextMonth, farMonth].map((m) => lastThursday(m.year, m.month0))

  futuresEligible.forEach((symbol, index) => {
    const equity = equityBySymbol.get(symbol)
    if (!equity) return

    // Futures close price is generated independently of the cached equity
    // close — both are just snapshots, they're allowed to differ slightly.
    const futClose = Math.round(equity.closePrice * randomFloat(rng, 0.98, 1.02) * 100) / 100

    for (const exp of expiryMonths) {
      rows.push({
        exchange: 'NFO',
        instrument_name: 'FUTSTK',
        trading_symbol: `${symbol}${String(exp.year).slice(2)}${MONTH_ABBR[exp.month0].toUpperCase()}FUT`,
        exchange_token: nextToken(),
        close_price: String(futClose),
        expiry: formatExpiry(exp.year, exp.month0, exp.day),
        company_name: symbol,
        strike: '',
        option_type: '',
      })
    }

    // A handful of already-expired contracts, so the expiry filter is genuinely exercised.
    if (index < 5) {
      const expired = lastThursday(priorMonth.year, priorMonth.month0)
      rows.push({
        exchange: 'NFO',
        instrument_name: 'FUTSTK',
        trading_symbol: `${symbol}${String(expired.year).slice(2)}${MONTH_ABBR[expired.month0].toUpperCase()}FUT`,
        exchange_token: nextToken(),
        close_price: String(futClose),
        expiry: formatExpiry(expired.year, expired.month0, expired.day),
        company_name: symbol,
        strike: '',
        option_type: '',
      })
    }
  })

  // Options chains for ~60 underlyings, drawn from the futures-eligible pool
  // (realistic: only F&O stocks have options).
  const optionsEligible = shuffle(rng, futuresEligible).slice(0, Math.min(60, futuresEligible.length))
  const nearestExpiry = expiryMonths[0]
  if (nearestExpiry === undefined) {
    throw new Error('generateScripMaster: expiryMonths must be non-empty')
  }

  let missingPeCompany: string | null = null

  optionsEligible.forEach((symbol, index) => {
    const equity = equityBySymbol.get(symbol)
    if (!equity) return

    const spot = equity.closePrice
    const step = strikeStepFor(spot)
    const atmStrike = Math.round(spot / step) * step
    const isMissingPeCompany = index === 0

    for (let offset = -5; offset <= 5; offset++) {
      const strike = atmStrike + offset * step
      const isAtmStrike = offset === 0

      for (const optionType of ['CE', 'PE'] as const) {
        if (isMissingPeCompany && isAtmStrike && optionType === 'PE') {
          continue
        }
        rows.push({
          exchange: 'NFO',
          instrument_name: 'OPTSTK',
          trading_symbol: `${symbol}${String(nearestExpiry.year).slice(2)}${MONTH_ABBR[nearestExpiry.month0].toUpperCase()}${strike}${optionType}`,
          exchange_token: nextToken(),
          close_price: String(Math.max(0.05, Math.round(randomFloat(rng, 5, 250) * 100) / 100)),
          expiry: formatExpiry(nearestExpiry.year, nearestExpiry.month0, nearestExpiry.day),
          company_name: symbol,
          strike: String(strike),
          option_type: optionType,
        })
      }
    }

    if (isMissingPeCompany) {
      missingPeCompany = symbol
    }
  })

  return { rows, futuresEligible, optionsEligible, missingPeCompany }
}
