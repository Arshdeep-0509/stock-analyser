# Strategy Contract

Source of truth: [`../../mastertrust_rsi_ha_screener.py`](../../mastertrust_rsi_ha_screener.py)
(repo root). This document freezes what the frontend is allowed to assume
about that script's behaviour and about the upstream API shapes it consumes.
Nothing in this document is an interpretation — every line is traceable back
to a specific line of the Python file. Per [`CLAUDE.md`](../CLAUDE.md) hard
rule 1, none of this is to be "fixed" during porting, however odd it looks.

## 1. Config constants (exact values)

| Constant | Value | Source |
| --- | --- | --- |
| `CANDLE_INTERVAL` | `"5minute"` | line 72 |
| `MIN_PRICE` | `2000.0` | line 73 |
| `RSI_PERIOD` | `14` | line 74 |
| `RSI_BUY_LOW` | `60` | line 75 |
| `RSI_BUY_HIGH` | `65` | line 76 |
| `RSI_SELL_LOW` | `35` | line 77 |
| `RSI_SELL_HIGH` | `40` | line 78 |
| `BREAKOUT_LOOKBACK` | `20` | line 79 |
| `SCAN_EVERY_SECONDS` | `300` | line 80 |

## 2. KNOWN DISCREPANCIES — DO NOT RESOLVE

**The module docstring and the actual signal code disagree, and the code
wins.**

The docstring (lines 5–11) says:

> - BUY signal : RSI(14) >= 60 AND the LAST candle is the 2nd consecutive
>   GREEN Heikin-Ashi candle
> - SELL signal : RSI(14) <= 40 AND the LAST candle is the 2nd consecutive
>   RED Heikin-Ashi candle

But `check_signal()` (lines 279–303) actually requires the RSI to sit
**inside a band**, not just cross a threshold:

```python
if RSI_BUY_LOW <= last["rsi"] <= RSI_BUY_HIGH and is_2nd_candle and color == "green":
    return "BUY"
if RSI_SELL_LOW <= last["rsi"] <= RSI_SELL_HIGH and is_2nd_candle and color == "red":
    return "SELL"
```

i.e. BUY requires `60 <= rsi <= 65`, not `rsi >= 60`. SELL requires
`35 <= rsi <= 40`, not `rsi <= 40`. An RSI of 70 with a fresh green streak
does **not** produce a BUY signal in the real code, even though the
docstring implies it should.

**The frontend strategy port must implement the band (the code), not the
docstring.** Do not "fix" this to match the docstring — it is not a bug to
fix, it is the frozen contract.

## 3. Upstream API response shapes

These are documented as TypeScript types in
[`../src/types/api.ts`](../src/types/api.ts). Summary:

### 3.1 `GET /api/v1/search?key=<keyword>`

Confirmed from docs (line 179 docstring). Response:

```ts
{ error: unknown; result: Array<{ exchange: string; trading_symbol: string; token: string | number; [k: string]: unknown }> }
```

### 3.2 `GET /api/v1/charts/tdv` (historical candles)

Params sent by `fetch_historical_candles()` (lines 190–226):
`token`, `exchange`, `starttime` (unix seconds), `endtime` (unix seconds),
`candletype=1`, `data_duration` (interval minutes, extracted by taking the
digits out of `CANDLE_INTERVAL`, e.g. `"5minute"` → `5`).

Response:

```ts
{ data: { candles: RawCandleRow[] } }
```

`RawCandleRow` is a **positional tuple**, not an object:
`[datetime, open, high, low, close, volume]`. The Python builds a DataFrame
directly from these positional rows (line 215) then runs `pd.to_numeric` on
all five numeric columns (line 218–219) — values may arrive as strings, so
our parser must coerce too, not assume they're already numbers.

**PARITY NOTE:** the Python does `pd.to_datetime(df["datetime"])` with no
explicit format (line 217). The real wire format (ISO-8601 string vs epoch
seconds) is **UNCONFIRMED**. The coercion lives in exactly one function,
`parseCandleTimestamp()` in `src/types/api.ts`, which handles both an
ISO-8601 string and an epoch-seconds/epoch-milliseconds number or numeric
string, and logs which format it detected to the dev console
(`import.meta.env.DEV`) instead of guessing silently. When the real format
is confirmed against a live response, delete the dead branch — do not do it
speculatively now.

**Behavioural note (not a type, but part of the contract):**
`fetch_historical_candles()` drops the still-forming current candle before
returning (lines 222–226) — it only returns candles whose
`datetime + duration_minutes <= now`. A `MarketDataSource.fetchHistoricalCandles`
implementation must reproduce this: RSI/HA/signals are only ever computed on
a closed candle, never a forming one.

### 3.3 `GET /api/v1/contract/Compact?info=download`

Returns a zip containing `CompactScrip.csv` (lines 335–341). The Python
reads it with `pd.read_csv` and only ever touches these columns, across
`load_nse_equity_universe`, `load_fno_futures_universe`, and
`load_fno_atm_options`:

`exchange`, `instrument_name`, `trading_symbol`, `exchange_token`,
`close_price`, `expiry` (format `"%d-%b-%Y"`, e.g. `"25-Jan-2026"`),
`company_name`, `strike`, `option_type`.

Modelled as `ScripRow` in `src/types/api.ts`.

### 3.4 Primus WebSocket tick (`primusapi.tradelab.in`) — UNCONFIRMED

Not present anywhere in `mastertrust_rsi_ha_screener.py` — the Python only
ever polls REST on a `SCAN_EVERY_SECONDS` timer, it has no live tick feed.
This section exists to freeze the contract for a **future** live-tick
integration the frontend will eventually need. The exact payload is
unconfirmed; `PrimusTick` in `src/types/api.ts` defines only the fields the
UI needs (`token`, `exchange`, `ltp`, `ltt` epoch seconds, `volume`,
optional `o`/`h`/`l`/`c`) and is marked `// TODO(contract)`. Nothing outside
the data layer may consume `PrimusTick` directly — everything downstream
consumes the normalised `MarketTick` (`src/types/domain.ts`) instead, so
swapping the real payload shape later touches one adapter, not the whole
app.

## 4. Additional behavioural quirks to preserve

Not asked for by name, but directly relevant to hard rule 1 — these are the
things most likely to look like bugs to a future porting step and get
"fixed" by accident. Don't.

- **`check_signal()` requires an exact streak of 2**, not "2 or more"
  (`ha_streak_length` → `is_2nd_candle = streak == 2`, line 297). A candle
  that is the 5th in a green streak with RSI in-band does **not** signal.
- **`check_breakout()` is entirely independent of `check_signal()`.** Both
  are called for every symbol on every scan (lines 460–461); a single candle
  can produce a BUY *and* a BREAKOUT-UP row at the same time.
- **`check_breakout()`'s lookback window excludes the last candle itself** —
  `prior = df.iloc[-(lookback + 1):-1]` (line 322) is the 20 candles
  *before* the last one, not including it.
- **NSE equity signals are computed every scan but hidden from the printed
  output**, except indirectly via CE/PE Buy recommendations. Only NFO rows
  (futures/options) plus derived option recs are shown (lines 514–518).
- **`add_option_recommendations()` only fires for `exchange == "NSE"` and
  `signal in ("BUY", "SELL")`** (lines 424–426) — breakout signals never
  generate an option recommendation.
- **Option recommendation rows copy the underlying equity's `rsi` and
  `time` verbatim** (lines 443–444) rather than computing their own from the
  option's own candles.
- **ATM strike selection uses the scrip master's cached `close_price` as
  "spot"**, not a live quote (line 394, 405).
- **`load_fno_futures_universe()` dedupes to exactly one contract per
  `company_name`**: the nearest not-yet-expired expiry, via
  `sort_values("expiry_date").drop_duplicates("company_name", keep="first")`
  (line 372).
- **RSI uses Wilder's smoothing**
  (`ewm(alpha=1/period, min_periods=period, adjust=False)`, lines 238–239),
  not a plain rolling-window average.
- **`MIN_PRICE` is filtered independently in three separate places**
  (universe loading, `check_signal`, `check_breakout`) against
  potentially different price snapshots (cached scrip-master close vs. the
  live last candle close). A symbol can pass one filter and fail another —
  this is a known raciness in the source, not something to reconcile.

## 5. Where the TypeScript lives

- `src/types/api.ts` — raw upstream shapes exactly as they arrive over the
  wire (`SearchResponse`, `RawCandleRow`, `HistoricalCandlesResponse`,
  `ScripRow`, `PrimusTick`), plus `parseCandleTimestamp()`.
- `src/types/domain.ts` — the app's own normalised shapes (`Candle`,
  `HaCandle`, `Instrument`, `SignalKind`, `SignalRow`, `MarketTick`).
- `src/data/MarketDataSource.ts` — the async interface a mock or real
  implementation must satisfy, plus the `useMarketData()` context hook that
  will provide whichever implementation is active. No implementation exists
  yet.
