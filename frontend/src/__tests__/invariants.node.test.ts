import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type StrategyParams } from '../strategy/constants'

/**
 * Invariants 8 and 9 — the ones that read files. Plain source scans on
 * purpose: twenty lines with no config to rot, instead of a dependency-graph
 * tool. Each allow-list entry states WHY it is allowed; anything new that
 * breaks a rule fails the build until someone either fixes it or adds an
 * entry with a reason a reviewer can argue with.
 */

// Captured at import, before anything else touches the object (zustand's immer
// middleware deep-freezes store state, which would freeze it as a side effect).
const FROZEN_AT_IMPORT = Object.isFrozen(DEFAULT_PARAMS)

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = path.resolve(SRC, '../docs')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' || name === 'test-utils' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [full] : []
  })
}

/** Source with comments removed (a line comment starts at `//` not inside a string literal on that line — good enough for this codebase). */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n')
}

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join('/')
const FILES = sourceFiles(SRC)

describe('8. DEFAULT_PARAMS IS IMMUTABLE — and matches the documented contract', () => {
  it('is frozen from the moment it is imported', () => {
    expect(FROZEN_AT_IMPORT).toBe(true)
  })

  it('a write attempt throws (ES modules run in strict mode)', () => {
    const mutable = DEFAULT_PARAMS as StrategyParams
    expect(() => {
      mutable.rsiBuyLow = 1
    }).toThrow(TypeError)
    expect(DEFAULT_PARAMS.rsiBuyLow).toBe(60)
  })

  it('every value equals the constants table in docs/STRATEGY-CONTRACT.md (docs drifting from code fails the build)', () => {
    const doc = readFileSync(path.join(DOCS, 'STRATEGY-CONTRACT.md'), 'utf8')
    const table = new Map<string, string>()
    for (const m of doc.matchAll(/^\|\s*`([A-Z_]+)`\s*\|\s*`([^`]+)`\s*\|/gm)) table.set(m[1], m[2])

    const KEY: Record<string, keyof StrategyParams> = {
      CANDLE_INTERVAL: 'candleInterval',
      MIN_PRICE: 'minPrice',
      RSI_PERIOD: 'rsiPeriod',
      RSI_BUY_LOW: 'rsiBuyLow',
      RSI_BUY_HIGH: 'rsiBuyHigh',
      RSI_SELL_LOW: 'rsiSellLow',
      RSI_SELL_HIGH: 'rsiSellHigh',
      BREAKOUT_LOOKBACK: 'breakoutLookback',
      SCAN_EVERY_SECONDS: 'scanEverySeconds',
    }
    expect([...table.keys()].sort()).toEqual(Object.keys(KEY).sort())
    expect(Object.keys(DEFAULT_PARAMS).sort()).toEqual(Object.values(KEY).sort())

    for (const [name, raw] of table) {
      const expected = /^".*"$/.test(raw) ? raw.slice(1, -1) : Number(raw)
      expect(DEFAULT_PARAMS[KEY[name]], `${name} (${raw})`).toBe(expected)
    }
  })
})

describe('9. ARCHITECTURE BOUNDARIES', () => {
  it('nothing in src/strategy/ imports React, a store, or anything from src/data/, src/app/ or src/features/', () => {
    // Allowed: a TYPE-ONLY import of the UniverseMode alias from store/types.ts
    // (erased at compile time; a types module, not a store). Reported as a
    // finding — the alias belongs in types/domain.ts — but src/strategy/ is
    // parity-locked, so it is allow-listed rather than moved.
    const ALLOWED = new Set(["strategy/universeStats.ts -> ../store/types"])
    const violations: string[] = []
    for (const file of FILES.filter((f) => rel(f).startsWith('strategy/'))) {
      // Both `import x from 'mod'` and a bare side-effect `import 'mod'`.
      for (const m of codeOf(file).matchAll(/import\s+(?:(?:type\s+)?[^'"]*from\s+)?'([^']+)'/g)) {
        const spec = m[1]
        const bad = spec === 'react' || spec.startsWith('react-') || /(^|\/)(store|data|app|features)(\/|$)/.test(spec) || /zustand/.test(spec)
        if (bad && !ALLOWED.has(`${rel(file)} -> ${spec}`)) violations.push(`${rel(file)} -> ${spec}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('nothing outside src/data/ constructs or value-imports MockMarketDataSource except the one wiring point', () => {
    // app/dataSource.ts is this codebase's single wiring point (the spec's "Providers.tsx").
    // Type-only imports are allowed for the dev-only replay/speed/seed controls that
    // BACKEND-HANDOFF.md lists as "does not carry over to a real backend".
    const WIRING = 'app/dataSource.ts'
    const violations: string[] = []
    for (const file of FILES.filter((f) => !rel(f).startsWith('data/') && rel(f) !== WIRING)) {
      const code = codeOf(file)
      for (const m of code.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+'[^']*data\/mock[^']*'/g)) {
        const typeOnly = Boolean(m[1])
        const names = m[2].split(',').map((n) => n.trim())
        const valueImportsClass = names.some((n) => n === 'MockMarketDataSource' || n === 'type MockMarketDataSource' ? !typeOnly && n === 'MockMarketDataSource' : false)
        if (valueImportsClass) violations.push(rel(file))
      }
      if (/new\s+MockMarketDataSource\s*\(/.test(code)) violations.push(`${rel(file)} (constructs it)`)
    }
    expect(violations).toEqual([])
    expect(/new\s+MockMarketDataSource\s*\(/.test(codeOf(path.join(SRC, WIRING)))).toBe(true)
  })

  it('PrimusTick (the raw, UNCONFIRMED wire format) is referenced only inside the data layer', () => {
    // Allowed: its definition (types/api.ts) and src/data/** (the mock socket + the
    // adapter that normalises it to MarketTick). Everything else sees MarketTick only.
    const violations = FILES.filter((f) => !rel(f).startsWith('data/') && rel(f) !== 'types/api.ts')
      .filter((f) => /\bPrimusTick\b/.test(codeOf(f)))
      .map(rel)
    expect(violations).toEqual([])
  })

  it('nothing reads the wall clock (Date.now) except the mock clock and the listed real-time uses', () => {
    // Market time must come from the injectable clock. The entries below read the wall
    // clock for things that are genuinely about REAL time, never market time:
    const ALLOWED: Record<string, string> = {
      'data/mock/clock.ts': 'the injectable clock itself — anchors simulated time to real time',
      'data/mock/MockDevtoolsPanel.tsx': 'dev overlay: real elapsed seconds for the render-rate readout',
      'store/alertStore.ts': 'unique id generation, not market time',
      'store/watchlistStore.ts': 'unique id generation, not market time',
      'store/intradayStore.ts': 'UI repaint throttle (createThrottle) — paces renders, not the market',
      'store/screenerStore.ts': 'lastScanDurationMs — measures how long a scan really took',
    }
    const offenders = FILES.filter((f) => /\bDate\.now\s*\(/.test(codeOf(f))).map(rel)
    expect(offenders.filter((f) => !(f in ALLOWED))).toEqual([])
    // Allow-list entries must stay truthful: an entry for a file that no longer reads the clock is stale.
    expect(Object.keys(ALLOWED).filter((f) => !offenders.includes(f))).toEqual([])
  })
})
