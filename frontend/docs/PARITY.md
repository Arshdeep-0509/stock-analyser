# Parity

This maps every strategy-relevant function and behaviour in
[`mastertrust_rsi_ha_screener.py`](../../mastertrust_rsi_ha_screener.py) (repo root)
to its TypeScript port and the tests that hold it in place. Nothing here is
an interpretation — see [`STRATEGY-CONTRACT.md`](./STRATEGY-CONTRACT.md) for
the underlying contract (config constants, API shapes, the known
docstring-vs-code discrepancy) this table assumes.

Automated cross-check: [`scripts/parity_check.py`](../../scripts/parity_check.py)
imports `compute_rsi()` and `compute_heikin_ashi()` **directly from the
original Python file** (not a copy) and runs them against the same committed
fixture the TypeScript snapshot test uses
(`src/strategy/__tests__/fixtures/candles-60.json`). Both sides currently
agree to 8 decimal places across all 60 candles, 0 mismatches, for RSI,
`ha_open`, `ha_close`, and `ha_color` — see the verification report for the
side-by-side run.

## Function map

| Python function (source) | TypeScript port | Tests |
| --- | --- | --- |
| `compute_rsi()` (lines 232–242) — Wilder's smoothing, `ewm(alpha=1/period, min_periods=period, adjust=False)` | `computeRsi()` in [`src/strategy/indicators.ts`](../src/strategy/indicators.ts) | [`indicators.test.ts`](../src/strategy/__tests__/indicators.test.ts) (`describe('computeRsi')`, includes the committed 8dp snapshot cross-checked by `parity_check.py`) |
| `compute_heikin_ashi()` (lines 245–262) | `computeHeikinAshi()` in [`indicators.ts`](../src/strategy/indicators.ts) | [`indicators.test.ts`](../src/strategy/__tests__/indicators.test.ts) (`describe('computeHeikinAshi')`, same snapshot cross-check for `ha_open`/`ha_close`/`ha_color`) |
| `ha_streak_length()` (lines 265–273) | `haStreakLength()` in [`indicators.ts`](../src/strategy/indicators.ts) | [`indicators.test.ts`](../src/strategy/__tests__/indicators.test.ts) (`describe('haStreakLength')`) |
| `check_signal()` (lines 279–303) — band-inclusive RSI check (the code, not the docstring — see contract §2), exact-2nd-candle gate | `checkSignal()` in [`src/strategy/signals.ts`](../src/strategy/signals.ts), sharing its comparisons with `explainSignal()` via `evaluateSignalPredicates()` so the table, the chart, and the "why it fired" panel can never compute a different answer than the scanner | [`signals.test.ts`](../src/strategy/__tests__/signals.test.ts) (`describe('checkSignal')`, `describe('checkSignal + checkBreakout composition')`), [`explainSignal.test.ts`](../src/strategy/__tests__/explainSignal.test.ts) |
| `check_breakout()` (lines 306–329) — lookback window excludes the last candle itself | `checkBreakout()` in [`signals.ts`](../src/strategy/signals.ts), sharing predicates with `explainBreakout()` via `evaluateBreakoutPredicates()` | [`signals.test.ts`](../src/strategy/__tests__/signals.test.ts) (`describe('checkBreakout')`), [`explainSignal.test.ts`](../src/strategy/__tests__/explainSignal.test.ts) |
| `load_nse_equity_universe()` (lines 344–357) | `loadNseEquityUniverse()` in [`src/strategy/universe.ts`](../src/strategy/universe.ts) | [`universe.test.ts`](../src/strategy/__tests__/universe.test.ts) (`describe('loadNseEquityUniverse')`), plus indirectly via [`scanner.test.ts`](../src/features/rsi-ha/__tests__/scanner.test.ts), [`screenerStore.test.ts`](../src/store/__tests__/screenerStore.test.ts), [`paramsReset.test.ts`](../src/store/__tests__/paramsReset.test.ts), [`generateUniverse.test.ts`](../src/data/mock/__tests__/generateUniverse.test.ts) |
| `load_fno_futures_universe()` (lines 360–375) — dedupes to nearest-expiry contract per `company_name`, price filter applied *after* dedupe | `loadFnoFuturesUniverse()` in [`universe.ts`](../src/strategy/universe.ts) | [`universe.test.ts`](../src/strategy/__tests__/universe.test.ts) (`describe('loadFnoFuturesUniverse')` — dedupe-keeps-nearest-expiry, price-filter-after-dedupe, expired-contract exclusion, unparseable-row exclusion), plus the same indirect coverage as above |
| `load_fno_atm_options()` (lines 378–414) — spot = cached scrip-master `close_price`, not a live quote | `loadFnoAtmOptions()` in [`universe.ts`](../src/strategy/universe.ts) | [`universe.test.ts`](../src/strategy/__tests__/universe.test.ts) (`describe('loadFnoAtmOptions')` — nearest-strike selection, minPrice gating, missing-spot/missing-leg skips, nearest-expiry-chain-only, expired-chain exclusion), plus the same indirect coverage as above |
| `add_option_recommendations()` (lines 417–446) — only fires for `exchange == "NSE"` and `signal in (BUY, SELL)`; copies the underlying's `rsi`/`time` verbatim | `addOptionRecommendations()` in [`src/strategy/optionLegs.ts`](../src/strategy/optionLegs.ts) | [`optionLegs.test.ts`](../src/strategy/__tests__/optionLegs.test.ts) (BUY→CE/SELL→PE, breakout/non-NSE/no-ATM-entry skips, price-from-option-candles, rsi/time-copied-from-underlying, input-order preserved), plus [`scanner.test.ts`](../src/features/rsi-ha/__tests__/scanner.test.ts) |
| The forming-candle drop in `fetch_historical_candles()` (lines 222–226) — `candle_end <= now` | `dropFormingCandle()` in [`src/strategy/dropFormingCandle.ts`](../src/strategy/dropFormingCandle.ts), called from `parseHistoricalCandlesResponse()` in [`src/data/parseCandles.ts`](../src/data/parseCandles.ts) | [`indicators.test.ts`](../src/strategy/__tests__/indicators.test.ts) (`describe('dropFormingCandle')`), [`parseCandles.test.ts`](../src/data/__tests__/parseCandles.test.ts) |
| The NSE-hidden output rule in `__main__` (lines 514–518) — equity signals are always computed (needed for option-leg derivation) but only non-NSE rows plus derived CE/PE Buy rows are shown | `selectVisibleRows()` in [`signals.ts`](../src/strategy/signals.ts), applied in `runFullScan()` in [`src/features/rsi-ha/scanner.ts`](../src/features/rsi-ha/scanner.ts) | [`signals.test.ts`](../src/strategy/__tests__/signals.test.ts) (`describe('selectVisibleRows')`), [`scanner.test.ts`](../src/features/rsi-ha/__tests__/scanner.test.ts) |

**Coverage note:** `src/strategy/` is at 96.6% statements / 99.2% lines /
100% functions / 90.8% branches (see the verification report) — all four
above the 90% bar. `universe.ts` and `optionLegs.ts` were the weak spots
(57–60% statements) until this step added [`universe.test.ts`](../src/strategy/__tests__/universe.test.ts)
and [`optionLegs.test.ts`](../src/strategy/__tests__/optionLegs.test.ts) as
dedicated unit tests for `loadFnoFuturesUniverse()`, `loadFnoAtmOptions()`,
and `addOptionRecommendations()`, which previously had only indirect,
integration-level coverage. The handful of still-uncovered lines (see the
verification report's per-file table) are single defensive branches, not
untested logic paths of any size.

## `/intraday` reuse of the parity-locked engine

`/intraday` adds **no** strategy logic. Wherever it shows something the
Python defines (a breakout, a Heikin-Ashi direction, the F&O universe), it
calls the same `src/strategy/` function `/rsi-ha` calls, with
`DEFAULT_PARAMS` (byte-identical to the Python constants). Everything it
*invents* (Strength, the meters, Smart Money, the cap-weight approximation)
lives in `src/analytics/` and is documented separately in
[`ANALYTICS.md`](./ANALYTICS.md) — none of it feeds back into the engine.

| Strategy function (Python source) | Called from | What /intraday uses it for |
| --- | --- | --- |
| `loadFnoFuturesUniverse()` — `load_fno_futures_universe()` | `buildFnoUniverse()` in [`src/store/intradayStore.ts`](../src/store/intradayStore.ts) | The F&O underlying set (nearest-expiry FUTSTK per company). Sector/index membership is attached *afterwards* by `enrichInstrument()` ([`src/analytics/enrich.ts`](../src/analytics/enrich.ts)); the loader is untouched |
| `checkBreakout()` — `check_breakout()` | `computeIntradayRow()` in [`src/analytics/intraday.ts`](../src/analytics/intraday.ts) | `row.breakout` / `row.breakoutLevel`: the Breakout / BreakDown panels, the quote-strip counts, the per-sector breakout bars, the `breakoutOnly` filter |
| `computeHeikinAshi()` — `compute_heikin_ashi()` | `computeIntradayRow()` in [`src/analytics/intraday.ts`](../src/analytics/intraday.ts) | `row.intradayDir` = colour of the last closed HA candle (the Intraday ▲/▼ arrow and the direction filter) |
| `analyzeCandles()` (→ `computeRsi()` + `computeHeikinAshi()`) | `InstrumentDrawer` in [`src/features/intraday/InstrumentDrawer.tsx`](../src/features/intraday/InstrumentDrawer.tsx) | The drill-down chart, drawn by /rsi-ha's own `SignalChart` (breakout level line included), plus a join to the screener store for the name's current BUY/SELL status |
| The forming-candle drop — `dropFormingCandle()` | Inside every `fetchHistoricalCandles()` / `fetchDailyBars()` via `parseHistoricalCandlesResponse()` ([`src/data/parseCandles.ts`](../src/data/parseCandles.ts)) | Every candle /intraday computes from is closed, exactly as the screener's |
| `parseIntervalMinutes()` / `DEFAULT_PARAMS.candleInterval` | `subscribeToUniverseTicks()` in [`intradayStore.ts`](../src/store/intradayStore.ts) | Bar-close detection: strength / breakout / intradayDir are recomputed **only** when a tick lands in a new 5-minute bucket, never mid-bar (the same "closed candles only" rule `check_breakout()` itself relies on). A dev-only assertion (`assertBarBoundaryInvariant()`) throws if any of the three changes between bar boundaries |

**Cross-check.** [`scripts/breakoutCrossCheck.ts`](../scripts/breakoutCrossCheck.ts)
(`npm run check:breakouts`) runs `/intraday`'s real load pipeline and
`/rsi-ha`'s real `scanWatchlist()` against identical mock instances at five
frozen instants across one session, and asserts that every `/intraday`
breakout row has a matching scanner breakout on the same token, direction,
level **and closed-bar timestamp** — and the converse. Current result: 34
breakout rows and 416 non-breakout rows compared across the five instants,
0 mismatches.

## Deliberate deviations — UI-layer only

Everything below changes what the user can **choose to feed into** the
engine or **choose to look at** in its output. None of it changes what
`checkSignal()`, `checkBreakout()`, `computeRsi()`, `computeHeikinAshi()`,
the universe loaders, or `addOptionRecommendations()` themselves compute for
a given input — that logic is untouched from the table above, in every case.

- **The equity-view toggle** ("Show underlying equity signals", off by
  default) in the signals table. Python's `__main__` unconditionally hides
  NSE equity rows from its printed output (see the NSE-hidden row above);
  the frontend keeps that as the *default* but adds a toggle to reveal the
  already-computed equity rows for inspection. The default matches Python
  exactly; the toggle is a debugging/demo convenience layered on top.
- **The Parameters panel** — lets the user override `rsiPeriod`,
  `rsiBuyLow/High`, `rsiSellLow/High`, `minPrice`, `breakoutLookback`,
  `candleInterval`, and `scanEverySeconds` away from the frozen Python
  defaults (§1 of the contract). `DEFAULT_PARAMS` is byte-identical to the
  Python config constants; any override is flagged with a persistent
  "Running with N modified parameters — not the reference strategy" banner,
  and "Reset to defaults" restores byte-identical results (see the paused
  session's acceptance test, `paramsReset.test.ts`). One control inside this
  panel has no Python analogue at all: **candle interval**. Python always
  fetches at a single fixed `CANDLE_INTERVAL`; the mock only ever generates
  5-minute base candles, and coarser intervals (15/30/60min) are produced by
  `resampleCandles()` (day-aligned OHLC aggregation — first open, max high,
  min low, last close, summed volume), which is standard OHLC bucketing but
  is *new code with no Python counterpart to port from*, since the reference
  script never resamples. 1- and 3-minute options are disabled in the UI
  (the mock's base data is 5-minute) rather than silently producing wrong
  output.
- **The universe/watchlist selector** (All NSE equity / All stock futures /
  Both / a named watchlist) at the top of the screener. Python's `__main__`
  always scans `equity_universe + futures_universe` unconditionally — that's
  exactly what "Both" reproduces. The other three modes narrow *which
  instruments get fed into* `scanWatchlist()`; they don't change how any one
  instrument is scored once it's in the set being scanned.
- **Session replay, watchlists (as data), alerts, and history** are pure UI
  additions with no engine logic of their own: replay drives the *same*
  `runScanNow()` path against a rewound simulated clock (see
  `BACKEND-HANDOFF.md`'s note on `MockClock`); alerts and history only ever
  read already-computed `SignalRow`s after the fact. None of them touch
  `checkSignal`/`checkBreakout`/the indicators.

No logic deviations were found while building this table. If a future
change to `src/strategy/` ever needs one, it must be added here explicitly,
not folded into this list silently.
