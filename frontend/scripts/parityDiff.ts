/**
 * Adversarial parity check: runs the ORIGINAL Python compute_rsi() /
 * compute_heikin_ashi() (imported from mastertrust_rsi_ha_screener.py by
 * ../scripts/parity_check.py, never copied) and the TypeScript port over
 * every committed fixture, and diffs rsi / haOpen / haClose / haHigh /
 * haLow / haColor value by value.
 *
 *   - numbers must agree within 1e-9 (absolute)
 *   - NaN positions must agree exactly (Python None <-> TS NaN)
 *   - colours must be identical strings
 *
 * Exits non-zero on any mismatch. Requires Python 3 with pandas + numpy
 * (set PYTHON to override the interpreter name).
 *
 * Run: npm run test:parity
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeHeikinAshi, computeRsi } from '../src/strategy/indicators'
import type { Candle } from '../src/types/domain'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.resolve(HERE, '../src/strategy/__tests__/fixtures')
const PYTHON_SCRIPT = path.resolve(HERE, '../../scripts/parity_check.py')
const PYTHON = process.env.PYTHON ?? 'python'
const TOLERANCE = 1e-9

/**
 * Known, reasoned differences between the reference and the port. Each entry
 * must say WHY it is acceptable; anything not listed here is a failure.
 */
const KNOWN_REFERENCE_ERRORS: Record<string, string> = {
  'edge-00-candles':
    'compute_heikin_ashi() indexes iloc[0] unconditionally, so the Python raises IndexError on an empty frame; the port returns []. ' +
    'Unreachable in the screener: scan_watchlist() / scanWatchlist() only analyse a symbol when it has candles.',
}

interface PythonResult {
  candles: number
  error?: string
  rsi?: (number | null)[]
  ha_open?: (number | null)[]
  ha_close?: (number | null)[]
  ha_high?: (number | null)[]
  ha_low?: (number | null)[]
  ha_color?: string[]
}

interface Row {
  fixture: string
  candles: number
  firstRsi: string
  maxDiff: number
  status: 'PASS' | 'FAIL' | 'KNOWN'
  notes: string[]
}

function fixtures(): string[] {
  const parityDir = path.join(FIXTURE_DIR, 'parity')
  return [path.join(FIXTURE_DIR, 'candles-60.json'), ...readdirSync(parityDir).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(parityDir, f))]
}

function runPython(fixturePath: string): PythonResult {
  const out = spawnSync(PYTHON, [PYTHON_SCRIPT, fixturePath, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (out.status !== 0) throw new Error(`python failed on ${fixturePath}: ${out.stderr || out.error?.message}`)
  return JSON.parse(out.stdout) as PythonResult
}

/** Compares one numeric column; returns the max absolute diff and any mismatch descriptions. */
function diffColumn(name: string, py: (number | null)[] | undefined, ts: number[], notes: string[]): number {
  if (!py) {
    notes.push(`${name}: missing from python output`)
    return Infinity
  }
  if (py.length !== ts.length) {
    notes.push(`${name}: length python ${py.length} vs ts ${ts.length}`)
    return Infinity
  }
  let max = 0
  for (let i = 0; i < ts.length; i++) {
    const p = py[i]
    const t = ts[i]
    if (p === null || Number.isNaN(t)) {
      if (!(p === null && Number.isNaN(t))) notes.push(`${name}[${i}]: python ${p} vs ts ${t}`)
      continue
    }
    const d = Math.abs(p - t)
    if (d > max) max = d
    if (!(d <= TOLERANCE)) notes.push(`${name}[${i}]: python ${p} vs ts ${t} (diff ${d})`)
  }
  return max
}

function check(fixturePath: string): Row {
  const name = path.basename(fixturePath, '.json')
  const candles = JSON.parse(readFileSync(fixturePath, 'utf8')) as Candle[]
  const py = runPython(fixturePath)
  const notes: string[] = []

  const rsi = computeRsi(candles)
  const ha = computeHeikinAshi(candles)
  const firstDefined = rsi.findIndex((v) => !Number.isNaN(v))
  const firstRsi = firstDefined === -1 ? 'none' : String(firstDefined)

  if (py.error) {
    const known = KNOWN_REFERENCE_ERRORS[name]
    return known
      ? { fixture: name, candles: candles.length, firstRsi, maxDiff: 0, status: 'KNOWN', notes: [`python: ${py.error}`, known] }
      : { fixture: name, candles: candles.length, firstRsi, maxDiff: Infinity, status: 'FAIL', notes: [`python raised: ${py.error}`] }
  }

  let maxDiff = 0
  maxDiff = Math.max(maxDiff, diffColumn('rsi', py.rsi, rsi, notes))
  maxDiff = Math.max(maxDiff, diffColumn('haOpen', py.ha_open, ha.map((c) => c.haOpen), notes))
  maxDiff = Math.max(maxDiff, diffColumn('haClose', py.ha_close, ha.map((c) => c.haClose), notes))
  maxDiff = Math.max(maxDiff, diffColumn('haHigh', py.ha_high, ha.map((c) => c.haHigh), notes))
  maxDiff = Math.max(maxDiff, diffColumn('haLow', py.ha_low, ha.map((c) => c.haLow), notes))

  const colors = ha.map((c) => c.haColor)
  if (!py.ha_color || py.ha_color.length !== colors.length) notes.push('haColor: length mismatch')
  else py.ha_color.forEach((c, i) => c !== colors[i] && notes.push(`haColor[${i}]: python ${c} vs ts ${colors[i]}`))

  return { fixture: name, candles: candles.length, firstRsi, maxDiff, status: notes.length === 0 ? 'PASS' : 'FAIL', notes }
}

const rows = fixtures().map(check)
const w = Math.max(...rows.map((r) => r.fixture.length), 'fixture'.length)
console.log(`${'fixture'.padEnd(w)} | candles | first-defined-rsi | max abs diff | result`)
console.log(`${'-'.repeat(w)}-|---------|-------------------|--------------|-------`)
for (const r of rows) {
  const diff = Number.isFinite(r.maxDiff) ? r.maxDiff.toExponential(2) : 'n/a'
  console.log(`${r.fixture.padEnd(w)} | ${String(r.candles).padStart(7)} | ${r.firstRsi.padStart(17)} | ${diff.padStart(12)} | ${r.status}`)
}
for (const r of rows.filter((x) => x.notes.length > 0)) {
  console.log(`\n${r.fixture} (${r.status}):`)
  for (const n of r.notes.slice(0, 10)) console.log(`  ${n}`)
  if (r.notes.length > 10) console.log(`  … ${r.notes.length - 10} more`)
}
const failed = rows.filter((r) => r.status === 'FAIL')
console.log(`\n${rows.length} fixtures: ${rows.length - failed.length} ok (${rows.filter((r) => r.status === 'KNOWN').length} known reference difference), ${failed.length} FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
