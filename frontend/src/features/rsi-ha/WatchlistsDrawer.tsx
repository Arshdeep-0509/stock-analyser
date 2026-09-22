import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, Download, GripVertical, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { cn } from '../../lib/cn'
import { useEscapeToClose } from '../../lib/useEscapeToClose'
import type { ScreenerStore } from '../../store/screenerStore'
import { useWatchlistStore, type WatchlistItem } from '../../store/watchlistStore'
import type { MarketDataSource } from '../../data/MarketDataSource'
import type { SearchResult } from '../../types/api'
import type { Exchange } from '../../types/domain'

export interface WatchlistsDrawerProps {
  open: boolean
  onClose: () => void
  dataSource: Pick<MarketDataSource, 'searchSymbol'>
  store: ScreenerStore
}

const SEARCH_DEBOUNCE_MS = 250

export function WatchlistsDrawer({ open, onClose, dataSource, store }: WatchlistsDrawerProps) {
  const watchlists = useWatchlistStore((s) => s.watchlists)
  const activeId = useWatchlistStore((s) => s.activeWatchlistId)
  const active = watchlists.find((w) => w.id === activeId) ?? null

  const [newListName, setNewListName] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set())
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSelectedTokens(new Set())
    setQuery('')
    setResults([])
  }, [activeId])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    const id = window.setTimeout(() => {
      void dataSource.searchSymbol(query).then((res) => {
        setResults(res.result)
        setHighlightIndex(0)
        setSearching(false)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [query, dataSource])

  useEscapeToClose(open, onClose)

  if (!open) return null

  function addResultToActiveWatchlist(result: SearchResult) {
    if (!active) return
    const exchange: Exchange = result.exchange === 'NFO' ? 'NFO' : 'NSE'
    const item: WatchlistItem = { token: String(result.token), symbol: result.trading_symbol, exchange }
    useWatchlistStore.getState().addItem(active.id, item)
    setQuery('')
    setResults([])
  }

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const picked = results[highlightIndex]
      if (picked) addResultToActiveWatchlist(picked)
    }
  }

  function handleDrop(targetIndex: number) {
    if (!active || dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      return
    }
    useWatchlistStore.getState().reorderItem(active.id, dragIndex, targetIndex)
    setDragIndex(null)
  }

  function handleImportFile(file: File) {
    void file.text().then((text) => {
      const result = useWatchlistStore.getState().importJson(text)
      setImportError(result.ok ? null : result.error)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-surface/70" onClick={onClose} />
      <div
        className="relative flex h-full w-full flex-col border-l border-border bg-panel sm:w-[min(420px,100%)]"
        role="dialog"
        aria-modal="true"
        aria-label="Watchlists"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-panel px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">Watchlists</h2>
          <IconButton aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        <div className="flex items-center gap-2 border-b border-border-hairline px-4 py-2">
          <Select
            value={activeId ?? ''}
            onChange={(e) => useWatchlistStore.getState().setActiveWatchlist(e.target.value || null)}
            className="flex-1"
          >
            <option value="">Select a watchlist…</option>
            {watchlists.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.items.length})
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-2 border-b border-border-hairline px-4 py-2">
          <Input
            value={newListName}
            onChange={(e) => setNewListName(e.target.value)}
            placeholder="New watchlist name"
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newListName.trim()) {
                const id = useWatchlistStore.getState().createWatchlist(newListName)
                useWatchlistStore.getState().setActiveWatchlist(id)
                setNewListName('')
              }
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!newListName.trim()}
            onClick={() => {
              const id = useWatchlistStore.getState().createWatchlist(newListName)
              useWatchlistStore.getState().setActiveWatchlist(id)
              setNewListName('')
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Create
          </Button>
        </div>

        {active ? (
          <>
            <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border-hairline px-4 py-2">
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => {
                  const name = window.prompt('Rename watchlist', active.name)
                  if (name) useWatchlistStore.getState().renameWatchlist(active.id, name)
                }}
              >
                Rename
              </Button>
              <Button size="sm" variant="ghost" className="shrink-0" onClick={() => useWatchlistStore.getState().duplicateWatchlist(active.id)}>
                <Copy className="h-3.5 w-3.5" /> Duplicate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => {
                  const json = useWatchlistStore.getState().exportJson(active.id)
                  if (json) void navigator.clipboard.writeText(json)
                }}
              >
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
              <Button size="sm" variant="ghost" className="shrink-0" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Import
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleImportFile(file)
                  e.target.value = ''
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => {
                  if (window.confirm(`Delete "${active.name}"?`)) useWatchlistStore.getState().deleteWatchlist(active.id)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
            {importError && <p className="border-b border-border-hairline px-4 py-1.5 text-xs text-bearish">Import failed: {importError}</p>}

            <div className="relative border-b border-border-hairline px-4 py-2">
              <span className="relative inline-flex w-full items-center">
                <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-text-muted" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Search symbol to add…"
                  className="w-full pl-7"
                />
              </span>
              {query.trim() && (
                <div className="absolute left-4 right-4 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded border border-border bg-panel shadow-lg">
                  {searching ? (
                    <p className="px-3 py-2 text-xs text-text-muted">Searching…</p>
                  ) : results.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-text-muted">No results for "{query}"</p>
                  ) : (
                    results.map((result, i) => (
                      <button
                        key={String(result.token)}
                        type="button"
                        onClick={() => addResultToActiveWatchlist(result)}
                        onMouseEnter={() => setHighlightIndex(i)}
                        className={cn('flex w-full items-center justify-between px-3 py-1.5 text-left text-xs', i === highlightIndex ? 'bg-neutral/15 text-text-primary' : 'text-text-secondary')}
                      >
                        <span className="font-medium">{result.trading_symbol}</span>
                        <span className="flex items-center gap-2 text-text-muted">
                          {result.exchange} · {String(result.token)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-b border-border-hairline px-4 py-1.5 text-xs text-text-secondary">
              <span>{active.items.length} instrument{active.items.length === 1 ? '' : 's'}</span>
              {selectedTokens.size > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    useWatchlistStore.getState().bulkRemove(active.id, Array.from(selectedTokens))
                    setSelectedTokens(new Set())
                  }}
                >
                  <Trash2 className="h-3 w-3" /> Remove {selectedTokens.size} selected
                </Button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {active.items.length === 0 ? (
                <p className="p-4 text-xs text-text-muted">No instruments yet — search above to add some.</p>
              ) : (
                active.items.map((item, index) => (
                  <div
                    key={item.token}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(index)}
                    className={cn('flex items-center gap-2 border-b border-border-hairline px-4 py-2 text-sm', dragIndex === index && 'opacity-50')}
                  >
                    <GripVertical className="hidden h-3.5 w-3.5 shrink-0 cursor-grab text-text-muted md:block" aria-hidden="true" />
                    {/* Side by side, not stacked — each needs its own 40x40 tap target below md, which a vertical stack can't give both without doubling the row height. */}
                    <span className="flex shrink-0 items-center">
                      <IconButton
                        aria-label={`Move ${item.symbol} up`}
                        disabled={index === 0}
                        onClick={() => useWatchlistStore.getState().reorderItem(active.id, index, index - 1)}
                      >
                        <ChevronUp className="h-3 w-3" />
                      </IconButton>
                      <IconButton
                        aria-label={`Move ${item.symbol} down`}
                        disabled={index === active.items.length - 1}
                        onClick={() => useWatchlistStore.getState().reorderItem(active.id, index, index + 1)}
                      >
                        <ChevronDown className="h-3 w-3" />
                      </IconButton>
                    </span>
                    <IconButton
                      aria-label={selectedTokens.has(item.token) ? `Deselect ${item.symbol}` : `Select ${item.symbol}`}
                      onClick={() =>
                        setSelectedTokens((prev) => {
                          const next = new Set(prev)
                          if (next.has(item.token)) next.delete(item.token)
                          else next.add(item.token)
                          return next
                        })
                      }
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded border',
                          selectedTokens.has(item.token) ? 'border-neutral bg-neutral text-white' : 'border-border',
                        )}
                      >
                        {selectedTokens.has(item.token) && <Check className="h-3 w-3" />}
                      </span>
                    </IconButton>
                    <span className="flex-1 truncate text-text-primary">{item.symbol}</span>
                    <span className="hidden text-xs text-text-muted sm:inline">{item.exchange}</span>
                    <IconButton
                      aria-label={`Remove ${item.symbol}`}
                      onClick={() => useWatchlistStore.getState().removeItem(active.id, item.token)}
                      className="text-text-muted hover:text-bearish"
                    >
                      <X className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-border px-4 py-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  store.getState().setWatchlistTokens(active.items.map((i) => i.token))
                  store.getState().setUniverseMode('watchlist')
                  onClose()
                }}
              >
                Scan this watchlist
              </Button>
            </div>
          </>
        ) : (
          <p className="p-4 text-xs text-text-muted">Create or select a watchlist to manage its instruments.</p>
        )}
      </div>
    </div>
  )
}
