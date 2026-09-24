# Analytics — the metrics /intraday invents

Everything on `/intraday` falls into one of two groups:

1. **Ported from `mastertrust_rsi_ha_screener.py`** — breakouts
   (`checkBreakout()`), the Heikin-Ashi direction (`computeHeikinAshi()`),
   the F&O universe (`loadFnoFuturesUniverse()`). Those are parity-locked and
   documented in [`PARITY.md`](./PARITY.md#intraday-reuse-of-the-parity-locked-engine).
2. **Invented for this prototype** — everything below. None of it exists in
   the Python, none of it feeds back into the strategy engine, and **none of
   it is claimed to match any other product's metric of a similar name**.
   Every one of them lives in `src/analytics/`, is a pure function of
   generated candles/ticks, and carries an (i) popover on the page whose
   text comes from [`src/analytics/metricDocs.ts`](../src/analytics/metricDocs.ts)
   — the same constants this document quotes, so the two cannot drift.

The whole dataset behind these numbers is generated locally
(`MockMarketDataSource`), and sector/index membership is a hand-authored
mapping ([`SECTOR-DATA.md`](./SECTOR-DATA.md)). The page footer says both,
and "Not investment advice".

---

## Update cadence

| What | Recomputed when | Where |
| --- | --- | --- |
| `cmp`, `%Ch`, `3 Day Ch%` | Every animation frame that received ticks — all ticks in a frame are applied in **one** store write | `flushPendingTicks()`, `src/store/intradayStore.ts` |
| Strength (and rvol / zMove / persistence), breakout, intraday direction, VWAP, day OHLC | **Only on bar close** — the tick that lands in a new 5-minute bucket triggers a refetch + full recompute of that one instrument. A dev-only assertion (`assertBarBoundaryInvariant()`) throws if strength / breakout / breakoutLevel / intradayDir ever change between bar boundaries | `recomputeOneInstrument()`, same file |
| Market Meter, Index Meter, Sector Strength, Smart Money, Intraday Index, quote-strip counts, sector-card ordering | At most **once per second**, from a snapshot of the rows (`meterRows`) — so they can trail the tables by up to a second | `meterThrottle`, same file |
| Everything | A full reload every `DEFAULT_PARAMS.scanEverySeconds` (300s) and on "Refresh now" / a replay scrub | `loadAndCompute()` (single-flight) |

---

## Strength

**Source:** [`src/analytics/strength.ts`](../src/analytics/strength.ts) —
`computeStrengthBreakdown()`, `strengthTone()`. Longer design notes:
[`STRENGTH.md`](./STRENGTH.md).

**Formula**

```
sigmaDaily  = population stdev of up to the last SIGMA_LOOKBACK_SESSIONS (20) daily log returns
zMove       = |cmp / prevClose − 1| / sigmaDaily
rvol        = volume so far today / median volume to the same bar-of-day over up to the last 10 sessions
persistence = |Σ r| / Σ|r|  over today's closed 5-min bar returns r = close/open − 1   (0 = choppy, 1 = one-way)
Strength    = zMove × √max(rvol, MIN_RVOL = 0.01) × (0.5 + 0.5 × persistence)
```

**Thresholds (colour dot, `STRENGTH_TONE_THRESHOLDS`)**

| Band | Range |
| --- | --- |
| pale (none) | `< 0.05`, or not computable |
| yellow (low) | `0.05 – < 0.5` |
| orange (medium) | `0.5 – < 1.0` |
| green (high) | `≥ 1.0` |

**Limitations**

- Unsigned: it measures how *unusual* a move is, not its direction (the
  Intraday arrow carries direction).
- `NaN` (shown blank, never 0) with fewer than
  `MIN_COMPLETED_DAILY_CLOSES + 1` = 5 sessions of history. A flat price
  history (`sigmaDaily = 0`) gives 0, not ∞.
- Only moves on bar close — never mid-bar.
- `sigmaDaily` from ≤ 20 sessions is a noisy volatility estimate; a
  one-off gap day inflates it for a month.
- `rvol`'s baseline is a median of ≤ 10 sessions at the same bar-of-day; it
  knows nothing about expiry days, results days or holidays.
- The colour-band cut-offs are display choices, not statistically
  calibrated levels.

---

## Market Meter

**Source:** `marketMeter()` in [`src/analytics/aggregate.ts`](../src/analytics/aggregate.ts).

**Formula** — over the whole F&O universe loaded on the page:

```
Up%   = #(%Ch ≥ +t) / N × 100
Down% = #(%Ch ≤ −t) / N × 100
flat  = N − up − down   (includes names with no previous close yet)
```

**Thresholds:** `t = MARKET_METER_DEFAULT_THRESHOLD = 0.5%`, user-selectable
0.25 / 0.5 / 1 / 2%. The bar axis is scaled to the larger of the two values
(rounded up), never a fixed 0–100.

**Limitations**

- Up% + Down% is usually well below 100%: the flat band is deliberately
  excluded from both.
- Equal-weighted — every name counts once regardless of size.
- The 0.5% default is our choice; the picture changes substantially at the
  other thresholds.
- When a filter is active, the meter still shows the whole market and only
  *marks* where the filtered slice sits — it never re-scales to the slice.

---

## Index Meter

**Source:** `indexMeter()` in `aggregate.ts`.

**Formula:** the Market Meter's Up% / Down% rule (same default ±0.5%),
applied separately to each index panel's constituents.

**Limitations**

- Index membership is hand-authored (`src/data/reference/indices.ts`), not
  an official constituent list, and only F&O names are counted — each
  "index" is a subset of the real one.
- Equal-weighted; real index weights are not used.

---

## Sector Strength

**Source:** `sectorStrength()` in `aggregate.ts`.

**Formula:** per sector, the mean Strength of its names, excluding names
whose Strength is `NaN` (not counted as 0). Descending; top 10 shown, the
rest folded into a final "Others" bar computed from the underlying rows
(never a mean of means).

**Thresholds:** sectors with fewer than `MIN_SECTOR_CONSTITUENTS = 3` names
are pooled into "Others", so a single stock can't top the chart alone.

**Limitations**

- Inherits every limitation of Strength.
- Sector assignment is hand-authored.
- A mean — one extreme name still lifts a small sector noticeably.

---

## Smart Money

**Source:** `smartMoney()` in `aggregate.ts`; the "Smart money only" filter
uses the same default thresholds via `matchesFilters()`.

**Formula:** per sector, the **count** of names with
`rvol ≥ minRvol` **and** `|zMove| ≥ minZMove`. Top 5 sectors, descending.

**Thresholds:** `SMART_MONEY_DEFAULT_MIN_RVOL = 2`,
`SMART_MONEY_DEFAULT_MIN_ZMOVE = 1`; both adjustable on the panel.

**Limitations**

- Despite the name, it **cannot see who is trading**: it is computed from
  price and volume only — no order-flow, institutional, delivery or
  open-interest data exists anywhere in this prototype. It is a crowding
  measure: unusual volume together with an unusual move.
- The default thresholds are our own, not an industry convention.
- A count, not a weight: a sector with more F&O names can score higher by
  being bigger.
- Can legitimately be empty (no name clears both thresholds) — the panel
  says so rather than lowering the bar silently.

---

## Intraday Index (per-sector mean change) and the cap-weight approximation

**Source:** `intradayIndex()` in `aggregate.ts`.

**Formula**

```
change_i = %Ch vs previous close        (price basis "vs previous close", default)
         = (cmp / dayOpen − 1) × 100    (price basis "vs day open")

equal-weight: mean_s = Σ change_i / n                         over the sector's names with a finite change
cap-weight:   mean_s = Σ change_i × w_i / Σ w_i,  w_i = cachedClose_i (0 if missing)
```

Bars diverge from zero (green up, red down) on a symmetric axis in 0.5%
steps. Unlike Sector Strength, small sectors are **not** folded into
"Others" — a small sector's average move is still its own average move.

**Limitations of "Cap-weight (approx.)"**

- The weight is the close price stored in the instrument master
  (`close_price` in `CompactScrip.csv`) when it was last loaded — **price is
  not market capitalisation**; share counts are ignored entirely. It is only
  a rough proxy for "bigger names count more".
- The cached price is a snapshot and does not move with live ticks.
- Names without a cached close get zero weight.

---

## Breakout strength (quote strip)

**Source:** `headerCounts()` in `aggregate.ts`.

**Formula:** mean Strength of the names currently flagged `BREAKOUT-UP` or
`BREAKOUT-DOWN`. The two counts beside it are plain counts of those flags.

**Limitations:** the breakout flag is the ported `checkBreakout()` rule
(20-bar lookback); only the averaging is ours, so it inherits every
limitation of Strength. Blank when nothing is in a breakout.

---

## Other derived values (standard definitions, listed for completeness)

| Value | Definition | Source |
| --- | --- | --- |
| `%Ch` | `(cmp / prevClose − 1) × 100`, `prevClose` = last completed session close | `computeIntradayRow()`, `src/analytics/intraday.ts` |
| `3 Day Ch%` | `(cmp / close three completed sessions back − 1) × 100` — sessions, not calendar days | same |
| VWAP | `Σ typical × volume / Σ volume` over today's closed 5-min bars, typical = (H + L + C) / 3 | same |
| Day open / high / low | From today's closed 5-min bars only | same |
| Sector card mean strength and advance/decline | Mean Strength (NaN excluded) and the Market Meter rule, per index panel | `sectorCardSummaries()`, `aggregate.ts` |
| NIFTY 50 / BANK NIFTY / India VIX (mock only) | A cached-close-weighted composite of the mock's own constituent candles; VIX a mean-reverting series anti-correlated with that composite. A real backend returns the real quotes instead (see `BACKEND-HANDOFF.md` §2.1) | `src/analytics/indexComposite.ts` |

---

## Tests

`src/analytics/` is at **96.4% statements, 90.2% branches, 94% functions,
96.6% lines** (`npx vitest run --coverage src/analytics`). The copy guard in
`src/analytics/__tests__/metricDocs.test.ts` fails if any metric's popover
text claims or implies a match with another product, or quotes a threshold
that differs from the constant the computing code uses.
