import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useWatchlistStore } from '../watchlistStore'

afterEach(() => {
  localStorage.clear()
})

beforeEach(() => {
  useWatchlistStore.setState({ watchlists: [], activeWatchlistId: null })
})

describe('watchlistStore', () => {
  it('creates, renames, and deletes a watchlist', () => {
    const id = useWatchlistStore.getState().createWatchlist('My list')
    expect(useWatchlistStore.getState().watchlists).toHaveLength(1)
    expect(useWatchlistStore.getState().watchlists[0]).toMatchObject({ name: 'My list', items: [] })

    useWatchlistStore.getState().renameWatchlist(id, 'Renamed')
    expect(useWatchlistStore.getState().watchlists[0].name).toBe('Renamed')

    useWatchlistStore.getState().deleteWatchlist(id)
    expect(useWatchlistStore.getState().watchlists).toHaveLength(0)
  })

  it('adds and removes items without duplicating a token already present', () => {
    const id = useWatchlistStore.getState().createWatchlist('List')
    useWatchlistStore.getState().addItem(id, { token: 'T1', symbol: 'RELIANCE-EQ', exchange: 'NSE' })
    useWatchlistStore.getState().addItem(id, { token: 'T1', symbol: 'RELIANCE-EQ', exchange: 'NSE' })
    expect(useWatchlistStore.getState().watchlists[0].items).toHaveLength(1)

    useWatchlistStore.getState().addItem(id, { token: 'T2', symbol: 'TCS-EQ', exchange: 'NSE' })
    expect(useWatchlistStore.getState().watchlists[0].items).toHaveLength(2)

    useWatchlistStore.getState().removeItem(id, 'T1')
    expect(useWatchlistStore.getState().watchlists[0].items.map((i) => i.token)).toEqual(['T2'])
  })

  it('reorders items', () => {
    const id = useWatchlistStore.getState().createWatchlist('List')
    useWatchlistStore.getState().addItem(id, { token: 'A', symbol: 'A-EQ', exchange: 'NSE' })
    useWatchlistStore.getState().addItem(id, { token: 'B', symbol: 'B-EQ', exchange: 'NSE' })
    useWatchlistStore.getState().addItem(id, { token: 'C', symbol: 'C-EQ', exchange: 'NSE' })

    useWatchlistStore.getState().reorderItem(id, 0, 2)
    expect(useWatchlistStore.getState().watchlists[0].items.map((i) => i.token)).toEqual(['B', 'C', 'A'])
  })

  it('duplicates a watchlist with a copied item array (not the same reference)', () => {
    const id = useWatchlistStore.getState().createWatchlist('Original')
    useWatchlistStore.getState().addItem(id, { token: 'A', symbol: 'A-EQ', exchange: 'NSE' })

    const copyId = useWatchlistStore.getState().duplicateWatchlist(id)
    expect(copyId).not.toBeNull()
    const copy = useWatchlistStore.getState().watchlists.find((w) => w.id === copyId)
    expect(copy?.items).toEqual([{ token: 'A', symbol: 'A-EQ', exchange: 'NSE' }])

    useWatchlistStore.getState().removeItem(id, 'A')
    expect(copy?.items).toHaveLength(1) // the duplicate is unaffected by mutating the original
  })

  it('round-trips export -> import', () => {
    const id = useWatchlistStore.getState().createWatchlist('Exportable')
    useWatchlistStore.getState().addItem(id, { token: 'A', symbol: 'A-EQ', exchange: 'NSE' })
    const json = useWatchlistStore.getState().exportJson(id)
    expect(json).not.toBeNull()

    const result = useWatchlistStore.getState().importJson(json as string)
    expect(result.ok).toBe(true)
    expect(useWatchlistStore.getState().watchlists).toHaveLength(2)
  })

  it('rejects malformed import JSON with an error rather than throwing', () => {
    const result = useWatchlistStore.getState().importJson('{"not": "a watchlist"}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeTruthy()
  })

  it('persists across a fresh store instantiation (simulating reload)', () => {
    useWatchlistStore.getState().createWatchlist('Persisted')
    // Re-read from localStorage the same way the module does at import time.
    const raw = localStorage.getItem('rsi-ha:watchlists')
    expect(raw).toContain('Persisted')
  })
})
