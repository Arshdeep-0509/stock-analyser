import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FlaskConical, Moon, Settings, Sun, TrendingUp } from 'lucide-react'
import { formatISTTime } from '../lib/formatters'
import { getMarketSession, type MarketSession } from '../lib/marketSession'
import { StatusDot } from '../components/ui/StatusDot'
import { Badge } from '../components/ui/Badge'
import { useScreenerStore } from './screenerStore'
import { useUiStore } from '../store/uiStore'

const sessionVariant: Record<MarketSession, 'bullish' | 'warning' | 'default'> = {
  OPEN: 'bullish',
  'PRE-OPEN': 'warning',
  CLOSED: 'default',
}

export function TopBar() {
  const [now, setNow] = useState(() => new Date())
  const connectionState = useScreenerStore((s) => s.connectionState)
  const theme = useUiStore((s) => s.theme)

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const session = getMarketSession(now)

  return (
    <header className="flex min-h-[56px] shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-panel px-4 py-1.5 desktop:h-topbar desktop:flex-nowrap desktop:py-0">
      <div className="flex items-center gap-3 desktop:gap-6">
        <Link to="/rsi-ha" className="flex items-center gap-2 text-text-primary">
          <TrendingUp className="h-4 w-4 text-neutral" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">RSI-HA</span>
        </Link>
        <Badge variant="warning" outline title="Every number on screen comes from a locally-generated mock market, not a real broker feed.">
          <FlaskConical className="h-3 w-3" aria-hidden="true" />
          PROTOTYPE — SIMULATED DATA
        </Badge>
      </div>

      <div className="flex items-center gap-3 desktop:gap-4">
        <span className="hidden font-mono text-xs tabular-nums text-text-secondary desktop:inline">
          {formatISTTime(now)} IST (simulated market clock)
        </span>
        <Badge variant={sessionVariant[session]}>{session}</Badge>
        <StatusDot status={connectionState} />
        <button
          type="button"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={() => useUiStore.getState().toggleTheme()}
          className="text-text-secondary hover:text-text-primary"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          aria-label="Settings"
          onClick={() => useUiStore.getState().togglePanel('settings')}
          className="text-text-secondary hover:text-text-primary"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  )
}
