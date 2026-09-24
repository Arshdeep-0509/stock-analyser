/**
 * The small coloured dot beside some symbols in the reference dashboard's
 * Breakout/BreakDown tables. Its actual meaning isn't documented or visible
 * in the screenshots we have, so rather than guess at what it represents,
 * this implements it as OUR OWN feature: a per-token marker the user sets
 * themselves, persisted locally. See StarMarker.tsx for the in-product
 * disclosure this pairs with.
 *
 * Deliberately NOT read by src/analytics/intraday.ts — that function stays
 * pure and takes `starred` as an input; this store is what a
 * hook/component overlays onto computeIntradayRow()'s output.
 */
import { create } from 'zustand'
import { loadVersioned, saveVersioned } from '../lib/persistence'

const STORAGE_KEY = 'rsi-ha:starred'
const STORAGE_VERSION = 1

interface StoredShape {
  tokens: string[]
}

function persist(tokens: Set<string>): void {
  saveVersioned<StoredShape>(STORAGE_KEY, STORAGE_VERSION, { tokens: Array.from(tokens) })
}

function loadInitial(): Set<string> {
  const stored = loadVersioned<StoredShape>(STORAGE_KEY, STORAGE_VERSION, () => null)
  return new Set(stored?.tokens ?? [])
}

export interface StarredState {
  tokens: Set<string>
  isStarred: (token: string) => boolean
  toggleStar: (token: string) => void
  setStarred: (token: string, starred: boolean) => void
}

export const useStarredStore = create<StarredState>()((set, get) => ({
  tokens: loadInitial(),

  isStarred(token) {
    return get().tokens.has(token)
  },

  toggleStar(token) {
    const tokens = new Set(get().tokens)
    if (tokens.has(token)) tokens.delete(token)
    else tokens.add(token)
    set({ tokens })
    persist(tokens)
  },

  setStarred(token, starred) {
    const tokens = new Set(get().tokens)
    if (starred) tokens.add(token)
    else tokens.delete(token)
    set({ tokens })
    persist(tokens)
  },
}))
