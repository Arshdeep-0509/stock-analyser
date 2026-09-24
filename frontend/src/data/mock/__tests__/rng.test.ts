import { describe, expect, it } from 'vitest'
import { NSE_SYMBOLS } from '../nseSymbols'
import { deriveSeed, hashSeed, mulberry32, randomGaussian, shuffle } from '../rng'

// Spec name mapping: hashString -> hashSeed, gaussian -> randomGaussian.

describe('mulberry32', () => {
  it('is deterministic for a seed: two generators from the same seed produce the same stream', () => {
    const a = mulberry32(424242)
    const b = mulberry32(424242)
    const streamA = Array.from({ length: 1000 }, () => a())
    const streamB = Array.from({ length: 1000 }, () => b())
    expect(streamB).toEqual(streamA)
  })

  it('different seeds diverge immediately', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it('only ever produces values in [0, 1)', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 100_000; i++) {
      const v = rng()
      if (!(v >= 0 && v < 1)) throw new Error(`draw ${i} out of range: ${v}`)
    }
  })

  it('is not degenerate: 10,000 draws spread across all ten deciles', () => {
    const rng = mulberry32(99)
    const deciles = new Array<number>(10).fill(0)
    for (let i = 0; i < 10_000; i++) deciles[Math.floor(rng() * 10)] += 1
    for (const count of deciles) expect(count).toBeGreaterThan(800)
  })
})

describe('hashSeed (FNV-1a) / deriveSeed', () => {
  it('is stable across calls', () => {
    expect(hashSeed('RELIANCE')).toBe(hashSeed('RELIANCE'))
    expect(deriveSeed(424242, 'RELIANCE')).toBe(deriveSeed(424242, 'RELIANCE'))
  })

  it('pins the known FNV-1a vectors (so a "harmless" refactor that changes every seed is caught)', () => {
    expect(hashSeed('')).toBe(0x811c9dc5)
    expect(hashSeed('a')).toBe(0xe40c292c)
    expect(hashSeed('foobar')).toBe(0xbf9cf968)
  })

  it('is collision-free across the whole symbol list — every stock gets its own sub-seed', () => {
    const hashes = NSE_SYMBOLS.map((s) => hashSeed(s.symbol))
    expect(new Set(hashes).size).toBe(NSE_SYMBOLS.length)
    const derived = NSE_SYMBOLS.map((s) => deriveSeed(424242, s.symbol))
    expect(new Set(derived).size).toBe(NSE_SYMBOLS.length)
  })
})

describe('randomGaussian (Box-Muller)', () => {
  it('10,000 draws have mean within 0.05 of 0 and standard deviation within 0.05 of 1', () => {
    const rng = mulberry32(424242)
    const n = 10_000
    const draws = Array.from({ length: n }, () => randomGaussian(rng))
    const mean = draws.reduce((s, v) => s + v, 0) / n
    const sd = Math.sqrt(draws.reduce((s, v) => s + (v - mean) ** 2, 0) / n)
    expect(Math.abs(mean)).toBeLessThan(0.05)
    expect(Math.abs(sd - 1)).toBeLessThan(0.05)
    expect(draws.every(Number.isFinite)).toBe(true)
  })
})

describe('shuffle', () => {
  it('is a deterministic permutation that leaves its input untouched', () => {
    const input = Array.from({ length: 50 }, (_, i) => i)
    const copy = input.slice()
    const out = shuffle(mulberry32(3), input)
    expect(input).toEqual(copy)
    expect([...out].sort((x, y) => x - y)).toEqual(input)
    expect(out).toEqual(shuffle(mulberry32(3), input))
    expect(out).not.toEqual(input)
  })
})
