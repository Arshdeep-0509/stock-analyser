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
methods `MockMarketDataSource` does — `searchSymbol`,
`fetchHistoricalCandles`, `loadScripMaster`, `subscribeTicks`,
`getConnectionState()`, and the two `/intraday` additions `fetchIndexQuotes`
and `fetchDailyBars` (§2.1) — against the real REST endpoints and the real Primus
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
| `subscribeTicks(tokens, onTick, opts?)` | WebSocket `primusapi.tradelab.in` | Stream of `PrimusTick` (§3.4 — see below, unconfirmed). `opts.priority` — see §2.1 |
| `getConnectionState()` | Derived from the WS adapter's own connection lifecycle | `'connecting' \| 'connected' \| 'disconnected' \| 'replaying'` (the mock's `'replaying'` state has no real-backend equivalent — see the ReplayTransportBar row above) |
| `fetchIndexQuotes(keys)` — **new, /intraday** | `GET /api/v1/charts/tdv` against each index's own instrument token (same endpoint and parameters as any instrument) | `IndexQuote[]` (`src/data/MarketDataSource.ts`): `{ key, label, last, prevClose, changePct, time }`. Tokens are UNCONFIRMED — §3.3 |
| `fetchDailyBars(instrument, days)` — **new, /intraday** | `GET /api/v1/charts/tdv` with a day-level `data_duration` — the value is UNCONFIRMED (§3.4) | `Candle[]`, one per session, oldest first, the in-progress session's partial bar allowed as the last element |

### 2.1 The three `MarketDataSource` additions for `/intraday`

`/intraday` reads **the same** endpoints and the same Primus feed as
`/rsi-ha` (it goes through the one `dataSource` singleton in
`src/app/dataSource.ts`). The interface grew by exactly two methods and one
option — nothing else, and nothing that bypasses the interface:

- **`fetchIndexQuotes(keys: IndexQuoteKey[])`** — NIFTY 50, BANK NIFTY and
  India VIX for the quote strip. `mastertrust_rsi_ha_screener.py` never
  fetches an index, so this has no Python line to mirror; a real
  implementation is a `tdv` call per index token (last close vs. previous
  session close). The mock builds a constituent-weighted composite
  (`src/analytics/indexComposite.ts`) so the index can never disagree in sign
  with its own constituents — a real backend simply returns the real quote.
  Called once per load and at most once per second after that (it rides the
  same 1s throttle as the meters).
- **`fetchDailyBars(instrument, days)`** — session bars that Strength's
  volatility term (`sigmaDaily`, up to 20 sessions) and the 3-day change need.
  Kept separate from `fetchHistoricalCandles()` precisely because its request
  parameter is unconfirmed (§3.4). The mock aggregates its own closed 5-minute
  bars with `aggregateToSessions()` (`src/analytics/daily.ts`); a real
  implementation can do exactly the same until the day-level parameter is
  confirmed, then switch to the direct call without touching any caller.
- **`subscribeTicks(tokens, onTick, { priority })`** — the whole F&O universe
  (~90 underlyings at the default seed, up to ~200 in a real session) is
  subscribed at once. `priority` lists the tokens the page currently shows
  (the rows passing the active filters); an implementation should batch and
  bias delivery toward them, but must still eventually tick every token — it
  is a bias, not a filter. The mock's `MockPrimusSocket` ticks every priority
  token in every batch and rotates the non-priority tokens round-robin
  through the remaining batch slots. On the client side the
  intraday store buffers ticks and applies them in **one store write per
  animation frame** (`flushPendingTicks()` in `src/store/intradayStore.ts`),
  so the backend can push at whatever rate the feed naturally produces.

### 2.2 The sector / index-membership endpoint the backend will need

`CompactScrip.csv` (the only instrument metadata the Python reads) has no
sector and no index-membership column, so `/intraday`'s sector grouping and
index panels come from a hand-authored mapping in `src/data/reference/`
(`sectors.ts`, `indices.ts`) — see [`SECTOR-DATA.md`](./SECTOR-DATA.md).
The page says so in its footer. A real deployment should replace that file
with a backend endpoint, e.g.:

```
GET /api/v1/reference/sectors
→ {
    "asOf": "2026-01-05",
    "sectors": { "<base symbol>": "<sector name>", ... },
    "indices": { "<index key>": ["<base symbol>", ...], ... }
  }
```

sourced from NSE's published index constituents (and the broker's full
contract master, if it carries industry metadata the screener never read),
cached server-side and refreshed on index rebalances. The frontend change is
then confined to `enrichInstrument()` (`src/analytics/enrich.ts`) and
`INDEX_PANELS` becoming data instead of constants — no analytics function
changes, because they all read `row.sector` / `row.indices` only.

Authentication (`--login`, access-token exchange, lines 105–170 of the
Python) isn't modelled in `MarketDataSource` at all — per this project's
frontend-only hard rule, no API keys or secrets live in this codebase. A
real deployment needs the FastAPI backend to hold the broker session/token
and expose its own authenticated REST API for the frontend to call; that
backend-side auth design is out of scope here.

## 3. UNCONFIRMED contract items — nail these down before writing `HttpMarketDataSource`

Items 1–2 come from STRATEGY-CONTRACT.md §3; items 3–4 arrived with
`/intraday`. All four are UNCONFIRMED because the Python source itself
doesn't pin them down (it never establishes a WS connection, lets `pandas`
guess a format, or never makes that request at all):

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

3. **The index instrument tokens** (new with `/intraday`). `INDEX_TOKENS`
   (`src/types/api.ts`) holds deliberate placeholders —
   `UNCONFIRMED-NIFTY-50-TOKEN`, `UNCONFIRMED-NIFTY-BANK-TOKEN`,
   `UNCONFIRMED-INDIA-VIX-TOKEN` — not real tokens. The Python never fetches
   an index, so there is nothing to transliterate. Intended resolution:
   `GET /api/v1/search?key=NIFTY 50` / `NIFTY BANK` / `INDIA VIX` at runtime
   (via the existing `searchSymbol()`), using whatever token comes back; only
   fall back to a static map once the real tokens have been observed.
4. **The day-candle `data_duration`** (new with `/intraday`).
   `fetch_historical_candles()` always derives `data_duration` from
   `CANDLE_INTERVAL` ("5minute" → `5`); the Python never asks for a daily
   bar, so the day-level value is unobserved.
   `DAILY_DATA_DURATION_MINUTES_GUESS = 1440` (`src/types/api.ts`) is an
   analogy-based guess and is **not used by any request today** —
   `fetchDailyBars()` aggregates closed 5-minute bars instead (§2.1). Confirm
   the real parameter (and whether the response's last row is the
   in-progress session) against a live response before switching.

Until all four are confirmed, `HttpMarketDataSource` can be written and
tested against recorded/sample real responses, but should not be trusted to
handle every live edge case silently.
