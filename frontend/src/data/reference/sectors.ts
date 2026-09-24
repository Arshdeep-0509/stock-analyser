/**
 * Hand-authored sector classification for the mock equity universe. See
 * ../../../docs/SECTOR-DATA.md for why this exists: mastertrust_rsi_ha_screener.py's
 * CompactScrip.csv columns (exchange, instrument_name, trading_symbol,
 * exchange_token, close_price, expiry, company_name, strike, option_type —
 * STRATEGY-CONTRACT.md §3.3) have no sector column at all, so this mapping
 * cannot be derived from anything the strategy/universe loaders already
 * produce. It has to be supplied.
 *
 * The base symbols mapped here are exactly the ones in
 * ../mock/nseSymbols.ts (NSE_SYMBOLS) — the seed identity list the mock
 * scrip master (../mock/scripMaster.ts) draws from for every EQ/FUTSTK/
 * OPTSTK row it generates.
 */
import { NSE_SYMBOLS } from '../mock/nseSymbols'

export const SECTORS = [
  'Pharmaceuticals',
  'IT Software',
  'Refineries',
  'Finance',
  'Banks',
  'Realty',
  'Consumer Durables',
  'Gas Distribution',
  'Crude Oil Natural Gas',
  'Non Ferrous Metals',
  'Agro Chemicals',
  'Readymade Garments',
  'Capital Goods Electrical Equipment',
  'Aerospace Defence',
  'Edible Oil',
  'Logistics',
  'Telecomm Equipment',
  'E-commerce',
  'Auto',
  'FMCG',
  'Metals',
  'Plastic Products',
  'Castings Forgings Fastners',
  'Media',
  'Cement',
  'Chemicals',
  'Insurance',
  'Power',
  'Infrastructure',
  'Others',
] as const

export type Sector = (typeof SECTORS)[number]

const FALLBACK_SECTOR: Sector = 'Others'

/**
 * Explicit sector for every base symbol in NSE_SYMBOLS. Deliberately a
 * plain object literal (not generated) so each entry can be eyeballed and
 * corrected — see docs/SECTOR-DATA.md for how to regenerate/extend it.
 * Some approximations are unavoidable because the fixed sector vocabulary
 * above (taken from the dashboard screenshots) has no bucket for a few
 * real-world categories (e.g. hospitals, hotels, aviation, retail chains,
 * pure e-commerce insurance/job platforms) — those fall to 'Others', or to
 * the closest existing bucket where one plausibly fits (documented in
 * SECTOR-DATA.md, not silently guessed here).
 */
const EXPLICIT_SYMBOL_SECTOR: Readonly<Partial<Record<string, Sector>>> = {
  RELIANCE: 'Refineries',
  TCS: 'IT Software',
  INFY: 'IT Software',
  HDFCBANK: 'Banks',
  ICICIBANK: 'Banks',
  SBIN: 'Banks',
  KOTAKBANK: 'Banks',
  AXISBANK: 'Banks',
  INDUSINDBK: 'Banks',
  BAJFINANCE: 'Finance',
  BAJAJFINSV: 'Finance',
  HDFCLIFE: 'Insurance',
  SBILIFE: 'Insurance',
  ICICIPRULI: 'Insurance',
  ICICIGI: 'Insurance',
  CHOLAFIN: 'Finance',
  MUTHOOTFIN: 'Finance',
  PNB: 'Banks',
  BANKBARODA: 'Banks',
  CANBK: 'Banks',
  FEDERALBNK: 'Banks',
  IDFCFIRSTB: 'Banks',
  AUBANK: 'Banks',
  RBLBANK: 'Banks',
  SHRIRAMFIN: 'Finance',
  LICHSGFIN: 'Finance',
  PFC: 'Finance',
  RECLTD: 'Finance',
  WIPRO: 'IT Software',
  HCLTECH: 'IT Software',
  TECHM: 'IT Software',
  LTIM: 'IT Software',
  LTTS: 'IT Software',
  MPHASIS: 'IT Software',
  COFORGE: 'IT Software',
  PERSISTENT: 'IT Software',
  OFSS: 'IT Software',
  KPITTECH: 'IT Software',
  MARUTI: 'Auto',
  TATAMOTORS: 'Auto',
  'M&M': 'Auto',
  'BAJAJ-AUTO': 'Auto',
  HEROMOTOCO: 'Auto',
  EICHERMOT: 'Auto',
  TVSMOTOR: 'Auto',
  ASHOKLEY: 'Auto',
  BOSCHLTD: 'Auto',
  MRF: 'Auto',
  BALKRISIND: 'Auto',
  MOTHERSON: 'Auto',
  BHARATFORG: 'Castings Forgings Fastners',
  EXIDEIND: 'Auto',
  SUNPHARMA: 'Pharmaceuticals',
  DRREDDY: 'Pharmaceuticals',
  CIPLA: 'Pharmaceuticals',
  DIVISLAB: 'Pharmaceuticals',
  LUPIN: 'Pharmaceuticals',
  AUROPHARMA: 'Pharmaceuticals',
  TORNTPHARM: 'Pharmaceuticals',
  ALKEM: 'Pharmaceuticals',
  BIOCON: 'Pharmaceuticals',
  ZYDUSLIFE: 'Pharmaceuticals',
  GLAND: 'Pharmaceuticals',
  LAURUSLABS: 'Pharmaceuticals',
  ABBOTINDIA: 'Pharmaceuticals',
  HINDUNILVR: 'FMCG',
  ITC: 'FMCG',
  NESTLEIND: 'FMCG',
  BRITANNIA: 'FMCG',
  DABUR: 'FMCG',
  MARICO: 'FMCG',
  GODREJCP: 'FMCG',
  COLPAL: 'FMCG',
  TATACONSUM: 'FMCG',
  VBL: 'FMCG',
  UBL: 'FMCG',
  EMAMILTD: 'FMCG',
  ULTRACEMCO: 'Cement',
  SHREECEM: 'Cement',
  AMBUJACEM: 'Cement',
  ACC: 'Cement',
  DALBHARAT: 'Cement',
  JKCEMENT: 'Cement',
  RAMCOCEM: 'Cement',
  TATASTEEL: 'Metals',
  JSWSTEEL: 'Metals',
  HINDALCO: 'Non Ferrous Metals',
  VEDL: 'Non Ferrous Metals',
  JINDALSTEL: 'Metals',
  SAIL: 'Metals',
  NMDC: 'Metals',
  COALINDIA: 'Metals',
  NATIONALUM: 'Non Ferrous Metals',
  HINDZINC: 'Non Ferrous Metals',
  APLAPOLLO: 'Metals',
  ONGC: 'Crude Oil Natural Gas',
  IOC: 'Refineries',
  BPCL: 'Refineries',
  HPCL: 'Refineries',
  GAIL: 'Gas Distribution',
  PETRONET: 'Gas Distribution',
  OIL: 'Crude Oil Natural Gas',
  ADANIGREEN: 'Power',
  TATAPOWER: 'Power',
  NTPC: 'Power',
  POWERGRID: 'Power',
  ADANIENT: 'Infrastructure',
  ADANIPORTS: 'Logistics',
  LT: 'Infrastructure',
  SIEMENS: 'Capital Goods Electrical Equipment',
  ABB: 'Capital Goods Electrical Equipment',
  CUMMINSIND: 'Capital Goods Electrical Equipment',
  HAVELLS: 'Consumer Durables',
  POLYCAB: 'Capital Goods Electrical Equipment',
  BEL: 'Aerospace Defence',
  HAL: 'Aerospace Defence',
  BHEL: 'Capital Goods Electrical Equipment',
  THERMAX: 'Capital Goods Electrical Equipment',
  KEI: 'Capital Goods Electrical Equipment',
  CGPOWER: 'Capital Goods Electrical Equipment',
  TITAN: 'Consumer Durables',
  DMART: 'E-commerce',
  TRENT: 'Readymade Garments',
  PAGEIND: 'Readymade Garments',
  VOLTAS: 'Consumer Durables',
  WHIRLPOOL: 'Consumer Durables',
  BATAINDIA: 'Readymade Garments',
  RELAXO: 'Readymade Garments',
  BHARTIARTL: 'Telecomm Equipment',
  IDEA: 'Telecomm Equipment',
  INDUSTOWER: 'Telecomm Equipment',
  DLF: 'Realty',
  GODREJPROP: 'Realty',
  OBEROIRLTY: 'Realty',
  PRESTIGE: 'Realty',
  PHOENIXLTD: 'Realty',
  PIDILITIND: 'Chemicals',
  SRF: 'Chemicals',
  AARTIIND: 'Chemicals',
  DEEPAKNTR: 'Chemicals',
  UPL: 'Agro Chemicals',
  PIIND: 'Agro Chemicals',
  ATUL: 'Chemicals',
  NAVINFLUOR: 'Chemicals',
  ASIANPAINT: 'Chemicals',
  BERGEPAINT: 'Chemicals',
  GRASIM: 'Chemicals',
  INDIGO: 'Logistics',
  IRCTC: 'Logistics',
  ZOMATO: 'E-commerce',
  NYKAA: 'E-commerce',
  PAYTM: 'E-commerce',
  POLICYBZR: 'E-commerce',
  NAUKRI: 'E-commerce',
  'MCDOWELL-N': 'FMCG',
  PGHH: 'FMCG',
  GILLETTE: 'FMCG',
  ESCORTS: 'Auto',
  ASTRAL: 'Plastic Products',
  SUPREMEIND: 'Plastic Products',
  CROMPTON: 'Consumer Durables',
  DIXON: 'Consumer Durables',
  AMBER: 'Consumer Durables',
  IEX: 'Power',
  MFSL: 'Insurance',
  GODIGIT: 'Insurance',
  JUBLFOOD: 'FMCG',
  DEVYANI: 'FMCG',
  SONACOMS: 'Castings Forgings Fastners',
  TIINDIA: 'Castings Forgings Fastners',
  LODHA: 'Realty',
  CONCOR: 'Logistics',
  GMRINFRA: 'Infrastructure',
  ZEEL: 'Media',
  PVRINOX: 'Media',
  INDHOTEL: 'Others',
  LEMONTREE: 'Others',
  APOLLOHOSP: 'Others',
  MAXHEALTH: 'Others',
  FORTIS: 'Others',
}

function buildSymbolSector(): { map: Record<string, Sector>; fallbacks: string[] } {
  const map: Record<string, Sector> = {}
  const fallbacks: string[] = []

  for (const { symbol } of NSE_SYMBOLS) {
    const sector = EXPLICIT_SYMBOL_SECTOR[symbol]
    if (sector) {
      map[symbol] = sector
    } else {
      map[symbol] = FALLBACK_SECTOR
      fallbacks.push(symbol)
    }
  }

  return { map, fallbacks }
}

const { map: symbolSectorMap, fallbacks: symbolSectorFallbacks } = buildSymbolSector()

/** Every base symbol in NSE_SYMBOLS mapped to a Sector. Unmapped symbols resolve to 'Others'. */
export const SYMBOL_SECTOR: Readonly<Record<string, Sector>> = symbolSectorMap

/** Base symbols that had no explicit entry above and fell back to 'Others' — should be empty. */
export const SYMBOL_SECTOR_FALLBACKS: readonly string[] = symbolSectorFallbacks

// import.meta.env is a Vite-only global (undefined under plain Node/tsx, e.g. scripts/indexSmoke.ts).
if (import.meta.env?.DEV) {
  if (symbolSectorFallbacks.length > 0) {
    console.warn(
      `[sectors] ${symbolSectorFallbacks.length} symbol(s) had no explicit sector and fell back to 'Others':`,
      symbolSectorFallbacks,
    )
  } else {
    console.info("[sectors] 0 symbols fell back to 'Others'")
  }
}

/** Looks up a base symbol's sector, defaulting to 'Others' for anything not in NSE_SYMBOLS at all. */
export function getSector(baseSymbol: string): Sector {
  return SYMBOL_SECTOR[baseSymbol] ?? FALLBACK_SECTOR
}
