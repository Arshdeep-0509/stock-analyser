import { afterEach, describe, expect, it } from 'vitest'
import { loadVersioned, removeVersioned, saveVersioned } from '../persistence'

const KEY = 'test-key'

afterEach(() => {
  removeVersioned(KEY)
})

describe('persistence', () => {
  it('round-trips data at the current version', () => {
    saveVersioned(KEY, 1, { a: 1 })
    expect(loadVersioned(KEY, 1, () => null)).toEqual({ a: 1 })
  })

  it('returns null when nothing is stored', () => {
    expect(loadVersioned(KEY, 1, () => null)).toBeNull()
  })

  it('hands a version mismatch to the migration guard instead of trusting it', () => {
    saveVersioned(KEY, 1, { a: 1 })
    const migrated = loadVersioned<{ b: number }>(KEY, 2, (payload) => {
      expect(payload.version).toBe(1)
      return { b: 99 }
    })
    expect(migrated).toEqual({ b: 99 })
  })

  it('discards corrupt JSON instead of throwing', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadVersioned(KEY, 1, () => null)).toBeNull()
  })
})
