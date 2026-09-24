/**
 * Definitions and LIMITS for every metric /intraday shows that we invented
 * ourselves (i.e. that is not a 1:1 port of mastertrust_rsi_ha_screener.py).
 * The single source for both the in-product (i) popovers (MetricInfo) and
 * docs/ANALYTICS.md, so the two cannot drift apart. Every threshold quoted
 * below is interpolated from the constant the computing code actually uses.
 *
 * House rule for this copy: never state or imply that a metric matches, or
 * approximates, any commercial dashboard's metric of a similar name.
 */
import {
  MARKET_METER_DEFAULT_THRESHOLD,
  MIN_SECTOR_CONSTITUENTS,
  SMART_MONEY_DEFAULT_MIN_RVOL,
  SMART_MONEY_DEFAULT_MIN_ZMOVE,
} from './aggregate'
import { MIN_COMPLETED_DAILY_CLOSES, MIN_RVOL, SIGMA_LOOKBACK_SESSIONS, STRENGTH_TONE_THRESHOLDS } from './strength'

export type MetricKey = 'strength' | 'marketMeter' | 'indexMeter' | 'sectorStrength' | 'smartMoney' | 'capWeight' | 'breakoutStrength'

export interface MetricDoc {
  title: string
  formula: string
  definition: string[]
  limits: string[]
}

/** Shared closing line — deliberately names no product. */
export const OWN_DEFINITION_NOTE = 'Our own definition for this prototype. It is not intended to match any other product’s metric of a similar name.'

export const METRIC_DOCS: Record<MetricKey, MetricDoc> = {
  strength: {
    title: 'Strength',
    formula: 'Strength = zMove × √max(rvol, ' + MIN_RVOL + ') × (0.5 + 0.5 × persistence)',
    definition: [
      `zMove: |today's % move| ÷ the standard deviation of up to the last ${SIGMA_LOOKBACK_SESSIONS} daily log returns.`,
      "rvol: today's volume so far ÷ the median volume at the same time of day over up to the last 10 sessions.",
      "persistence: |sum of today's 5-min bar returns| ÷ sum of their absolute values (0 = choppy, 1 = one-way).",
      `Colour bands: pale below ${STRENGTH_TONE_THRESHOLDS.low}, yellow below ${STRENGTH_TONE_THRESHOLDS.medium}, orange below ${STRENGTH_TONE_THRESHOLDS.high}, green at or above ${STRENGTH_TONE_THRESHOLDS.high}.`,
    ],
    limits: [
      'Unsigned: it measures how unusual a move is, not its direction.',
      `Blank (not zero) with fewer than ${MIN_COMPLETED_DAILY_CLOSES + 1} sessions of history.`,
      'Updates only when a 5-minute bar closes, never mid-bar.',
      'The colour-band cut-offs are arbitrary display choices, not statistically calibrated.',
    ],
  },
  marketMeter: {
    title: 'Market Meter',
    formula: `Up% = names with %Ch ≥ +t ÷ all names; Down% = names with %Ch ≤ −t ÷ all names (default t = ${MARKET_METER_DEFAULT_THRESHOLD}%)`,
    definition: [
      'Computed over the whole F&O universe loaded on this page, not over any index.',
      'Names inside the ±t band, or without a previous close yet, count as flat — so Up% + Down% is usually well under 100%.',
    ],
    limits: [
      `The ${MARKET_METER_DEFAULT_THRESHOLD}% default threshold is our own choice; the 0.25/1/2% alternatives change the picture a lot.`,
      'Every name counts equally, whatever its size.',
      'Refreshed at most once a second from a snapshot, so it can trail the tables by up to a second.',
    ],
  },
  indexMeter: {
    title: 'Index Meter',
    formula: `Per index: Up% / Down% of its constituents beyond ±${MARKET_METER_DEFAULT_THRESHOLD}%`,
    definition: ['The same flat-band rule as the Market Meter, applied to each index’s constituents separately.'],
    limits: [
      'Index membership is a hand-authored mapping for this prototype, not an official constituent list.',
      'Only F&O names are counted, so each index is a subset of its real constituents.',
      'Equal-weighted; the real index weights are not used.',
    ],
  },
  sectorStrength: {
    title: 'Sector Strength',
    formula: 'Per sector: mean Strength of its names (names without a Strength value are skipped)',
    definition: [`Sectors with fewer than ${MIN_SECTOR_CONSTITUENTS} names are pooled into "Others", so one stock cannot top the chart alone.`],
    limits: [
      'Inherits every limit of Strength itself.',
      'Sector assignment is a hand-authored mapping for this prototype.',
      'A mean: one extreme name can still lift a small sector noticeably.',
    ],
  },
  smartMoney: {
    title: 'Smart Money',
    formula: `Per sector: count of names with rvol ≥ ${SMART_MONEY_DEFAULT_MIN_RVOL} AND |zMove| ≥ ${SMART_MONEY_DEFAULT_MIN_ZMOVE} (both adjustable)`,
    definition: ['A crowding count: unusual volume together with an unusual price move, from price and volume only.'],
    limits: [
      'Despite the name, it cannot see who is trading: there is no order-flow, institutional or delivery data here.',
      'The default thresholds are our own choice, not an industry standard.',
      'Counts, not weights: a sector with more F&O names can score higher simply by being bigger.',
    ],
  },
  capWeight: {
    title: 'Cap-weight (approx.)',
    formula: 'Weighted mean of %Ch per sector, weight = each name’s cached close price',
    definition: ['The weight is the close price stored in the instrument master when it was last loaded.'],
    limits: [
      'Price is not market capitalisation: share counts are ignored entirely, so this is only a rough proxy.',
      'The cached price is a snapshot and does not move with live ticks.',
      'Names without a cached close get zero weight.',
    ],
  },
  breakoutStrength: {
    title: 'Breakout strength',
    formula: 'Mean Strength of the names currently in a Breakout or BreakDown',
    definition: ['The breakout flag itself comes from the same checkBreakout() rule as the /rsi-ha screener; only this average is ours.'],
    limits: ['Inherits every limit of Strength.', 'Blank when no name is currently in a breakout.'],
  },
}
