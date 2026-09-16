# Backend handoff

How to point this prototype at a real FastAPI backend instead of the mock.
Read [`STRATEGY-CONTRACT.md`](./STRATEGY-CONTRACT.md) first — this document
assumes it.

## 1. What actually has to change

The engine (`src/strategy/`, `src/features/rsi-ha/scanner.ts`,
`src/store/screenerStore.ts`) only ever depends on the `MarketDataSource`
interface (`src/data/MarketDataSource.ts`), never on the mock concretely.
Swapping data sources is one file:

```ts
// src/app/dataSource.ts
export const dataSource = new MockMarketDataSource()
//                          ^^^^^^^^^^^^^^^^^^^^^^^^^
// becomes:
export const dataSource = new HttpMarketDataSource(/* base URL, auth, ... */)
```

`HttpMarketDataSource` (new file, doesn't exist yet) must implement the same
four methods `MockMarketDataSource` does — `searchSymbol`,
`fetchHistoricalCandles`, `loadScripMaster`, `subscribeTicks`, plus
`getConnectionState()` — against the real REST endpoints and the real Primus
WebSocket (§2 below). Its `subscribeTicks()` is the "WS adapter": a class or
module that opens the real `primusapi.tradelab.in` connection, parses each
raw `PrimusTick`, and hands callers the normalised `MarketTick` — exactly
what `MockPrimusSocket` (`src/data/mock/mockPrimus.ts`) does today, just
against a real socket instead of a generated one.

**Nothing else changes.** Every consumer of `MarketDataSource` — the
scanner, the store, the table, the detail drawer, Watchlists, Alerts,
History, Parameters — was written against the interface only and needs zero
edits.

### What does NOT carry over (mock-only, no real-backend equivalent)

These import `MockMarketDataSource` (the concrete class) directly, not the
`MarketDataSource` interface, specifically to reach dev/replay-only methods
(`setSeed`, `setSpeed`, `setClockMode`, `setFastForward`,
`forceDisconnect`, `forceNextRequestError`, `regenerateUniverse`,
`getDevState`/`subscribeDevState`) that a real backend has no analogue for —
there's no "seed" or "simulated clock" on a live broker feed:

| File | What it needs from the mock | What to do against a real backend |
| --- | --- | --- |
| `src/features/rsi-ha/ReplayTransportBar.tsx` | Rewinds/fast-forwards the mock's simulated clock | Remove, or keep only for a "replay a recorded session" feature backed by *stored* historical data — a real market has no clock to rewind |
| `src/data/mock/MockDevtoolsPanel.tsx` | Seed/speed/force-error dev controls | Remove (it's already gated behind the `` ` `` key and never shown by default) |
| `src/features/rsi-ha/SettingsDrawer.tsx` | The "Simulated market" section (seed, universe size) | Remove that section; keep the theme toggle and shortcuts entry, which are backend-agnostic |
| `src/app/useGlobalShortcuts.ts` | The `1`–`4` replay-speed shortcut (`dataSource.setSpeed`) | Remove that one branch; `p`/`r`/`g`-nav/`?` are all backend-agnostic |
| `src/app/AppShell.tsx` | Mounts the three components above | Stop mounting them (or gate behind an `import.meta.env.DEV`-style flag if a real backend later grows its own replay/fixture mode) |

## 2. Endpoints the backend must expose

`MarketDataSource` is a 1:1 mirror of what `mastertrust_rsi_ha_screener.py`
itself calls — the backend doesn't need to invent anything beyond what the
Python already does against Mastertrust's API:

| `MarketDataSource` method | Real endpoint (per the Python + STRATEGY-CONTRACT.md §3) | Response shape |
| --- | --- | --- |
| `searchSymbol(keyword)` | `GET /api/v1/search?key=<keyword>` | `{ error, result: [{ exchange, trading_symbol, token, ... }] }` |
| `fetchHistoricalCandles(token, exchange, interval, daysBack)` | `GET /api/v1/charts/tdv` — params `token`, `exchange`, `starttime`/`endtime` (unix seconds), `candletype=1`, `data_duration` (interval in minutes) | `{ data: { candles: RawCandleRow[] } }`, `RawCandleRow` a **positional tuple** `[datetime, open, high, low, close, volume]` — must have the still-forming last candle already dropped, or drop it server-side/client-side per §3.2 |
| `loadScripMaster()` | `GET /api/v1/contract/Compact?info=download` | A zip containing `CompactScrip.csv`; the backend can either proxy the zip (frontend unzips) or pre-parse and serve JSON matching `ScripRow[]` (`src/types/api.ts`) — server-side parsing is simpler and recommended |
| `subscribeTicks(tokens, onTick)` | WebSocket `primusapi.tradelab.in` | Stream of `PrimusTick` (§3.4 — see below, unconfirmed) |
| `getConnectionState()` | Derived from the WS adapter's own connection lifecycle | `'connecting' \| 'connected' \| 'disconnected' \| 'replaying'` (the mock's `'replaying'` state has no real-backend equivalent — see the ReplayTransportBar row above) |

Authentication (`--login`, access-token exchange, lines 105–170 of the
Python) isn't modelled in `MarketDataSource` at all — per this project's
frontend-only hard rule, no API keys or secrets live in this codebase. A
real deployment needs the FastAPI backend to hold the broker session/token
and expose its own authenticated REST API for the frontend to call; that
backend-side auth design is out of scope here.

## 3. UNCONFIRMED contract items — nail these down before writing `HttpMarketDataSource`

Both come from STRATEGY-CONTRACT.md §3 and are UNCONFIRMED because the
Python source itself doesn't pin them down (it either never establishes a
WS connection, or lets `pandas` guess a format):

1. **`/api/v1/charts/tdv`'s timestamp format** (§3.2). The Python does
   `pd.to_datetime(df["datetime"])` with no explicit `format=`, so whether
   the wire value is an ISO-8601 string or epoch seconds/milliseconds is
   unknown. `parseCandleTimestamp()` (`src/types/api.ts`) currently handles
   both defensively and logs which one it detected (dev console only). Once
   confirmed against a real response, delete the dead branch — don't do it
   speculatively.
2. **The Primus WebSocket tick payload** (§3.4). Not present anywhere in
   `mastertrust_rsi_ha_screener.py` — the Python only polls REST on a
   `SCAN_EVERY_SECONDS` timer, it has no live tick feed at all. `PrimusTick`
   (`src/types/api.ts`) defines only the fields the UI needs (`token`,
   `exchange`, `ltp`, `ltt`, `volume`, optional OHLC) and is marked
   `// TODO(contract)`. The real backend integration is the first place this
   payload will actually be observed — confirm it there, then update
   `PrimusTick` and the tick-normalisation adapter together. Nothing outside
   the data layer consumes `PrimusTick` directly (everything downstream
   reads the normalised `MarketTick`), so this is a one-file change once
   confirmed.

Until both are confirmed, `HttpMarketDataSource` can be written and tested
against recorded/sample real responses, but should not be trusted to handle
every live edge case silently.
