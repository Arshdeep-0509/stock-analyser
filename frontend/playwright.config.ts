import { defineConfig, devices } from '@playwright/test'

/** The seed every E2E run builds with — see seedFromEnv() in src/app/dataSource.ts. */
export const E2E_SEED = '424242'
const PORT = 4173
const BASE_URL = `http://127.0.0.1:${PORT}`

/**
 * End-to-end tests against the PRODUCTION build (not the dev server — the
 * perf and bundle budgets only mean anything against real output).
 *
 * retries: 0 on purpose. A flaky test is a bug to fix, not something to
 * retry until green.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  // Per platform: fonts rasterise differently on Windows, macOS and Linux (CI), so each OS keeps its own baselines.
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Seed pinned, and no simulated request failures: two scans of the same market must agree.
    env: { VITE_SEED: E2E_SEED, VITE_MOCK_FAILURE_RATE: '0' },
  },
})
