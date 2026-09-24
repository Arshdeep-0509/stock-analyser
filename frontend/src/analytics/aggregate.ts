/**
 * Pure functions turning IntradayRow[] into the /intraday dashboard's
 * header charts. Every one of these — the ±0.5% "flat" band, the fold of
 * small sectors into 'Others', "smart money" meaning a crowding count and
 * nothing about order flow — is a definition WE are choosing (none of it
 * comes from mastertrust_rsi_ha_screener.py, which has no notion of a
 * sector or a market-wide meter at all). That's why every function has a
 * doc comment explaining its definition AND a paired *_TOOLTIP string for
 * whatever UI renders it, so a viewer never has to guess what a chart
 * means from its title alone.
 *
 * No formatting, no colours, no React here — every function takes rows
 * (+ options) and returns plain data. Numbers are full precision; NaN
 * inputs (see IntradayRow's own NaN-propagation contract) are EXCLUDED
 * from any mean, never coerced to 0 — a stock with too little history to
 * have a Strength value must not silently drag a sector's average down to
 * zero.
 */
import type { IndexKey, IntradayRow } from '../types/domain'
import type { IndexPanel } from '../data/reference/indices'

function groupBySector(rows: readonly IntradayRow[]): Map<string, IntradayRow[]> {
  const map = new Map<string, IntradayRow[]>()
  for (const row of rows) {
    const list = map.get(row.sector)
    if (list) list.push(row)
    else map.set(row.sector, [row])
  }
  return map
}

/** Arithmetic mean, skipping NaN entries entirely. NaN (not 0) if nothing finite remains. Exported so every consumer that needs "the mean Strength of a row set" (sectorStrength() below, sectorCardSummaries(), and SectorGrid's own per-card header number) computes it the exact same way. */
export function meanExcludingNaN(values: readonly number[]): number {
  const finite = values.filter((v) => !Number.isNaN(v))
  if (finite.length === 0) return NaN
  return finite.reduce((sum, v) => sum + v, 0) / finite.length
}

/** Descending by value; NaN sorts to the end (a comparator returning `b - a` would otherwise leave NaN's position unspecified and equal-looking finite values could jump around it). */
function sortDescendingNaNLast<T>(entries: T[], valueOf: (entry: T) => number): T[] {
  return entries.sort((a, b) => {
    const av = valueOf(a)
    const bv = valueOf(b)
    if (Number.isNaN(av) && Number.isNaN(bv)) return 0
    if (Number.isNaN(av)) return 1
    if (Number.isNaN(bv)) return -1
    return bv - av
  })
}

const TOP_CONSTITUENTS_COUNT = 3

/** Up to `count` rows by Strength descending, NaN Strength excluded entirely (never sorted-in-as-worst) — shared by indexMeter() and sectorStrength() so a hover tooltip's "top names" can never mean two different things depending on which chart it's on. */
function topByStrength(rows: readonly IntradayRow[], count = TOP_CONSTITUENTS_COUNT): IntradayRow[] {
  return rows
    .filter((r) => !Number.isNaN(r.strength))
    .slice()
    .sort((a, b) => b.strength - a.strength)
    .slice(0, count)
}

// ---------------------------------------------------------------------------
// 1. marketMeter
// ---------------------------------------------------------------------------

/** ±% move beyond which a name counts as Up/Down rather than flat — MarketMeter's and IndexMeter's default. Our own choice, not a market convention. */
export const MARKET_METER_DEFAULT_THRESHOLD = 0.5

export interface MarketMeterResult {
  upPct: number
  downPct: number
  upCount: number
  downCount: number
  /** total - upCount - downCount: everything strictly inside the ±threshold band, INCLUDING any row with a NaN changePct (not enough history yet) — both read as "can't call it a move" the same way. */
  flatCount: number
  total: number
}

/**
 * Share of the WHOLE universe moving beyond ±threshold%, as percentages of
 * `rows.length` — not of "moving stocks", which is why upPct + downPct do
 * not sum to 100. Anything strictly between -threshold and +threshold is
 * "flat" and deliberately left out of both buckets (matches the reference
 * dashboard: UP 25% / Down 14%, the missing 61% being the flat band plus
 * anything with no computable changePct yet). Raw counts are exposed
 * alongside the percentages for the "<n> of <total> up, <m> down, <k> flat"
 * text line — computed once, here, rather than re-derived at the UI layer.
 */
export function marketMeter(rows: readonly IntradayRow[], threshold = MARKET_METER_DEFAULT_THRESHOLD): MarketMeterResult {
  const total = rows.length
  if (total === 0) return { upPct: 0, downPct: 0, upCount: 0, downCount: 0, flatCount: 0, total: 0 }

  const upCount = rows.filter((r) => r.changePct >= threshold).length
  const downCount = rows.filter((r) => r.changePct <= -threshold).length
  const flatCount = total - upCount - downCount

  return { upPct: (upCount / total) * 100, downPct: (downCount / total) * 100, upCount, downCount, flatCount, total }
}

export const MARKET_METER_TOOLTIP =
  'Share of every scanned instrument moving at least ±threshold% today. The band between -threshold% and +threshold% counts as flat and is not shown, so Up% and Down% do not add up to 100%.'

// ---------------------------------------------------------------------------
// 2. indexMeter
// ---------------------------------------------------------------------------

export interface IndexMeterEntry {
  key: IndexKey
  label: string
  upPct: number
  downPct: number
  /** How many rows belong to this index — the hover tooltip's "constituent count". */
  count: number
  /** Up to the top 3 constituents by Strength (NaN Strength excluded), for the hover tooltip. Fewer than 3 if the index has fewer eligible rows. */
  topConstituents: IntradayRow[]
}

/**
 * Like marketMeter, but scoped to each index's OWN constituents: upPct/
 * downPct are shares of that index's rows (via IntradayRow.indices
 * membership), not of the whole universe. `indices` is the list of panels
 * to render — pass INDEX_PANELS (src/data/reference/indices.ts) for the
 * dashboard's full set, or a subset for a single card.
 */
export function indexMeter(rows: readonly IntradayRow[], indices: readonly IndexPanel[], threshold = MARKET_METER_DEFAULT_THRESHOLD): IndexMeterEntry[] {
  return indices.map((panel) => {
    const constituents = rows.filter((r) => r.indices.includes(panel.key))
    const { upPct, downPct } = marketMeter(constituents, threshold)
    return { key: panel.key, label: panel.label, upPct, downPct, count: constituents.length, topConstituents: topByStrength(constituents) }
  })
}

export const INDEX_METER_TOOLTIP =
  "Share of THIS index's own constituents moving at least ±threshold% today — the same flat-band definition as the market-wide meter, just scoped to this index."

// ---------------------------------------------------------------------------
// 3. sectorStrength
// ---------------------------------------------------------------------------

export const MIN_SECTOR_CONSTITUENTS = 3
const OTHERS_SECTOR = 'Others'

export interface SectorStrengthEntry {
  sector: string
  meanStrength: number
  /** How many rows this bucket actually contains, after any fold into 'Others' — shown so a viewer can tell a genuine sector average from a small-sample fold. */
  count: number
  /** Up to the top 3 constituents of THIS bucket by Strength (NaN excluded), for the hover tooltip. For a folded 'Others' bucket these are the strongest names across every folded sector combined. */
  topConstituents: IntradayRow[]
}

export interface SectorStrengthOptions {
  /**
   * Caps the number of NAMED sector bars; every sector beyond this rank
   * (by mean Strength, after the <3-constituent fold below has already
   * run) folds into one combined 'Others' bar — merged with that fold's
   * own 'Others' bucket if it also exists, never a second "Others" bar.
   * Undefined (the default) applies no cap, for a consumer that wants
   * every sector (there is no reference dashboard limit for that case).
   */
  topN?: number
}

/**
 * Mean Strength per sector, descending. A sector with fewer than 3
 * constituents is folded into 'Others' first — otherwise a single loud
 * stock could top this chart purely by being alone in its sector. Rows
 * with a NaN Strength (not enough session history — see
 * src/analytics/strength.ts) are excluded from the mean, not counted as 0;
 * a sector whose every row is NaN reports meanStrength: NaN and sorts last.
 * `options.topN` (e.g. 10 for the chart) additionally folds every sector
 * past that rank into 'Others' too, re-deriving its mean from the ACTUAL
 * combined rows (never a mean-of-means), so the number stays honest.
 */
export function sectorStrength(rows: readonly IntradayRow[], options: SectorStrengthOptions = {}): SectorStrengthEntry[] {
  const bySector = groupBySector(rows)

  const folded = new Map<string, IntradayRow[]>()
  for (const [sector, sectorRows] of bySector) {
    const target = sectorRows.length < MIN_SECTOR_CONSTITUENTS ? OTHERS_SECTOR : sector
    const existing = folded.get(target)
    if (existing) existing.push(...sectorRows)
    else folded.set(target, [...sectorRows])
  }

  let buckets = sortDescendingNaNLast(
    Array.from(folded.entries()).map(([sector, sectorRows]) => ({ sector, sectorRows, mean: meanExcludingNaN(sectorRows.map((r) => r.strength)) })),
    (b) => b.mean,
  )

  if (options.topN !== undefined && buckets.length > options.topN) {
    const kept = buckets.slice(0, options.topN)
    const overflowRows = buckets.slice(options.topN).flatMap((b) => b.sectorRows)

    const existingOthers = kept.find((b) => b.sector === OTHERS_SECTOR)
    if (existingOthers) {
      existingOthers.sectorRows = [...existingOthers.sectorRows, ...overflowRows]
      existingOthers.mean = meanExcludingNaN(existingOthers.sectorRows.map((r) => r.strength))
      buckets = kept
    } else {
      buckets = [...kept, { sector: OTHERS_SECTOR, sectorRows: overflowRows, mean: meanExcludingNaN(overflowRows.map((r) => r.strength)) }]
    }
  }

  const entries: SectorStrengthEntry[] = buckets.map((b) => ({
    sector: b.sector,
    meanStrength: b.mean,
    count: b.sectorRows.length,
    topConstituents: topByStrength(b.sectorRows),
  }))

  return sortDescendingNaNLast(entries, (e) => e.meanStrength)
}

export const SECTOR_STRENGTH_TOOLTIP =
  "Mean Strength per sector (our own metric — see the Strength column's own tooltip). Sectors with fewer than 3 names are grouped into 'Others' so a single stock can't top this chart alone. Stocks without enough history for a Strength value are left out of the average, not counted as zero."

// ---------------------------------------------------------------------------
// 4. smartMoney
// ---------------------------------------------------------------------------

/** smartMoney()'s own defaults, exported so `filters.smartMoneyOnly` (src/store/intradayStore.ts) tests every row against the EXACT same crowding definition rather than a second copy of the numbers 2 and 1. */
export const SMART_MONEY_DEFAULT_MIN_RVOL = 2
export const SMART_MONEY_DEFAULT_MIN_ZMOVE = 1

export interface SmartMoneyOptions {
  minRvol?: number
  minZMove?: number
}

export interface SmartMoneyEntry {
  sector: string
  count: number
  /** The actual qualifying rows in this sector — for the hover list (symbol + rvol + zMove) and for "click filters to these names specifically", never the whole sector. */
  matches: IntradayRow[]
}

/**
 * Per sector, the COUNT of rows showing both unusual participation
 * (rvol >= minRvol) and an unusual move (|zMove| >= minZMove) at once —
 * both from src/analytics/strength.ts. Top 5 sectors, descending by count.
 *
 * This is a crowding count: how many names in a sector look unusual by our
 * own volume/move definitions RIGHT NOW. It is NOT a claim about seeing
 * institutional order flow, and the tooltip says so explicitly — nothing
 * in this codebase can observe who is actually trading.
 */
export function smartMoney(rows: readonly IntradayRow[], options: SmartMoneyOptions = {}): SmartMoneyEntry[] {
  const minRvol = options.minRvol ?? SMART_MONEY_DEFAULT_MIN_RVOL
  const minZMove = options.minZMove ?? SMART_MONEY_DEFAULT_MIN_ZMOVE

  const matching = rows.filter((r) => r.rvol >= minRvol && Math.abs(r.zMove) >= minZMove)
  const bySector = groupBySector(matching)
  const entries: SmartMoneyEntry[] = Array.from(bySector.entries()).map(([sector, sectorRows]) => ({
    sector,
    count: sectorRows.length,
    matches: sectorRows,
  }))

  return entries.sort((a, b) => b.count - a.count).slice(0, 5)
}

export const SMART_MONEY_SUBTITLE = 'Sectors with the most names showing unusual volume alongside an unusual move.'

/** The tooltip text depends on the LIVE thresholds (the panel has adjustable rvol/z-move controls), so this is a function, not a fixed string. */
export function smartMoneyTooltip(minRvol: number, minZMove: number): string {
  return `rvol ≥ ${minRvol} and |z-move| ≥ ${minZMove} — computed from price and volume only. This is a crowding measure, not order-flow data; we cannot see who is buying.`
}

// ---------------------------------------------------------------------------
// 5. intradayIndex
// ---------------------------------------------------------------------------

export type IntradayIndexWeighting = 'equal' | 'cap'
export type IntradayIndexPriceBasis = 'prevClose' | 'dayOpen'

export interface IntradayIndexOptions {
  /**
   * 'equal' (default): a simple mean across the sector's rows. 'cap':
   * weighted by each row's `cachedClose` (Instrument.cachedClose carried
   * through IntradayRow — a scrip-master SNAPSHOT close, not a real market
   * cap; see CAP_WEIGHT_CAVEAT). A row with a non-finite or non-positive
   * cachedClose contributes zero weight rather than poisoning the sum with
   * a NaN.
   */
  weighting?: IntradayIndexWeighting
  /**
   * 'prevClose' (default): reuses row.changePct as-is. 'dayOpen': computes
   * (cmp / dayOpen - 1) * 100 here, from fields computeIntradayRow() already
   * produced — never a fresh price lookup. NaN wherever dayOpen is NaN or 0
   * (no bar has closed yet today).
   */
  priceBasis?: IntradayIndexPriceBasis
}

export interface IntradayIndexEntry {
  sector: string
  meanChangePct: number
  count: number
  /** The row with the single highest change (under the selected priceBasis) plus that value, for the hover tooltip's "best constituent". Null if every row's change is NaN. */
  best: { row: IntradayRow; changePct: number } | null
  /** Same as `best`, lowest change. */
  worst: { row: IntradayRow; changePct: number } | null
  breakoutUpCount: number
  breakoutDownCount: number
}

function changeValueFor(row: IntradayRow, priceBasis: IntradayIndexPriceBasis): number {
  if (priceBasis === 'prevClose') return row.changePct
  if (Number.isNaN(row.dayOpen) || row.dayOpen === 0) return NaN
  return (row.cmp / row.dayOpen - 1) * 100
}

function capWeightOf(row: IntradayRow): number {
  return Number.isFinite(row.cachedClose) && row.cachedClose > 0 ? row.cachedClose : 0
}

/**
 * Mean change per sector, descending — rendered as diverging bars (green
 * above zero, red below) by IntradayIndexChart. Unlike sectorStrength,
 * sectors are NOT folded into 'Others' here: a small sector's average move
 * is still its own average move, not a conviction ranking a single loud
 * name could otherwise dominate.
 *
 * `options.priceBasis` picks which per-row change value feeds both the mean
 * and best/worst. `options.weighting: 'cap'` weights that mean by each
 * row's cachedClose instead of counting every row equally — switching it
 * visibly reorders the chart, which is the point: it proves the number is
 * computed, not decorative.
 *
 * NaN change rows are excluded from the mean and from best/worst, never
 * treated as 0. A sector whose every row is NaN reports meanChangePct: NaN,
 * best: null, worst: null, and sorts last.
 */
export function intradayIndex(rows: readonly IntradayRow[], options: IntradayIndexOptions = {}): IntradayIndexEntry[] {
  const weighting = options.weighting ?? 'equal'
  const priceBasis = options.priceBasis ?? 'prevClose'

  const bySector = groupBySector(rows)
  const entries: IntradayIndexEntry[] = Array.from(bySector.entries()).map(([sector, sectorRows]) => {
    const changes = sectorRows
      .map((row) => ({ row, changePct: changeValueFor(row, priceBasis) }))
      .filter((c) => !Number.isNaN(c.changePct))

    let meanChangePct: number
    if (changes.length === 0) {
      meanChangePct = NaN
    } else if (weighting === 'cap') {
      const totalWeight = changes.reduce((sum, c) => sum + capWeightOf(c.row), 0)
      meanChangePct = totalWeight > 0 ? changes.reduce((sum, c) => sum + c.changePct * capWeightOf(c.row), 0) / totalWeight : NaN
    } else {
      meanChangePct = changes.reduce((sum, c) => sum + c.changePct, 0) / changes.length
    }

    const sortedByChange = changes.sort((a, b) => b.changePct - a.changePct)
    const best = sortedByChange.length > 0 ? sortedByChange[0] : null
    const worst = sortedByChange.length > 0 ? sortedByChange[sortedByChange.length - 1] : null

    return {
      sector,
      meanChangePct,
      count: sectorRows.length,
      best,
      worst,
      breakoutUpCount: sectorRows.filter((r) => r.breakout === 'BREAKOUT-UP').length,
      breakoutDownCount: sectorRows.filter((r) => r.breakout === 'BREAKOUT-DOWN').length,
    }
  })

  return sortDescendingNaNLast(entries, (e) => e.meanChangePct)
}

export const CAP_WEIGHT_CAVEAT =
  "\"Cap-weight\" here means weighted by each stock's cached close price from the instrument master — a snapshot from whenever the scrip master was last refreshed, not a real, live market capitalisation."

/** The tooltip text depends on the LIVE weighting/basis controls, so this is a function, not a fixed string — same rationale as smartMoneyTooltip. */
export function intradayIndexTooltip(weighting: IntradayIndexWeighting, priceBasis: IntradayIndexPriceBasis): string {
  const basisText = priceBasis === 'dayOpen' ? "today's session open" : "the prior session's close"
  const weightText = weighting === 'cap' ? 'weighted by cached close price (cap-weight, approx. — see the toggle\'s own note)' : 'equal-weighted across constituents'
  return `Mean change vs ${basisText} per sector, ${weightText}.`
}

// ---------------------------------------------------------------------------
// 6. breakoutCountsBySector
// ---------------------------------------------------------------------------

export type BreakoutDirection = 'BREAKOUT-UP' | 'BREAKOUT-DOWN'

export interface BreakoutCountEntry {
  sector: string
  count: number
}

/**
 * Count of rows currently flagged BREAKOUT-UP (or BREAKOUT-DOWN) per
 * sector, top 5 descending — the small bar charts beside the Breakout /
 * BreakDown tables. `breakout` comes straight from
 * src/strategy/signals.ts checkBreakout() via computeIntradayRow(); this
 * function only counts and groups, it never re-evaluates the signal.
 */
export function breakoutCountsBySector(rows: readonly IntradayRow[], direction: BreakoutDirection): BreakoutCountEntry[] {
  const matching = rows.filter((r) => r.breakout === direction)
  const bySector = groupBySector(matching)
  const entries: BreakoutCountEntry[] = Array.from(bySector.entries()).map(([sector, sectorRows]) => ({ sector, count: sectorRows.length }))

  return entries.sort((a, b) => b.count - a.count).slice(0, 5)
}

export const BREAKOUT_COUNTS_TOOLTIP =
  'Count of instruments per sector currently flagged as a breakout, from the same checkBreakout() rule the /rsi-ha screener uses (20-bar lookback by default) — not a separate breakout definition.'

// ---------------------------------------------------------------------------
// 7. headerCounts
// ---------------------------------------------------------------------------

export interface HeaderCounts {
  breakoutUpCount: number
  breakoutDownCount: number
  /** Mean Strength of every row currently in EITHER breakout direction. NaN-Strength rows are excluded, not counted as 0. NaN if no row is currently in breakout. */
  breakoutStrength: number
}

/** The three numbers shown in the dashboard header strip. */
export function headerCounts(rows: readonly IntradayRow[]): HeaderCounts {
  const breakoutUpCount = rows.filter((r) => r.breakout === 'BREAKOUT-UP').length
  const breakoutDownCount = rows.filter((r) => r.breakout === 'BREAKOUT-DOWN').length
  const inBreakout = rows.filter((r) => r.breakout !== null)
  const breakoutStrength = meanExcludingNaN(inBreakout.map((r) => r.strength))

  return { breakoutUpCount, breakoutDownCount, breakoutStrength }
}

export const HEADER_COUNTS_TOOLTIP = 'Breakout/BreakDown are live counts from checkBreakout(). "Breakout strength" is the mean Strength (our own metric) of only the rows currently in either breakout direction.'

// ---------------------------------------------------------------------------
// 8. sectorCardSummaries
// ---------------------------------------------------------------------------

export interface SectorCardSummary {
  key: IndexKey
  label: string
  count: number
  meanStrength: number
  upPct: number
  downPct: number
}

/**
 * One summary per index panel — the numbers SectorGrid's own grid-level sort
 * control (mean strength / advance-decline / alphabetical) compares cards
 * by, and "hide empty sectors" filters on (`count === 0`). Each CARD
 * computes its OWN header number from its OWN live row slice rather than
 * reading this — this function exists for the cross-sector comparison the
 * grid-level control needs, not as the card's own data source — but both
 * ultimately call the same meanExcludingNaN() over the same `rows`, so the
 * two can never disagree.
 */
export function sectorCardSummaries(rows: readonly IntradayRow[], indices: readonly IndexPanel[], threshold = 0.5): SectorCardSummary[] {
  return indices.map((panel) => {
    const constituents = rows.filter((r) => r.indices.includes(panel.key))
    const { upPct, downPct } = marketMeter(constituents, threshold)
    return {
      key: panel.key,
      label: panel.label,
      count: constituents.length,
      meanStrength: meanExcludingNaN(constituents.map((r) => r.strength)),
      upPct,
      downPct,
    }
  })
}
