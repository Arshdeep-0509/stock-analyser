import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStarredStore } from '../starredStore'

afterEach(() => {
  localStorage.clear()
})

beforeEach(() => {
  useStarredStore.setState({ tokens: new Set() })
})

describe('starredStore', () => {
  it('starts unstarred for a token it has never seen', () => {
    expect(useStarredStore.getState().isStarred('T1')).toBe(false)
  })

  it('toggleStar flips a token on and off', () => {
    useStarredStore.getState().toggleStar('T1')
    expect(useStarredStore.getState().isStarred('T1')).toBe(true)

    useStarredStore.getState().toggleStar('T1')
    expect(useStarredStore.getState().isStarred('T1')).toBe(false)
  })

  it('setStarred sets an explicit value regardless of current state', () => {
    useStarredStore.getState().setStarred('T1', true)
    expect(useStarredStore.getState().isStarred('T1')).toBe(true)
    useStarredStore.getState().setStarred('T1', true) // idempotent
    expect(useStarredStore.getState().isStarred('T1')).toBe(true)
    useStarredStore.getState().setStarred('T1', false)
    expect(useStarredStore.getState().isStarred('T1')).toBe(false)
  })

  it('tracks multiple tokens independently', () => {
    useStarredStore.getState().toggleStar('A')
    useStarredStore.getState().toggleStar('B')
    expect(useStarredStore.getState().isStarred('A')).toBe(true)
    expect(useStarredStore.getState().isStarred('B')).toBe(true)

    useStarredStore.getState().toggleStar('A')
    expect(useStarredStore.getState().isStarred('A')).toBe(false)
    expect(useStarredStore.getState().isStarred('B')).toBe(true)
  })

  it('persists across a fresh store instance reading the same localStorage', () => {
    useStarredStore.getState().toggleStar('T1')

    // Simulate a fresh load (e.g. a page reload) by re-reading what was persisted.
    const raw = localStorage.getItem('rsi-ha:starred')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as { version: number; data: { tokens: string[] } }
    expect(parsed.data.tokens).toEqual(['T1'])
  })
})
