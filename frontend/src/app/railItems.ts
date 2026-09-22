import { Bell, ScanSearch, Star, SlidersHorizontal, History, Settings } from 'lucide-react'
import type { PanelKey } from '../store/uiStore'

// Shared by LeftRail (the >=sm icon rail) and MobileNavChips (the <sm chip
// strip) — both are the same set of destinations, just two different visual
// representations of it.
export const railItems: ReadonlyArray<{ icon: typeof ScanSearch; label: string; panel: PanelKey | null }> = [
  { icon: ScanSearch, label: 'Screener', panel: null },
  { icon: Star, label: 'Watchlists', panel: 'watchlists' },
  { icon: SlidersHorizontal, label: 'Parameters', panel: 'parameters' },
  { icon: Bell, label: 'Alerts', panel: 'alerts' },
  { icon: History, label: 'History', panel: 'history' },
  { icon: Settings, label: 'Settings', panel: 'settings' },
]
