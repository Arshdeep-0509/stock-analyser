import { describe, expect, it } from 'vitest'
import {
  breakoutCountsBySector,
  headerCounts,
  indexMeter,
  intradayIndex,
  marketMeter,
  sectorStrength,
  smartMoney,
} from '../aggregate'
import type { IndexPanel } from '../../data/reference/indices'
import type { IntradayRow } from '../../types/domain'

function makeRow(overrides: Partial<IntradayRow> = {}): IntradayRow {
  return {
    symbol: 'X-EQ',
    baseSymbol: 'X',
    token: 'T',
    exchange: 'NSE',
    sector: 'Others',
    indices: [],
    cmp: 100,
    prevClose: 100,
    changePct: 0,
    change3dPct: 0,
    dayOpen: 100,
    dayHigh: 100,
    dayLow: 100,
    vwap: 100,
    strength: 0,
    strengthTone: 'none',
    intradayDir: 'up',
    breakout: null,
    breakoutLevel: null,
    rvol: 1,
    zMove: 0,
    persistence: 0,
    cachedClose: 100,
    lastTickAt: 0,
    starred: false,
    ...overrides,
  }
}

describe('marketMeter', () => {
  it('returns {upPct: 0, downPct: 0} for an empty universe, not NaN or a crash', () => {
    expect(marketMeter([])).toEqual({ upPct: 0, downPct: 0, upCount: 0, downCount: 0, flatCount: 0, total: 0 })
  })

  it('exposes the raw counts behind the percentages, for the text summary line', () => {
    const rows = [makeRow({ changePct: 2 }), makeRow({ changePct: -2 }), makeRow({ changePct: 0.1 })]
    const result = marketMeter(rows, 0.5)
    expect(result.upCount).toBe(1)
    expect(result.downCount).toBe(1)
    expect(result.flatCount).toBe(1)
    expect(result.total).toBe(3)
  })

  it('does not sum to 100 — a flat band between -threshold and +threshold is left out of both buckets', () => {
    const rows = [
      makeRow({ changePct: 2 }), // up
      makeRow({ changePct: -2 }), // down
      makeRow({ changePct: 0.1 }), // flat
      makeRow({ changePct: -0.1 }), // flat
    ]
    const result = marketMeter(rows, 0.5)
    expect(result.upPct).toBe(25)
    expect(result.downPct).toBe(25)
    expect(result.upPct + result.downPct).toBeLessThan(100)
  })

  it('the threshold genuinely moves the result', () => {
    const rows = [makeRow({ changePct: 1 }), makeRow({ changePct: -1 }), makeRow({ changePct: 0.2 }), makeRow({ changePct: -0.2 })]

    const tight = marketMeter(rows, 0.5)
    expect(tight.upPct).toBe(25)
    expect(tight.downPct).toBe(25)

    const loose = marketMeter(rows, 2)
    expect(loose.upPct).toBe(0)
    expect(loose.downPct).toBe(0)
  })

  it('boundary values are inclusive (>= / <=)', () => {
    const rows = [makeRow({ changePct: 0.5 }), makeRow({ changePct: -0.5 })]
    const result = marketMeter(rows, 0.5)
    expect(result.upPct).toBe(50)
    expect(result.downPct).toBe(50)
  })

  it('a NaN changePct counts toward the universe total but neither bucket', () => {
    const rows = [makeRow({ changePct: NaN }), makeRow({ changePct: 2 })]
    const result = marketMeter(rows, 0.5)
    expect(result.upPct).toBe(50)
    expect(result.downPct).toBe(0)
  })
})

describe('indexMeter', () => {
  const panels: IndexPanel[] = [
    { key: 'IT', label: 'IT', constituents: [] },
    { key: 'FMCG', label: 'FMCG', constituents: [] },
  ]

  it('returns an empty array for empty panels, not a crash', () => {
    expect(indexMeter([makeRow()], [])).toEqual([])
  })

  it('scopes each index\'s up/down share to ITS OWN constituents, not the whole universe', () => {
    const rows = [
      makeRow({ indices: ['IT'], changePct: 5 }), // IT: up
      makeRow({ indices: ['IT'], changePct: 5 }), // IT: up
      makeRow({ indices: ['FMCG'], changePct: -5 }), // FMCG: down
      makeRow({ indices: [] }), // in neither index
    ]

    const result = indexMeter(rows, panels, 0.5)

    expect(result).toEqual([
      expect.objectContaining({ key: 'IT', label: 'IT', upPct: 100, downPct: 0, count: 2 }),
      expect.objectContaining({ key: 'FMCG', label: 'FMCG', upPct: 0, downPct: 100, count: 1 }),
    ])
  })

  it('a row in multiple indices is counted in each', () => {
    const rows = [makeRow({ indices: ['IT', 'FMCG'], changePct: 5 })]
    const result = indexMeter(rows, panels, 0.5)
    expect(result.every((entry) => entry.upPct === 100)).toBe(true)
  })

  it('an index with no constituents in the universe reports 0/0, not NaN', () => {
    const result = indexMeter([makeRow({ indices: [] })], panels, 0.5)
    expect(result).toEqual([
      expect.objectContaining({ key: 'IT', label: 'IT', upPct: 0, downPct: 0, count: 0 }),
      expect.objectContaining({ key: 'FMCG', label: 'FMCG', upPct: 0, downPct: 0, count: 0 }),
    ])
  })

  it('exposes up to the top 3 constituents by Strength for the hover tooltip, excluding NaN', () => {
    const rows = [
      makeRow({ indices: ['IT'], strength: 5 }),
      makeRow({ indices: ['IT'], strength: 8 }),
      makeRow({ indices: ['IT'], strength: NaN }),
      makeRow({ indices: ['IT'], strength: 2 }),
      makeRow({ indices: ['IT'], strength: 9 }),
    ]
    const [it] = indexMeter(rows, [panels[0]], 0.5)
    expect(it.count).toBe(5)
    expect(it.topConstituents).toHaveLength(3)
    expect(it.topConstituents.map((r) => r.strength)).toEqual([9, 8, 5])
  })
})

describe('sectorStrength', () => {
  it('returns an empty array for empty input, not a crash', () => {
    expect(sectorStrength([])).toEqual([])
  })

  it('sectors with fewer than 3 constituents fold into Others', () => {
    const rows = [
      makeRow({ sector: 'Banks', strength: 10 }),
      makeRow({ sector: 'Banks', strength: 10 }), // only 2 Banks rows -> folds
      makeRow({ sector: 'IT Software', strength: 1 }),
      makeRow({ sector: 'IT Software', strength: 1 }),
      makeRow({ sector: 'IT Software', strength: 1 }), // 3 IT Software rows -> stays its own sector
    ]

    const result = sectorStrength(rows)

    expect(result.find((e) => e.sector === 'Banks')).toBeUndefined()
    const others = result.find((e) => e.sector === 'Others')
    expect(others).toEqual(expect.objectContaining({ sector: 'Others', meanStrength: 10, count: 2 }))
    const itSoftware = result.find((e) => e.sector === 'IT Software')
    expect(itSoftware).toEqual(expect.objectContaining({ sector: 'IT Software', meanStrength: 1, count: 3 }))
  })

  it('a lone loud stock never gets its own named entry — it only ever shows up folded under Others', () => {
    const rows = [
      makeRow({ sector: 'Aerospace Defence', strength: 100 }), // alone -> folds into Others
      makeRow({ sector: 'IT Software', strength: 2 }),
      makeRow({ sector: 'IT Software', strength: 2 }),
      makeRow({ sector: 'IT Software', strength: 2 }),
    ]
    const result = sectorStrength(rows)
    expect(result.map((e) => e.sector)).not.toContain('Aerospace Defence')
    expect(result.find((e) => e.sector === 'Others')).toEqual(expect.objectContaining({ sector: 'Others', meanStrength: 100, count: 1 }))
  })

  it('two different small sectors dilute each other once folded together, rather than either dominating alone', () => {
    const rows = [
      makeRow({ sector: 'Aerospace Defence', strength: 100 }), // lone -> folds into Others
      makeRow({ sector: 'Media', strength: 0 }), // lone -> folds into Others
      makeRow({ sector: 'IT Software', strength: 60 }),
      makeRow({ sector: 'IT Software', strength: 60 }),
      makeRow({ sector: 'IT Software', strength: 60 }),
    ]
    const result = sectorStrength(rows)
    // Others = mean(100, 0) = 50, which is now BELOW IT Software's genuine 60 mean.
    expect(result[0].sector).toBe('IT Software')
    expect(result.find((e) => e.sector === 'Others')).toEqual(expect.objectContaining({ sector: 'Others', meanStrength: 50, count: 2 }))
  })

  it('excludes NaN strengths from the mean rather than treating them as 0', () => {
    const rows = [
      makeRow({ sector: 'Banks', strength: NaN }),
      makeRow({ sector: 'Banks', strength: 10 }),
      makeRow({ sector: 'Banks', strength: 10 }),
    ]
    const result = sectorStrength(rows)
    expect(result[0]).toEqual(expect.objectContaining({ sector: 'Banks', meanStrength: 10, count: 3 }))
  })

  it('a sector whose every row is NaN reports NaN (not 0) and sorts last', () => {
    const rows = [
      makeRow({ sector: 'Banks', strength: NaN }),
      makeRow({ sector: 'Banks', strength: NaN }),
      makeRow({ sector: 'Banks', strength: NaN }),
      makeRow({ sector: 'IT Software', strength: 1 }),
      makeRow({ sector: 'IT Software', strength: 1 }),
      makeRow({ sector: 'IT Software', strength: 1 }),
    ]
    const result = sectorStrength(rows)
    expect(result[result.length - 1].sector).toBe('Banks')
    expect(Number.isNaN(result[result.length - 1].meanStrength)).toBe(true)
  })

  it('sorts descending by mean strength', () => {
    const rows = [
      makeRow({ sector: 'A', strength: 1 }),
      makeRow({ sector: 'A', strength: 1 }),
      makeRow({ sector: 'A', strength: 1 }),
      makeRow({ sector: 'B', strength: 5 }),
      makeRow({ sector: 'B', strength: 5 }),
      makeRow({ sector: 'B', strength: 5 }),
    ]
    const result = sectorStrength(rows)
    expect(result.map((e) => e.sector)).toEqual(['B', 'A'])
  })

  it('exposes up to the top 3 constituents by Strength per bucket, excluding NaN', () => {
    const rows = [
      makeRow({ sector: 'Banks', strength: 5 }),
      makeRow({ sector: 'Banks', strength: 9 }),
      makeRow({ sector: 'Banks', strength: NaN }),
      makeRow({ sector: 'Banks', strength: 2 }),
    ]
    const result = sectorStrength(rows)
    expect(result[0].topConstituents.map((r) => r.strength)).toEqual([9, 5, 2])
  })

  it('topN folds every sector past that rank into Others, re-deriving the mean from the real combined rows', () => {
    const rows = [
      makeRow({ sector: 'A', strength: 10 }),
      makeRow({ sector: 'A', strength: 10 }),
      makeRow({ sector: 'A', strength: 10 }),
      makeRow({ sector: 'B', strength: 8 }),
      makeRow({ sector: 'B', strength: 8 }),
      makeRow({ sector: 'B', strength: 8 }),
      makeRow({ sector: 'C', strength: 2 }),
      makeRow({ sector: 'C', strength: 2 }),
      makeRow({ sector: 'C', strength: 2 }),
    ]
    const result = sectorStrength(rows, { topN: 2 })

    expect(result.map((e) => e.sector)).toEqual(['A', 'B', 'Others'])
    expect(result.find((e) => e.sector === 'Others')).toEqual(expect.objectContaining({ sector: 'Others', meanStrength: 2, count: 3 }))
  })

  it('topN merges overflow into an EXISTING Others bucket rather than creating a second one', () => {
    const rows = [
      makeRow({ sector: 'A', strength: 10 }),
      makeRow({ sector: 'A', strength: 10 }),
      makeRow({ sector: 'A', strength: 10 }),
      makeRow({ sector: 'Lonely', strength: 100 }), // folds into Others via the <3-constituent rule, and outranks A/B
      makeRow({ sector: 'B', strength: 1 }),
      makeRow({ sector: 'B', strength: 1 }),
      makeRow({ sector: 'B', strength: 1 }),
    ]
    // Ranking after the <3-fold: Others(100) > A(10) > B(1). topN=2 keeps {Others, A}; B overflows into the EXISTING Others.
    const result = sectorStrength(rows, { topN: 2 })

    const othersEntries = result.filter((e) => e.sector === 'Others')
    expect(othersEntries).toHaveLength(1)
    expect(othersEntries[0].meanStrength).toBeCloseTo((100 + 1 + 1 + 1) / 4, 10)
    expect(othersEntries[0].count).toBe(4)
    expect(result.map((e) => e.sector)).toContain('A')
  })
})

describe('smartMoney', () => {
  it('returns an empty array for empty input, not a crash', () => {
    expect(smartMoney([])).toEqual([])
  })

  it('counts only rows meeting BOTH the rvol and zMove thresholds', () => {
    const rows = [
      makeRow({ sector: 'Banks', rvol: 3, zMove: 2 }), // matches both
      makeRow({ sector: 'Banks', rvol: 3, zMove: 0.5 }), // zMove too low
      makeRow({ sector: 'Banks', rvol: 1, zMove: 2 }), // rvol too low
    ]
    const result = smartMoney(rows)
    expect(result).toEqual([expect.objectContaining({ sector: 'Banks', count: 1 })])
    expect(result[0].matches).toHaveLength(1)
    expect(result[0].matches[0].zMove).toBe(2)
  })

  it('honours custom thresholds', () => {
    const rows = [makeRow({ sector: 'Banks', rvol: 1.5, zMove: 0.8 })]
    expect(smartMoney(rows)).toEqual([])
    expect(smartMoney(rows, { minRvol: 1, minZMove: 0.5 })).toEqual([expect.objectContaining({ sector: 'Banks', count: 1 })])
  })

  it('uses the absolute value of zMove — a strong down move counts too', () => {
    const rows = [makeRow({ sector: 'Banks', rvol: 3, zMove: -2 })]
    expect(smartMoney(rows)).toEqual([expect.objectContaining({ sector: 'Banks', count: 1 })])
  })

  it('exposes the actual qualifying rows for the hover list and click-to-filter', () => {
    const rows = [
      makeRow({ sector: 'Banks', symbol: 'HDFCBANK-EQ', rvol: 3, zMove: 2 }),
      makeRow({ sector: 'Banks', symbol: 'ICICIBANK-EQ', rvol: 4, zMove: -1.5 }),
    ]
    const result = smartMoney(rows)
    expect(result[0].matches.map((r) => r.symbol)).toEqual(['HDFCBANK-EQ', 'ICICIBANK-EQ'])
  })

  it('NaN rvol/zMove never match (NaN comparisons are always false)', () => {
    const rows = [makeRow({ sector: 'Banks', rvol: NaN, zMove: NaN })]
    expect(smartMoney(rows)).toEqual([])
  })

  it('caps at the top 5 sectors by count', () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      Array.from({ length: i + 1 }, () => makeRow({ sector: `Sector${i}`, rvol: 3, zMove: 2 })),
    ).flat()
    const result = smartMoney(rows)
    expect(result).toHaveLength(5)
    expect(result[0].sector).toBe('Sector5') // the sector with 6 matching rows
  })
})

describe('intradayIndex', () => {
  it('returns an empty array for empty input, not a crash', () => {
    expect(intradayIndex([])).toEqual([])
  })

  it('does NOT fold small sectors into Others — unlike sectorStrength', () => {
    const rows = [makeRow({ sector: 'Aerospace Defence', changePct: 5 })]
    const result = intradayIndex(rows)
    expect(result).toEqual([expect.objectContaining({ sector: 'Aerospace Defence', meanChangePct: 5, count: 1 })])
  })

  it('sorts descending by mean changePct (equal-weight, vs prevClose by default) and excludes NaN from the mean', () => {
    const rows = [
      makeRow({ sector: 'Banks', changePct: NaN }),
      makeRow({ sector: 'Banks', changePct: 2 }),
      makeRow({ sector: 'IT Software', changePct: -3 }),
    ]
    const result = intradayIndex(rows)
    expect(result).toEqual([
      expect.objectContaining({ sector: 'Banks', meanChangePct: 2, count: 2 }),
      expect.objectContaining({ sector: 'IT Software', meanChangePct: -3, count: 1 }),
    ])
  })

  it('priceBasis: dayOpen computes change vs dayOpen instead of changePct', () => {
    const rows = [makeRow({ sector: 'Banks', cmp: 110, dayOpen: 100, changePct: 999 })]
    const result = intradayIndex(rows, { priceBasis: 'dayOpen' })
    expect(result[0].meanChangePct).toBeCloseTo(10, 10)
  })

  it('priceBasis: dayOpen is NaN when no bar has closed yet today, excluded from the mean', () => {
    const rows = [makeRow({ sector: 'Banks', dayOpen: NaN, changePct: 5 }), makeRow({ sector: 'Banks', cmp: 100, dayOpen: 100, changePct: 5 })]
    const result = intradayIndex(rows, { priceBasis: 'dayOpen' })
    expect(result[0].meanChangePct).toBe(0) // only the 2nd row counts: (100/100-1)*100 = 0
  })

  it('weighting: cap weights the mean by cachedClose, reordering vs equal-weight', () => {
    const rows = [
      makeRow({ sector: 'A', changePct: 10, cachedClose: 1 }),
      makeRow({ sector: 'A', changePct: 0, cachedClose: 99 }),
      makeRow({ sector: 'B', changePct: 4, cachedClose: 1 }),
    ]
    const equal = intradayIndex(rows)
    expect(equal[0].sector).toBe('A') // equal-weight mean(10,0)=5 > B's 4

    const cap = intradayIndex(rows, { weighting: 'cap' })
    expect(cap[0].sector).toBe('B') // cap-weighted A ≈ (10*1+0*99)/100 = 0.1 < B's 4
    expect(cap.find((e) => e.sector === 'A')?.meanChangePct).toBeCloseTo(0.1, 10)
  })

  it('weighting: cap treats a non-finite or non-positive cachedClose as zero weight, not NaN-poisoned', () => {
    const rows = [makeRow({ sector: 'A', changePct: 10, cachedClose: NaN }), makeRow({ sector: 'A', changePct: 2, cachedClose: 50 })]
    const result = intradayIndex(rows, { weighting: 'cap' })
    expect(result[0].meanChangePct).toBe(2) // the NaN-weight row contributes nothing
  })

  it('exposes best and worst constituents by the selected change value', () => {
    const rows = [
      makeRow({ sector: 'Banks', symbol: 'A', changePct: 5 }),
      makeRow({ sector: 'Banks', symbol: 'B', changePct: -3 }),
      makeRow({ sector: 'Banks', symbol: 'C', changePct: 1 }),
    ]
    const result = intradayIndex(rows)
    expect(result[0].best?.row.symbol).toBe('A')
    expect(result[0].best?.changePct).toBe(5)
    expect(result[0].worst?.row.symbol).toBe('B')
    expect(result[0].worst?.changePct).toBe(-3)
  })

  it('best/worst are null when every row in a sector has a NaN change', () => {
    const rows = [makeRow({ sector: 'Banks', changePct: NaN })]
    const result = intradayIndex(rows)
    expect(result[0].best).toBeNull()
    expect(result[0].worst).toBeNull()
  })

  it('exposes breakout counts per sector, split by direction', () => {
    const rows = [
      makeRow({ sector: 'Banks', breakout: 'BREAKOUT-UP' }),
      makeRow({ sector: 'Banks', breakout: 'BREAKOUT-UP' }),
      makeRow({ sector: 'Banks', breakout: 'BREAKOUT-DOWN' }),
      makeRow({ sector: 'Banks', breakout: null }),
    ]
    const result = intradayIndex(rows)
    expect(result[0].breakoutUpCount).toBe(2)
    expect(result[0].breakoutDownCount).toBe(1)
  })
})

describe('breakoutCountsBySector', () => {
  it('returns an empty array for empty input, not a crash', () => {
    expect(breakoutCountsBySector([], 'BREAKOUT-UP')).toEqual([])
  })

  it('counts only the requested direction, per sector, top 5 descending', () => {
    const rows = [
      makeRow({ sector: 'Banks', breakout: 'BREAKOUT-UP' }),
      makeRow({ sector: 'Banks', breakout: 'BREAKOUT-UP' }),
      makeRow({ sector: 'Banks', breakout: 'BREAKOUT-DOWN' }),
      makeRow({ sector: 'IT Software', breakout: 'BREAKOUT-UP' }),
      makeRow({ sector: 'IT Software', breakout: null }),
    ]
    expect(breakoutCountsBySector(rows, 'BREAKOUT-UP')).toEqual([
      { sector: 'Banks', count: 2 },
      { sector: 'IT Software', count: 1 },
    ])
    expect(breakoutCountsBySector(rows, 'BREAKOUT-DOWN')).toEqual([{ sector: 'Banks', count: 1 }])
  })
})

describe('headerCounts', () => {
  it('returns zero counts and NaN breakoutStrength for empty input, not a crash', () => {
    const result = headerCounts([])
    expect(result.breakoutUpCount).toBe(0)
    expect(result.breakoutDownCount).toBe(0)
    expect(Number.isNaN(result.breakoutStrength)).toBe(true)
  })

  it('counts each direction and averages strength across BOTH directions combined', () => {
    const rows = [
      makeRow({ breakout: 'BREAKOUT-UP', strength: 4 }),
      makeRow({ breakout: 'BREAKOUT-UP', strength: 2 }),
      makeRow({ breakout: 'BREAKOUT-DOWN', strength: 6 }),
      makeRow({ breakout: null, strength: 100 }), // not in breakout — excluded
    ]
    const result = headerCounts(rows)
    expect(result.breakoutUpCount).toBe(2)
    expect(result.breakoutDownCount).toBe(1)
    expect(result.breakoutStrength).toBeCloseTo((4 + 2 + 6) / 3, 10)
  })

  it('excludes NaN strength from breakoutStrength rather than counting it as 0', () => {
    const rows = [
      makeRow({ breakout: 'BREAKOUT-UP', strength: NaN }),
      makeRow({ breakout: 'BREAKOUT-UP', strength: 8 }),
    ]
    expect(headerCounts(rows).breakoutStrength).toBe(8)
  })
})
