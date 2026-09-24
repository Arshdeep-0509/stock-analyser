import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import type { Page } from '@playwright/test'
import { expect, signalRows, test } from './fixtures'

/**
 * Layer 9: performance, measured in a real browser against the production
 * build (never estimated). Budgets are hard gates: a regression fails CI.
 */

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')

// Real clock: the fake one drives requestAnimationFrame and would falsify frame timings.
test.use({ realClock: true })

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

const statusBar = (page: Page) => page.getByRole('contentinfo').filter({ hasText: 'Universe:' })

/** With the real clock the market may be closed (a silent feed): force the session open, as the devtools panel lets a demo do. */
async function forceSessionOpen(page: Page): Promise<void> {
  await page.keyboard.press('Backquote')
  const toggle = page.getByRole('button', { name: 'Force OPEN' })
  if (await toggle.isVisible()) await toggle.click()
  await page.keyboard.press('Backquote')
}

test('navigation to the first populated row takes under 5s', async ({ page }) => {
  const t0 = Date.now()
  await page.goto('/rsi-ha')
  await expect(signalRows(page).first()).toBeVisible({ timeout: 5_000 })
  expect(Date.now() - t0).toBeLessThan(5_000)
})

test("a full-universe scan completes in under 3s (the store's own lastScanDurationMs)", async ({ page }) => {
  await page.goto('/rsi-ha')
  await expect(signalRows(page).first()).toBeVisible({ timeout: 15_000 })
  await expect(statusBar(page)).toHaveAttribute('data-last-scan-ms', /\d+/)
  // The spec's "182 instruments" is this seed's universe size (≈198); the status bar shows every one scanned.
  const text = (await statusBar(page).textContent()) ?? ''
  const [, scanned, universe] = /Scanned:\s*(\d+)\/(\d+)/.exec(text) ?? []
  expect(Number(universe)).toBeGreaterThan(150)
  expect(scanned).toBe(universe)
  expect(Number(await statusBar(page).getAttribute('data-last-scan-ms'))).toBeLessThan(3_000)
})

test('30s of streaming ticks: fewer than 5 long tasks over 50ms', async ({ page }) => {
  await page.goto('/rsi-ha')
  await expect(signalRows(page).first()).toBeVisible({ timeout: 15_000 })
  await forceSessionOpen(page)
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[] }
    w.__longTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.duration > 50) w.__longTasks.push(e.duration)
    }).observe({ type: 'longtask', buffered: false })
  })
  // Real time: the mock socket ticks ~10 batches a second throughout.
  await page.waitForTimeout(30_000)
  const long = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks)
  expect(long.length, `long tasks: ${long.map((d) => Math.round(d)).join(', ')}`).toBeLessThan(5)
})

test('scrolling the signals list keeps the frame budget (p95 rAF delta under 20ms)', async ({ page }) => {
  // The spec asks for 500 rows; this universe never produces that many (≈11 at defaults), so the list is
  // made as long as the app can make it (underlying equity rows shown, the table in a short viewport so it
  // actually scrolls). Reported as a deviation.
  await page.setViewportSize({ width: 1440, height: 520 })
  await page.goto('/rsi-ha')
  await expect(signalRows(page).first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('switch', { name: /Show underlying equity signals/ }).click()
  const scroller = page.locator('[role="grid"] [role="rowgroup"]').first()
  const deltas = await scroller.evaluate(async (el) => {
    const samples: number[] = []
    let last = performance.now()
    const end = last + 3000
    let dir = 1
    await new Promise<void>((resolve) => {
      const frame = (t: number) => {
        samples.push(t - last)
        last = t
        el.scrollTop += dir * 40
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) dir = -1
        if (el.scrollTop <= 0) dir = 1
        if (t < end) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
    return samples.slice(2)
  })
  const sorted = [...deltas].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)]
  expect(deltas.length).toBeGreaterThan(60)
  expect(p95).toBeLessThan(20)
})

test('the startup bundle is under 700KB raw / 220KB gzipped', () => {
  // Everything index.html loads before first paint: the entry script plus its modulepreloads.
  // Lazy chunks (the chart, /intraday) load on first use and are budgeted by not being here.
  const html = readFileSync(path.join(DIST, 'index.html'), 'utf8')
  const files = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => path.join(DIST, m[1]))
  expect(files.length).toBeGreaterThan(0)
  const raw = files.reduce((n, f) => n + statSync(f).size, 0)
  const gz = files.reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0)
  expect(raw, `startup JS raw bytes (${files.map((f) => path.basename(f)).join(', ')})`).toBeLessThan(700 * 1024)
  expect(gz, 'startup JS gzipped bytes').toBeLessThan(220 * 1024)
})

test('no memory growth: 10 scans grow the heap by under 20MB', async ({ page }) => {
  await page.goto('/rsi-ha')
  await expect(signalRows(page).first()).toBeVisible({ timeout: 15_000 })
  const cdp = await page.context().newCDPSession(page)
  const heap = async (): Promise<number> => {
    await cdp.send('HeapProfiler.collectGarbage')
    return (await cdp.send('Runtime.getHeapUsage')).usedSize
  }
  const before = await heap()
  // A params edit triggers a debounced rescan (the same runScanNow() path a scheduled scan
  // takes) — repeated edits are a convenient, UI-driven way to force 10 scans on demand.
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Parameters' }).click()
  const lookback = page.getByRole('spinbutton', { name: 'Breakout lookback (bars)' })
  for (let i = 1; i <= 10; i++) {
    const prev = await statusBar(page).getAttribute('data-last-scan-at')
    await lookback.fill(String(20 + (i % 2)))
    await expect.poll(() => statusBar(page).getAttribute('data-last-scan-at'), { timeout: 15_000 }).not.toBe(prev)
  }
  const after = await heap()
  expect(after - before, `heap ${Math.round(before / 1e6)}MB -> ${Math.round(after / 1e6)}MB`).toBeLessThan(20 * 1024 * 1024)
})
