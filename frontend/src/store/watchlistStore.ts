import { create } from 'zustand'
import { loadVersioned, saveVersioned } from '../lib/persistence'
import type { Exchange } from '../types/domain'

const STORAGE_KEY = 'rsi-ha:watchlists'
const STORAGE_VERSION = 1

export interface WatchlistItem {
  token: string
  symbol: string
  exchange: Exchange
}

export interface Watchlist {
  id: string
  name: string
  items: WatchlistItem[]
}

interface StoredShape {
  watchlists: Watchlist[]
  activeWatchlistId: string | null
}

function persist(watchlists: Watchlist[], activeWatchlistId: string | null): void {
  saveVersioned<StoredShape>(STORAGE_KEY, STORAGE_VERSION, { watchlists, activeWatchlistId })
}

function loadInitial(): StoredShape {
  return loadVersioned<StoredShape>(STORAGE_KEY, STORAGE_VERSION, () => null) ?? { watchlists: [], activeWatchlistId: null }
}

function makeId(): string {
  return `wl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export interface WatchlistState {
  watchlists: Watchlist[]
  activeWatchlistId: string | null

  createWatchlist: (name: string) => string
  renameWatchlist: (id: string, name: string) => void
  deleteWatchlist: (id: string) => void
  duplicateWatchlist: (id: string) => string | null
  setActiveWatchlist: (id: string | null) => void

  addItem: (watchlistId: string, item: WatchlistItem) => void
  removeItem: (watchlistId: string, token: string) => void
  bulkRemove: (watchlistId: string, tokens: string[]) => void
  reorderItem: (watchlistId: string, fromIndex: number, toIndex: number) => void

  importJson: (json: string) => { ok: true; id: string } | { ok: false; error: string }
  exportJson: (watchlistId: string) => string | null
}

export const useWatchlistStore = create<WatchlistState>()((set, get) => {
  const initial = loadInitial()

  return {
    watchlists: initial.watchlists,
    activeWatchlistId: initial.activeWatchlistId,

    createWatchlist(name) {
      const id = makeId()
      const watchlist: Watchlist = { id, name: name.trim() || 'Untitled watchlist', items: [] }
      const watchlists = [...get().watchlists, watchlist]
      set({ watchlists })
      persist(watchlists, get().activeWatchlistId)
      return id
    },

    renameWatchlist(id, name) {
      const watchlists = get().watchlists.map((w) => (w.id === id ? { ...w, name: name.trim() || w.name } : w))
      set({ watchlists })
      persist(watchlists, get().activeWatchlistId)
    },

    deleteWatchlist(id) {
      const watchlists = get().watchlists.filter((w) => w.id !== id)
      const activeWatchlistId = get().activeWatchlistId === id ? null : get().activeWatchlistId
      set({ watchlists, activeWatchlistId })
      persist(watchlists, activeWatchlistId)
    },

    duplicateWatchlist(id) {
      const source = get().watchlists.find((w) => w.id === id)
      if (!source) return null
      const copy: Watchlist = { id: makeId(), name: `${source.name} copy`, items: source.items.map((item) => ({ ...item })) }
      const watchlists = [...get().watchlists, copy]
      set({ watchlists })
      persist(watchlists, get().activeWatchlistId)
      return copy.id
    },

    setActiveWatchlist(id) {
      set({ activeWatchlistId: id })
      persist(get().watchlists, id)
    },

    addItem(watchlistId, item) {
      const watchlists = get().watchlists.map((w) =>
        w.id === watchlistId && !w.items.some((existing) => existing.token === item.token) ? { ...w, items: [...w.items, item] } : w,
      )
      set({ watchlists })
      persist(watchlists, get().activeWatchlistId)
    },

    removeItem(watchlistId, token) {
      const watchlists = get().watchlists.map((w) => (w.id === watchlistId ? { ...w, items: w.items.filter((i) => i.token !== token) } : w))
      set({ watchlists })
      persist(watchlists, get().activeWatchlistId)
    },

    bulkRemove(watchlistId, tokens) {
      const tokenSet = new Set(tokens)
      const watchlists = get().watchlists.map((w) => (w.id === watchlistId ? { ...w, items: w.items.filter((i) => !tokenSet.has(i.token)) } : w))
      set({ watchlists })
      persist(watchlists, get().activeWatchlistId)
    },

    reorderItem(watchlistId, fromIndex, toIndex) {
      const watchlists = get().watchlists.map((w) => {
        if (w.id !== watchlistId) return w
        const items = w.items.slice()
        const [moved] = items.splice(fromIndex, 1)
        if (!moved) return w
        items.splice(toIndex, 0, moved)
        return { ...w, items }
      })
      set({ watchlists })
      persist(watchlists, get().activeWatchlistId)
    },

    importJson(json) {
      try {
        const parsed = JSON.parse(json) as unknown
        if (typeof parsed !== 'object' || parsed === null || !('name' in parsed) || !('items' in parsed)) {
          return { ok: false, error: 'Expected a JSON object with "name" and "items"' }
        }
        const raw = parsed as { name: unknown; items: unknown }
        if (typeof raw.name !== 'string' || !Array.isArray(raw.items)) {
          return { ok: false, error: 'Expected "name" to be a string and "items" to be an array' }
        }
        const items: WatchlistItem[] = raw.items
          .filter((i): i is WatchlistItem => typeof i === 'object' && i !== null && 'token' in i && 'symbol' in i && 'exchange' in i)
          .map((i) => ({ token: String(i.token), symbol: String(i.symbol), exchange: i.exchange === 'NFO' ? 'NFO' : 'NSE' }))

        const id = makeId()
        const watchlist: Watchlist = { id, name: raw.name.trim() || 'Imported watchlist', items }
        const watchlists = [...get().watchlists, watchlist]
        set({ watchlists })
        persist(watchlists, get().activeWatchlistId)
        return { ok: true, id }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON' }
      }
    },

    exportJson(watchlistId) {
      const watchlist = get().watchlists.find((w) => w.id === watchlistId)
      if (!watchlist) return null
      return JSON.stringify({ name: watchlist.name, items: watchlist.items }, null, 2)
    },
  }
})
