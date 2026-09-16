/**
 * Deterministic PRNG utilities. Every random draw anywhere in src/data/mock/
 * must go through one of these — never Math.random() — so that "same seed
 * -> byte-identical session" actually holds.
 */

export type Rng = () => number

/** mulberry32 — fast, tiny, good-enough statistical quality for a mock generator. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a string hash — used to derive a stable per-token sub-seed from (seed, token). */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Combines a base seed with a string key into a new deterministic 32-bit seed. */
export function deriveSeed(seed: number, key: string): number {
  return (hashSeed(key) ^ Math.imul(seed >>> 0, 0x9e3779b1)) >>> 0
}

export function randomInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

export function randomFloat(rng: Rng, min: number, max: number): number {
  return rng() * (max - min) + min
}

/** Standard normal via Box-Muller. */
export function randomGaussian(rng: Rng): number {
  const u1 = Math.max(rng(), Number.EPSILON)
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[randomInt(rng, 0, items.length - 1)]
  if (item === undefined) {
    throw new Error('pick: items must be non-empty')
  }
  return item
}

/** Fisher-Yates, seeded — returns a new shuffled array, leaves the input untouched. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const result = items.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(rng, 0, i)
    const a = result[i]
    const b = result[j]
    if (a === undefined || b === undefined) continue
    result[i] = b
    result[j] = a
  }
  return result
}
