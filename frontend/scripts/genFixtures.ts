/**
 * Generates the committed parity fixtures under
 * src/strategy/__tests__/fixtures/parity/ — deterministic (seeded), so
 * re-running this script reproduces byte-identical files. Commit the output;
 * never regenerate as part of a test run.
 *
 *   12 regimes × 200 candles, each stressing a different corner of RSI / HA:
 *     trending-up, trending-down, choppy, flat, single-tick-moves, gap-heavy,
 *     high-volatility, low-volatility, v-reversal, staircase, one-bar-spike,
 *     monotonic-rising
 *   degenerate lengths around the RSI warm-up: 0, 1, 2, 3, 13, 14, 15
 *   a series containing a zero-volume bar
 *
 * Run: npm run fixtures:generate
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mulberry32, randomGaussian, type Rng } from '../src/data/mock/rng'
import type { Candle } from '../src/types/domain'

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/strategy/__tests__/fixtures/parity')
const START = 1767584700 // a 09:15 IST bar open; indicators don't care, but it keeps the files realistic
const BAR = 300
const LENGTH = 200
const SEED = 20260105

const round2 = (v: number): number => Math.round(v * 100) / 100

/** Builds one valid OHLCV bar from an open and a close, with wicks that always contain both. */
function bar(i: number, open: number, close: number, rng: Rng, wickPct: number, volume?: number): Candle {
  const top = Math.max(open, close)
  const bottom = Math.min(open, close)
  const high = round2(top * (1 + Math.abs(randomGaussian(rng)) * wickPct))
  const low = round2(bottom * (1 - Math.abs(randomGaussian(rng)) * wickPct))
  return {
    time: START + i * BAR,
    open: round2(open),
    high: Math.max(high, round2(top)),
    low: Math.min(low, round2(bottom)),
    close: round2(close),
    volume: volume ?? Math.round(50_000 + rng() * 250_000),
  }
}

/** A close-to-close walk: `step(i, prev)` returns the next close; each bar opens at the previous close unless `gap` says otherwise. */
function walk(rng: Rng, start: number, step: (i: number, prev: number) => number, wickPct = 0.002, gap?: (i: number, prev: number) => number): Candle[] {
  const out: Candle[] = []
  let prev = start
  for (let i = 0; i < LENGTH; i++) {
    const open = gap ? gap(i, prev) : prev
    const close = Math.max(0.05, step(i, open))
    out.push(bar(i, open, close, rng, wickPct))
    prev = close
  }
  return out
}

function regimes(): Record<string, Candle[]> {
  const r = (salt: number): Rng => mulberry32(SEED + salt)
  const g = (rng: Rng, pct: number) => (_i: number, prev: number) => prev * (1 + randomGaussian(rng) * pct)

  const trendUp = r(1)
  const trendDown = r(2)
  const choppy = r(3)
  const tick = r(5)
  const gaps = r(6)
  const hiVol = r(7)
  const loVol = r(8)
  const vRev = r(9)
  const stairs = r(10)
  const spike = r(11)
  const mono = r(12)

  return {
    'trending-up': walk(trendUp, 2500, (_i, p) => p * (1.002 + randomGaussian(trendUp) * 0.001)),
    'trending-down': walk(trendDown, 2500, (_i, p) => p * (0.998 + randomGaussian(trendDown) * 0.001)),
    // Mean-reverting around 2500: every move is pulled back toward the centre.
    choppy: walk(choppy, 2500, (_i, p) => p + (2500 - p) * 0.6 + randomGaussian(choppy) * 6),
    // Every price identical: RSI is 0/0 = NaN forever, HA is a flat green line.
    flat: Array.from({ length: LENGTH }, (_, i) => ({ time: START + i * BAR, open: 2500, high: 2500, low: 2500, close: 2500, volume: 100_000 })),
    // Moves of exactly one tick (0.05), up or down.
    'single-tick-moves': walk(tick, 2500, (_i, p) => round2(p + (tick() < 0.5 ? 0.05 : -0.05)), 0),
    // An opening gap of ±3% every 10th bar.
    'gap-heavy': walk(gaps, 2500, g(gaps, 0.002), 0.002, (i, prev) => (i % 10 === 0 && i > 0 ? prev * (gaps() < 0.5 ? 1.03 : 0.97) : prev)),
    'high-volatility': walk(hiVol, 2500, g(hiVol, 0.03), 0.02),
    'low-volatility': walk(loVol, 2500, g(loVol, 0.0001), 0.00005),
    // Straight down for 100 bars, straight up for 100.
    'v-reversal': walk(vRev, 2500, (i, p) => p * (i < LENGTH / 2 ? 0.996 : 1.004) * (1 + randomGaussian(vRev) * 0.0005)),
    // Flat for 9 bars, a +1% step on the 10th, repeat.
    staircase: walk(stairs, 2500, (i, p) => (i % 10 === 9 ? p * 1.01 : p), 0.0005),
    // Quiet, then a single +20% bar at 120, then straight back.
    'one-bar-spike': walk(spike, 2500, (i, p) => (i === 120 ? p * 1.2 : i === 121 ? p / 1.2 : p * (1 + randomGaussian(spike) * 0.0005))),
    // Strictly rising closes every bar: after warm-up RSI is exactly 100 (avg loss 0 -> rs = Infinity).
    'monotonic-rising': walk(mono, 2500, (_i, p) => p + 0.5 + mono()),
  }
}

function edges(): Record<string, Candle[]> {
  const base = regimes()['trending-up']
  const out: Record<string, Candle[]> = {}
  for (const n of [0, 1, 2, 3, 13, 14, 15]) out[`edge-${String(n).padStart(2, '0')}-candles`] = base.slice(0, n)
  const zeroVolume = regimes().choppy.slice(0, 60).map((c) => ({ ...c }))
  zeroVolume[30] = { ...zeroVolume[30], volume: 0 }
  out['edge-zero-volume-bar'] = zeroVolume
  return out
}

function assertValid(name: string, candles: Candle[]): void {
  candles.forEach((c, i) => {
    if (!(c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close) && c.low > 0)) {
      throw new Error(`${name}[${i}] is not a valid OHLC bar: ${JSON.stringify(c)}`)
    }
  })
}

mkdirSync(OUT_DIR, { recursive: true })
const all = { ...regimes(), ...edges() }
for (const [name, candles] of Object.entries(all)) {
  assertValid(name, candles)
  writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(candles, null, 2) + '\n')
}
console.log(`Wrote ${Object.keys(all).length} fixtures to ${path.relative(process.cwd(), OUT_DIR)}`)
