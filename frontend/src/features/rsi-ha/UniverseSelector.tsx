import { Select } from '../../components/ui/Select'
import { formatINR } from '../../lib/formatters'
import { useWatchlistStore } from '../../store/watchlistStore'
import type { ScreenerStore } from '../../store/screenerStore'
import type { UniverseMode } from '../../store/types'

export interface UniverseSelectorProps {
  store: ScreenerStore
}

type SelectorValue = 'equity' | 'futures' | 'both' | `watchlist:${string}`

/** Parses the <select>'s single string value back into a UniverseMode plus (for 'watchlist') which one. */
function parseValue(value: SelectorValue): { mode: UniverseMode; watchlistId: string | null } {
  if (value.startsWith('watchlist:')) return { mode: 'watchlist', watchlistId: value.slice('watchlist:'.length) }
  return { mode: value as Exclude<SelectorValue, `watchlist:${string}`>, watchlistId: null }
}

export function UniverseSelector({ store }: UniverseSelectorProps) {
  const universeMode = store((s) => s.universeMode)
  const stats = store((s) => s.universeStats)
  const watchlists = useWatchlistStore((s) => s.watchlists)
  const activeWatchlistId = useWatchlistStore((s) => s.activeWatchlistId)
  const minPrice = store((s) => s.params.minPrice)

  const value: SelectorValue = universeMode === 'watchlist' && activeWatchlistId ? `watchlist:${activeWatchlistId}` : universeMode === 'watchlist' ? 'both' : universeMode

  const dropped = Math.max(0, stats.eligible - stats.included)

  return (
    <div className="flex items-center gap-3 border-b border-border bg-panel px-3 py-1.5 text-xs">
      <Select
        aria-label="Universe"
        value={value}
        onChange={(e) => {
          const parsed = parseValue(e.target.value as SelectorValue)
          if (parsed.mode === 'watchlist' && parsed.watchlistId) {
            const watchlist = watchlists.find((w) => w.id === parsed.watchlistId)
            useWatchlistStore.getState().setActiveWatchlist(parsed.watchlistId)
            store.getState().setWatchlistTokens(watchlist?.items.map((i) => i.token) ?? [])
          }
          store.getState().setUniverseMode(parsed.mode)
        }}
      >
        <option value="equity">All NSE equity</option>
        <option value="futures">All stock futures</option>
        <option value="both">Both</option>
        {watchlists.map((w) => (
          <option key={w.id} value={`watchlist:${w.id}`}>
            Watchlist: {w.name}
          </option>
        ))}
      </Select>

      <span className="text-text-secondary">
        Scanning {stats.included} of {stats.eligible}
        {dropped > 0 && ` (${dropped} below ${formatINR(minPrice)})`}
      </span>
    </div>
  )
}
