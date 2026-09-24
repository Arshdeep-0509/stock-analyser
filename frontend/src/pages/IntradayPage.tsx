import { FlaskConical } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useIntradayStore } from '../app/intradayStore'
import { dataSource } from '../app/dataSource'
import { useScreenerStore } from '../app/screenerStore'
import { Badge, MetricInfo, PanelErrorBoundary, Skeleton } from '../components/ui'
import { ActiveFilterBar } from '../features/intraday/ActiveFilterBar'
import { BreakoutPanels } from '../features/intraday/BreakoutPanels'
import { DashboardControls } from '../features/intraday/DashboardControls'
import { DensityProvider, type Density } from '../features/intraday/DensityContext'
import { IndexMeter } from '../features/intraday/IndexMeter'
import { InstrumentDrawer } from '../features/intraday/InstrumentDrawer'
import { IntradayIndexChart } from '../features/intraday/IntradayIndexChart'
import { MarketMeter } from '../features/intraday/MarketMeter'
import { MarketOpenContext, Panel } from '../features/intraday/Panel'
import { PanelPlaceholder } from '../features/intraday/PanelPlaceholder'
import { QuoteStrip } from '../features/intraday/QuoteStrip'
import { SectorGrid, SCROLL_ROOT_ID } from '../features/intraday/SectorGrid'
import { SectorStrength } from '../features/intraday/SectorStrength'
import { SmartMoney } from '../features/intraday/SmartMoney'
import { TopStrengthTable } from '../features/intraday/TopStrengthTable'
import { useIntradayShortcuts } from '../features/intraday/useIntradayShortcuts'
import { useIntradayUrlSync } from '../features/intraday/urlFilters'
import { cn } from '../lib/cn'
import { getMarketSession, type MarketSession } from '../lib/marketSession'
import { loadVersioned, saveVersioned } from '../lib/persistence'
import { useRenderCount } from '../lib/renderCounter'

const SESSION_LABEL: Record<MarketSession, string> = {
  OPEN: 'MARKET OPEN',
  'PRE-OPEN': 'PRE-OPEN',
  CLOSED: 'MARKET CLOSED',
}

const SEARCH_INPUT_ID = 'intraday-instrument-search'
const DENSITY_STORAGE_KEY = 'intraday:density'
const DENSITY_STORAGE_VERSION = 1
const SEARCH_DEBOUNCE_MS = 250
const INTRADAY_DISCLAIMER =
  'Sector and index membership is a hand-authored mapping for this prototype. Market data is generated locally. Not investment advice.'

function loadInitialDensity(): Density {
  return loadVersioned<Density>(DENSITY_STORAGE_KEY, DENSITY_STORAGE_VERSION, () => null) ?? 'comfortable'
}

/**
 * The simulated clock, sampled once a real second. Lives in the leaf
 * components that display it (SessionBar, LiveDashboardControls), never in
 * IntradayPage itself — otherwise every panel on the page would re-render
 * once a second just to move a countdown.
 */
function useSimulatedNow(): number {
  const [now, setNow] = useState(() => dataSource.getNow())
  useEffect(() => {
    const id = window.setInterval(() => setNow(dataSource.getNow()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/** Open (or devtools-forced open) per the simulated clock. Sampled once a second, but a boolean: it re-renders only when the session flips. */
function useMarketOpen(): boolean {
  const read = (): boolean => dataSource.getDevState().forceSessionOpen || getMarketSession(new Date(dataSource.getNow() * 1000)) === 'OPEN'
  const [open, setOpen] = useState(read)
  useEffect(() => {
    const id = window.setInterval(() => setOpen(read()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return open
}

function LiveDashboardControls({ density, onDensityChange }: { density: Density; onDensityChange: (next: Density) => void }) {
  const now = useSimulatedNow()
  useRenderCount('DashboardControls')
  return <DashboardControls store={useIntradayStore} density={density} onDensityChange={onDensityChange} now={now} />
}

/** QuoteStrip's own subscriptions — index quotes and headerCounts are replaced once a second, and only this strip should re-render for them. */
function LiveQuoteStrip() {
  const indexQuotes = useIntradayStore((s) => s.indexQuotes)
  const headerCounts = useIntradayStore((s) => s.meters.headerCounts)
  return <QuoteStrip indexQuotes={indexQuotes} headerCounts={headerCounts} />
}

/** Its own leaf, so progress ticks during a load re-render one line of text, not the whole page. */
function LoadProgressLine() {
  const loading = useIntradayStore((s) => s.loadState === 'loading')
  const done = useIntradayStore((s) => s.loadProgress.done)
  const total = useIntradayStore((s) => s.loadProgress.total)
  if (!loading) return null
  return (
    <p className="-mt-2 text-xs text-text-secondary">
      Loading {done} / {total} instruments…
    </p>
  )
}

function SessionBar() {
  // Session status reads the injectable (simulated) clock, not real wall-clock
  // time, so the devtools panel's speed/force-session controls move this bar
  // exactly like they move the rest of the app.
  const now = useSimulatedNow()
  const session: MarketSession = getMarketSession(new Date(now * 1000))
  const isOpen = session === 'OPEN'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs font-semibold tracking-wide',
        isOpen ? 'bg-bullish/15 text-bullish-text' : 'bg-text-muted/10 text-text-secondary',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', isOpen ? 'animate-pulse bg-bullish' : 'bg-text-muted')} aria-hidden="true" />
      {SESSION_LABEL[session]}
    </span>
  )
}

/** Grid-template-areas for the page body — a real CSS grid (not flex) so a later step can reflow it without restructuring the JSX, even though every area is currently a single stacked column. */
const GRID_STYLE = {
  display: 'grid',
  gridTemplateAreas: '"quotes" "meters" "intradayIndex" "topStrength" "breakoutPair" "sectorGrid"',
  // An implicit `auto` column sizes to the widest item's min-content — TopStrengthTable's 856px scrolling grid — and drags every panel out to that width on a phone. minmax(0, 1fr) pins the column to the viewport; wide tables scroll inside their own containers instead.
  gridTemplateColumns: 'minmax(0, 1fr)',
  rowGap: '1rem',
} as const

export function IntradayPage() {
  // A boolean, not `rows` itself — the page shell must not re-render on every tick flush.
  const hasRows = useIntradayStore((s) => s.rows.length > 0)
  const filterQ = useIntradayStore((s) => s.filters.q)
  const loadState = useIntradayStore((s) => s.loadState)
  useRenderCount('IntradayPage')

  const [density, setDensity] = useState<Density>(loadInitialDensity)
  const [searchDraft, setSearchDraft] = useState(filterQ)

  useEffect(() => {
    void useIntradayStore.getState().init()
    return () => useIntradayStore.getState().stop()
  }, [])

  // "Scrubbing rewinds the WHOLE dashboard" — dataSource.subscribeDevState()
  // fires only on discrete clock-CONTROL actions (the devtools panel's
  // speed/force-session toggles — see setClockMode/setSpeed's own
  // notifyDevListeners() calls), never on ordinary live ticking, so this
  // can't turn into a refresh storm. Reacting here (rather than editing the
  // shared AppShell, which /rsi-ha also depends on) keeps the "one clock"
  // integration one-directional and low-risk.
  useEffect(() => {
    return dataSource.subscribeDevState(() => {
      void useIntradayStore.getState().refreshAll()
    })
  }, [])

  useIntradayUrlSync(useIntradayStore)
  useIntradayShortcuts(useIntradayStore, SEARCH_INPUT_ID)

  function changeDensity(next: Density): void {
    setDensity(next)
    saveVersioned(DENSITY_STORAGE_KEY, DENSITY_STORAGE_VERSION, next)
  }

  useEffect(() => {
    setSearchDraft(filterQ)
  }, [filterQ])

  useEffect(() => {
    if (searchDraft === filterQ) return
    const id = window.setTimeout(() => useIntradayStore.getState().setFilters({ q: searchDraft }), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  const isFirstLoad = loadState === 'loading' && !hasRows
  const marketOpen = useMarketOpen()

  return (
    <MarketOpenContext.Provider value={marketOpen}>
      <DensityProvider density={density}>
        <div id={SCROLL_ROOT_ID} className="flex h-full flex-col gap-3 overflow-y-auto p-4">
          <header className="flex flex-wrap items-center gap-2">
            <h1 className="text-sm font-semibold uppercase tracking-wide text-text-primary">INTRADAY DASHBOARD · F&O</h1>
            <SessionBar />
            <input
              id={SEARCH_INPUT_ID}
              type="text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search instrument… (/)"
              aria-label="Search instrument"
              className="h-7 w-40 rounded border border-border-hairline bg-panel px-2 text-xs text-text-primary placeholder:text-text-muted"
            />
            <Badge
              variant="warning"
              outline
              className="ml-auto"
              title="Every number on screen comes from a locally-generated mock market, not a real broker feed."
            >
              <FlaskConical className="h-3 w-3" aria-hidden="true" />
              PROTOTYPE · SIMULATED DATA
            </Badge>
          </header>

          <LiveDashboardControls density={density} onDensityChange={changeDensity} />

          <ActiveFilterBar store={useIntradayStore} />

          <LoadProgressLine />

          <div style={GRID_STYLE}>
            <div style={{ gridArea: 'quotes' }}>
              <PanelErrorBoundary panelName="Quote strip">
                <LiveQuoteStrip />
              </PanelErrorBoundary>
            </div>

            {/* Meters: 1-up below md, 2x2 at md/lg, 4-up at xl. */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4" style={{ gridArea: 'meters' }}>
              <PanelErrorBoundary panelName="Market Meter">
                <Panel title="Market Meter" live={loadState === 'ready'} toolbar={<MetricInfo metric="marketMeter" />}>
                  {isFirstLoad ? <PanelPlaceholder loading /> : <MarketMeter store={useIntradayStore} />}
                </Panel>
              </PanelErrorBoundary>
              <PanelErrorBoundary panelName="Index Meter">
                <Panel title="Index Meter" live={loadState === 'ready'} toolbar={<MetricInfo metric="indexMeter" />}>
                  {isFirstLoad ? <PanelPlaceholder loading /> : <IndexMeter store={useIntradayStore} />}
                </Panel>
              </PanelErrorBoundary>
              <PanelErrorBoundary panelName="Sector Strength">
                <Panel title="Sector Strength" live={loadState === 'ready'} toolbar={<MetricInfo metric="sectorStrength" />}>
                  {isFirstLoad ? <PanelPlaceholder loading /> : <SectorStrength store={useIntradayStore} />}
                </Panel>
              </PanelErrorBoundary>
              <PanelErrorBoundary panelName="Smart Money">
                <Panel title="Smart Money" live={loadState === 'ready'} toolbar={<MetricInfo metric="smartMoney" />}>
                  {isFirstLoad ? <PanelPlaceholder loading /> : <SmartMoney store={useIntradayStore} />}
                </Panel>
              </PanelErrorBoundary>
            </div>

            <div style={{ gridArea: 'intradayIndex' }}>
              <PanelErrorBoundary panelName="Intraday Index">
                <Panel title="Intraday Index" live={loadState === 'ready'} toolbar={<MetricInfo metric="capWeight" />}>
                  {isFirstLoad ? <PanelPlaceholder loading /> : <IntradayIndexChart store={useIntradayStore} />}
                </Panel>
              </PanelErrorBoundary>
            </div>

            <div style={{ gridArea: 'topStrength' }}>
              <PanelErrorBoundary panelName="Top Strength">
                {isFirstLoad ? (
                  <Panel title="Top Intraday Strength · F&O" live={false}>
                    <PanelPlaceholder loading />
                  </Panel>
                ) : (
                  <TopStrengthTable store={useIntradayStore} />
                )}
              </PanelErrorBoundary>
            </div>

            {/* Breakout / BreakDown: stacked below lg, side by side at lg — BreakoutPanels itself owns that grid. */}
            <div style={{ gridArea: 'breakoutPair' }}>
              {isFirstLoad ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <PanelErrorBoundary panelName="Breakout">
                    <Panel title="Breakout" accent="bullish" live={false}>
                      <PanelPlaceholder loading />
                    </Panel>
                  </PanelErrorBoundary>
                  <PanelErrorBoundary panelName="BreakDown">
                    <Panel title="BreakDown" accent="bearish" live={false}>
                      <PanelPlaceholder loading />
                    </Panel>
                  </PanelErrorBoundary>
                </div>
              ) : (
                <PanelErrorBoundary panelName="Breakout / BreakDown">
                  <BreakoutPanels store={useIntradayStore} />
                </PanelErrorBoundary>
              )}
            </div>

            {/* Sector panel grid: 1-up below lg, 2-up at lg/xl — SectorGrid itself owns that layout. */}
            <div style={{ gridArea: 'sectorGrid' }}>
              {isFirstLoad ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="h-40 w-full" />
                  ))}
                </div>
              ) : (
                <PanelErrorBoundary panelName="Sector grid">
                  <SectorGrid store={useIntradayStore} />
                </PanelErrorBoundary>
              )}
            </div>
          </div>

          <footer className="border-t border-border-hairline pt-3 text-[11px] leading-relaxed text-text-muted">{INTRADAY_DISCLAIMER}</footer>

          <PanelErrorBoundary panelName="Drill-down drawer">
            <InstrumentDrawer store={useIntradayStore} screenerStore={useScreenerStore} />
          </PanelErrorBoundary>
        </div>
      </DensityProvider>
    </MarketOpenContext.Provider>
  )
}
