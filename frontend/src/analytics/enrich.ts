/**
 * Decorates an already-loaded Instrument with sector data. Deliberately a
 * separate post-processing step, not a change to src/strategy/universe.ts —
 * those loaders are a 1:1 transliteration of
 * load_nse_equity_universe()/load_fno_futures_universe()/
 * load_fno_atm_options() in mastertrust_rsi_ha_screener.py and are
 * PARITY-LOCKED (CLAUDE.md hard rule 1). See docs/SECTOR-DATA.md.
 */
import type { Instrument } from '../types/domain'
import { getSector } from '../data/reference/sectors'

/**
 * The scrip master always sets `company_name` to the base symbol for every
 * row it generates — EQ, FUTSTK and OPTSTK alike (src/data/mock/scripMaster.ts)
 * — so `companyName` is the reliable base-symbol key. Falling back to
 * stripping "-EQ" off `symbol` only covers the plain-equity case and exists
 * purely as a defensive fallback for an Instrument built without
 * `companyName` populated; it is not a substitute for the real base-symbol
 * derivation used by the FUTSTK/OPTSTK loaders themselves. Exported so
 * src/analytics/intraday.ts can key sector/index lookups off the same base
 * symbol this file uses, rather than re-deriving it.
 */
export function baseSymbolOf(instrument: Instrument): string {
  return instrument.companyName ?? instrument.symbol.replace(/-EQ$/, '')
}

export function enrichInstrument(instrument: Instrument): Instrument & { sector: string } {
  return { ...instrument, sector: getSector(baseSymbolOf(instrument)) }
}
