# Testing

Everything runs offline: no network, no API keys. One command runs it all:

```bash
npm run test:all   # typecheck → unit + coverage → parity → end-to-end
```

| Command | What it runs |
|---|---|
| `npm run typecheck` | `tsc -b` over app, test and config code (strict; no `any`, no `@ts-ignore`) |
| `npm test` | Vitest, both projects (`unit` in jsdom, `node` in Node) |
| `npm run test:cov` | The same, plus coverage with **enforced** per-directory thresholds |
| `npm run test:parity` | The TypeScript indicators vs the original Python screener, on every fixture |
| `npm run test:e2e` | Playwright against the **production build** (`npm run build && npm run preview`) |

## Ground rules

These apply to every test in every layer.

1. **`src/strategy/` is parity-locked.** A test never changes it. If the port has a quirk, the test encodes the quirk.
2. **Every test must be able to fail.** Before you commit a test, break the thing it guards and watch it go red. Restore the file from a copy, never with `git checkout` (that discards uncommitted work too).
3. **No flaky tests.**
   - Time comes from the injectable clock (`MockClock`, the store's `now`), never `Date.now()`.
   - Randomness comes from a seeded RNG.
   - A test that needs a sleep is wrong: use fake timers (`vi.useFakeTimers`) or the clock.
4. **No console noise.** `vitest.setup.ts` fails any unit test that logs `console.error`. The E2E fixture fails on console errors, uncaught exceptions and unhandled rejections. For an error a test deliberately provokes, call `allowConsoleError(/pattern/)` in that test.

## The layers

### 0: Toolchain

- **`vitest.config.ts`**
  - Two projects: `unit` (jsdom; `*.test.ts(x)`) and `node` (`*.node.test.ts`, for timezone and file-system tests).
  - Coverage thresholds per directory. The global threshold applies to every file, so each area has its own glob.
  - A 30s test timeout. Real-pipeline suites are 2–8s of pure CPU, and nothing waits on wall time.
- **`vitest.setup.ts`**
  - jest-dom matchers, `matchMedia` and `ResizeObserver` stubs.
  - The fake-timer shim for Testing Library. RTL only advances its internal `setTimeout(0)` when it detects Jest, so the shim makes it work under Vitest.
  - The console-error guard.
- **`playwright.config.ts`**
  - Runs against the production build, one worker, zero retries.
  - Pins the seed and turns off simulated request failures, via these build-time test hooks:

| Env var | Effect |
|---|---|
| `VITE_SEED` | Pins the mock market's seed (`seedFromEnv`) |
| `VITE_MOCK_FAILURE_RATE` | Share of mock requests that fail, 0..1 (`failureRateFromEnv`). E2E uses `0`, so two scans of the same market agree |

### 1: Parity (`npm run test:parity`)

- `scripts/genFixtures.ts` writes seeded candle fixtures to `src/strategy/__tests__/fixtures/parity/`: 12 market regimes plus edge cases (0–15 candles, a zero-volume bar).
- `scripts/parityDiff.ts` runs the **original** `mastertrust_rsi_ha_screener.py` on each fixture (`scripts/parity_check.py <fixture> --json`) and the TS port on the same data. It diffs RSI and every Heikin-Ashi field at 1e-9, with exact NaN positions.
- Known reference errors (the Python raising where TS returns `[]`) are listed in `KNOWN_REFERENCE_ERRORS`, each with a reason.
- **Adding a fixture:** add a regime to `genFixtures.ts`, run `npm run fixtures:generate`, commit the JSON.

### 2: Unit

Pure functions, next to the code in `__tests__/`:
- indicators, with fast-check property tests (seed 424242, 500 runs, `size: 'max'`)
- formatters, parameterised across timezones in `*.node.test.ts`
- candle parsing, the RNG, the session grid, the filters, the store's expiry handling

**Adding one:** `src/<area>/__tests__/<name>.test.ts`. If it touches timezones or files, use `<name>.node.test.ts`.

### 3: Component

React Testing Library, against a store seeded with fixture rows:
- helpers in `src/test-utils/fixtures.tsx`: `makeRow`, `seededStore`, `renderWithRouter`, `setViewportWidth`
- rows default to NFO, because NSE equity rows are hidden by the screener's output rule
- for anything timed, use `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` together with `userEvent.setup({ advanceTimers })`

### 4: Integration

The **real** `MockMarketDataSource` under the **real** store, scans run in-thread. Helpers are in `src/test-utils/realMock.ts`:
- `makeMock()`: fixed clock at `SESSION_NOW`, Monday 5 Jan 2026 13:00 IST, mid-session.
- `makeScreener()` and `scanOnce()`.
- Move time with `source.setClockMode('fixed', t)`.
- `scanner.golden.test.ts` snapshots the full row set for the default seed.

### 5: Invariants (`src/__tests__/invariants*.test.ts`)

- Whole-pipeline properties, e.g. option legs inherit their underlying's RSI and time, and BUY and breakout rows are independent.
- `DEFAULT_PARAMS` is frozen and matches the table in `STRATEGY-CONTRACT.md`.
- Architecture boundaries, checked by scanning the source. Each allow-list entry states why it's allowed, and a stale entry fails the test.

### 6: Regressions

Each past bug, written down so it can't come back:

| File | Guards |
|---|---|
| `src/__tests__/regressions.test.ts` | Tick subscriptions don't stack; the first scan, a params change and a seek don't announce; futures don't mirror their underlying; breakout rate stays realistic; the tuner lands in range |
| `src/data/mock/__tests__/liveSession.test.ts` | The feed is silent outside market hours, and ticks belong to the bar forming now |
| `src/analytics/__tests__/marketAsOf.test.ts` | While closed, /intraday shows the last session at its 15:30 close |
| `src/features/rsi-ha/__tests__/HistoryDrawer.test.tsx` | The closed History drawer doesn't loop, which used to freeze the page |
| `e2e/regressions.spec.ts` | The virtualizer doesn't overlap rows on a layout flip (needs real layout) |

### 7: End-to-end (`e2e/screener.spec.ts`, `e2e/honesty.spec.ts`)

- Every test uses `test` from `e2e/fixtures.ts`. It pins the page clock to the same Monday 13:00 IST, pre-dismisses the welcome tour, and fails on any console error.
- `screener.spec.ts`: search and the URL, the drawer, Parameters, the replay scrubber, pause, CSV export, the devtools seed.
- `honesty.spec.ts`: the simulated-data pill, no unqualified "live", the "not a backtest" disclaimer, the disabled Place order button.

### 8: Accessibility, responsive, visual

- **`e2e/a11y.spec.ts`:** axe finds zero serious or critical violations on the screener, the drawer, Parameters, the shortcuts overlay and the light theme. It also checks Tab reach with a visible focus ring, `role="grid"` with `aria-rowcount`, one aria-live message per scan, and no state conveyed by colour alone.
- **`e2e/responsive.spec.ts`:** at 360–1920px, no horizontal page scroll and nothing past either viewport edge, with and without each drawer open. The card list is mounted below 900px.
- **`e2e/visual.spec.ts`:** `toHaveScreenshot` baselines with `maxDiffPixelRatio: 0.01`.
  - Live regions are masked: the clock, the LTP and Chg % columns, the countdowns, the replay date and the scrubber.
  - The table, Parameters and the empty state are element-level snapshots, so the 1% is measured against the subject rather than the whole page.

### 9: Performance (`e2e/perf.spec.ts`)

- Budgets:
  - first populated row in under 5s
  - a full scan in under 3s, read from the status bar's `data-last-scan-ms`
  - fewer than 5 long tasks in 30s of ticks
  - p95 frame time under 20ms while scrolling
  - under 20MB of heap growth over 10 scans
  - **startup JS under 700KB raw / 220KB gzipped**: the entry script plus its modulepreloads, read from `dist/index.html`
- The chart and /intraday are lazy chunks, loaded on first use.
- This spec uses the real clock (`test.use({ realClock: true })`), because Playwright's fake clock also drives `requestAnimationFrame`. It forces the session open through the devtools panel so ticks stream at any hour.

## Updating a visual baseline deliberately

Baselines are **per platform**: `e2e/__screenshots__/<platform>/visual.spec.ts/*.png`. Fonts rasterise differently on Windows, macOS and Linux.

1. Make the UI change. Run `npx playwright test e2e/visual.spec.ts` and confirm the diff in `playwright-report/` is exactly the change you intended.
2. Re-baseline: `npx playwright test e2e/visual.spec.ts --update-snapshots`.
3. Look at every changed PNG before committing it. A baseline is a claim about what the UI should look like.
4. **Linux (CI) baselines** are generated on Linux. Run step 2 inside the official image, then commit `e2e/__screenshots__/linux/`:

   ```bash
   docker run --rm -v "$PWD":/work -w /work mcr.microsoft.com/playwright:v1.63.0-jammy npx playwright test e2e/visual.spec.ts --update-snapshots
   ```

A new visual test needs a mask over anything that moves on its own, or it will diff on every run.

## CI

`.github/workflows/ci.yml` runs on every push and PR:

1. typecheck
2. unit + coverage
3. parity (with the Python reference's `requirements.txt` installed)
4. Playwright

It uploads the coverage summary and the Playwright report as artifacts.
