/**
 * The sector-index dashboard panels: which base symbols belong to each
 * index card, in the order the dashboard renders them. Like sectors.ts,
 * this is hand-authored — see ../../../docs/SECTOR-DATA.md for why
 * (mastertrust_rsi_ha_screener.py's scrip master has no index-membership
 * column at all).
 *
 * A symbol may legitimately appear in more than one panel (e.g. HDFCBANK is
 * both BANK_NIFTY and FINANCIAL) — this is modelled as many-to-many
 * (independent constituents arrays), never as a single field on Instrument.
 */
import type { IndexKey } from '../../types/domain'
import { NSE_SYMBOLS } from '../mock/nseSymbols'

export interface IndexPanel {
  key: IndexKey
  label: string
  constituents: readonly string[]
}

const NIFTY_50: readonly string[] = [
  'RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK',
  'INDUSINDBK', 'BAJFINANCE', 'BAJAJFINSV', 'HDFCLIFE', 'SBILIFE', 'WIPRO', 'HCLTECH',
  'TECHM', 'LTIM', 'MARUTI', 'TATAMOTORS', 'M&M', 'BAJAJ-AUTO', 'HEROMOTOCO', 'EICHERMOT',
  'SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'HINDUNILVR', 'ITC', 'NESTLEIND',
  'BRITANNIA', 'TATACONSUM', 'ULTRACEMCO', 'GRASIM', 'TATASTEEL', 'JSWSTEEL', 'HINDALCO',
  'ONGC', 'BPCL', 'COALINDIA', 'NTPC', 'POWERGRID', 'ADANIENT', 'ADANIPORTS', 'LT',
  'TITAN', 'BHARTIARTL', 'APOLLOHOSP', 'ASIANPAINT', 'TRENT',
]

const BANK_NIFTY: readonly string[] = [
  'HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK', 'PNB',
  'BANKBARODA', 'CANBK', 'FEDERALBNK', 'IDFCFIRSTB', 'AUBANK',
]

const METAL: readonly string[] = [
  'TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'VEDL', 'JINDALSTEL', 'SAIL', 'NMDC', 'COALINDIA',
  'NATIONALUM', 'HINDZINC', 'APLAPOLLO',
]

const PHARMA: readonly string[] = [
  'SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'LUPIN', 'AUROPHARMA', 'TORNTPHARM',
  'ALKEM', 'BIOCON', 'ZYDUSLIFE', 'GLAND', 'LAURUSLABS', 'ABBOTINDIA',
]

const PSU_BANK: readonly string[] = ['SBIN', 'PNB', 'BANKBARODA', 'CANBK']

const PVT_BANK: readonly string[] = [
  'HDFCBANK', 'ICICIBANK', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK', 'FEDERALBNK',
  'IDFCFIRSTB', 'AUBANK', 'RBLBANK',
]

const AUTO: readonly string[] = [
  'MARUTI', 'TATAMOTORS', 'M&M', 'BAJAJ-AUTO', 'HEROMOTOCO', 'EICHERMOT', 'TVSMOTOR',
  'ASHOKLEY', 'BOSCHLTD', 'MRF', 'BALKRISIND', 'MOTHERSON', 'EXIDEIND', 'ESCORTS',
]

const FINANCIAL: readonly string[] = [
  'BAJFINANCE', 'BAJAJFINSV', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK',
  'HDFCLIFE', 'SBILIFE', 'ICICIPRULI', 'ICICIGI', 'CHOLAFIN', 'MUTHOOTFIN', 'SHRIRAMFIN',
  'PFC', 'RECLTD', 'MFSL', 'LICHSGFIN', 'GODIGIT', 'POLICYBZR',
]

const FMCG: readonly string[] = [
  'HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'DABUR', 'MARICO', 'GODREJCP', 'COLPAL',
  'TATACONSUM', 'VBL', 'UBL', 'EMAMILTD', 'MCDOWELL-N', 'PGHH', 'GILLETTE', 'JUBLFOOD',
  'DEVYANI',
]

const IT: readonly string[] = [
  'TCS', 'INFY', 'WIPRO', 'HCLTECH', 'TECHM', 'LTIM', 'LTTS', 'MPHASIS', 'COFORGE',
  'PERSISTENT', 'OFSS', 'KPITTECH',
]

const REALTY: readonly string[] = [
  'DLF', 'GODREJPROP', 'OBEROIRLTY', 'PRESTIGE', 'PHOENIXLTD', 'LODHA',
]

const NAMED_PANELS: readonly Omit<IndexPanel, 'constituents'>[] = [
  { key: 'NIFTY_50', label: 'NIFTY 50' },
  { key: 'BANK_NIFTY', label: 'BANK NIFTY' },
  { key: 'METAL', label: 'METAL' },
  { key: 'PHARMA', label: 'PHARMA' },
  { key: 'PSU_BANK', label: 'PSU BANK' },
  { key: 'PVT_BANK', label: 'PVT BANK' },
  { key: 'AUTO', label: 'AUTO' },
  { key: 'FINANCIAL', label: 'FINANCIAL' },
  { key: 'FMCG', label: 'FMCG' },
  { key: 'IT', label: 'IT' },
  { key: 'REALTY', label: 'REALTY' },
]

const NAMED_CONSTITUENTS: Readonly<Record<Exclude<IndexKey, 'OTHERS'>, readonly string[]>> = {
  NIFTY_50,
  BANK_NIFTY,
  METAL,
  PHARMA,
  PSU_BANK,
  PVT_BANK,
  AUTO,
  FINANCIAL,
  FMCG,
  IT,
  REALTY,
}

function buildOthers(): readonly string[] {
  const named = new Set<string>()
  for (const constituents of Object.values(NAMED_CONSTITUENTS)) {
    for (const symbol of constituents) named.add(symbol)
  }
  return NSE_SYMBOLS.map((s) => s.symbol).filter((symbol) => !named.has(symbol))
}

/**
 * The dashboard's index cards, in display order. OTHERS is computed, not
 * hand-listed: every base symbol in the mock universe (NSE_SYMBOLS) that
 * isn't already a constituent of one of the 11 named panels above. See
 * docs/SECTOR-DATA.md for the caveat that this uses the full mock equity
 * universe as a stand-in for "every F&O underlying", since real F&O
 * eligibility is decided per-seed at scrip-master generation time
 * (src/data/mock/scripMaster.ts), not statically.
 */
export const INDEX_PANELS: readonly IndexPanel[] = [
  ...NAMED_PANELS.map((panel) => ({ ...panel, constituents: NAMED_CONSTITUENTS[panel.key as Exclude<IndexKey, 'OTHERS'>] })),
  { key: 'OTHERS', label: 'OTHERS', constituents: buildOthers() },
]

/**
 * Every panel a base symbol belongs to, in INDEX_PANELS' display order.
 * Many-to-many by construction (see the module doc comment) — a symbol
 * commonly appears in more than one panel (e.g. HDFCBANK is both
 * BANK_NIFTY and FINANCIAL), and this returns all of them, not just the
 * first match.
 */
export function indicesForSymbol(baseSymbol: string): IndexKey[] {
  return INDEX_PANELS.filter((panel) => panel.constituents.includes(baseSymbol)).map((panel) => panel.key)
}
