/**
 * Captures the /intraday review screenshots at 1920px and 390px:
 *   <w>-1-dashboard.png        the whole dashboard, top to footer
 *   <w>-2-sector-filtered.png  after clicking the strongest Sector Strength bar
 *   <w>-3-drawer.png           the drill-down drawer for the top Strength row
 *   <w>-4-strength-popover.png the Strength (i) formula popover
 *
 * The dashboard scrolls inside its own container (#intraday-scroll-root), so
 * a Playwright "fullPage" shot would only capture one viewport; instead the
 * viewport is temporarily resized to the content's full height.
 *
 * Usage (dev server running):
 *   DEV_SERVER_URL=http://localhost:5180 OUT_DIR=/tmp/intraday-shots node scripts/intraday-screenshots.mjs
 */
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const DEV_SERVER_URL = process.env.DEV_SERVER_URL ?? 'http://localhost:5180'
const OUT_DIR = path.resolve(process.env.OUT_DIR ?? '/tmp/intraday-shots')
const WIDTHS = [1920, 390]
const VIEWPORT_HEIGHT = { 1920: 1080, 390: 844 }

await mkdir(OUT_DIR, { recursive: true })
const browser = await chromium.launch({ headless: true })

async function fullHeight(page) {
  // Chrome height outside the scroll root (top bar, transport bar, status bar, footer) + the root's full content.
  return page.evaluate(() => {
    const root = document.getElementById('intraday-scroll-root')
    return Math.ceil(window.innerHeight - root.clientHeight + root.scrollHeight)
  })
}

async function shootFull(page, width, file) {
  const h = await fullHeight(page)
  await page.setViewportSize({ width, height: h })
  await page.waitForTimeout(400) // let ResizeObserver-driven charts re-measure
  await page.screenshot({ path: path.join(OUT_DIR, file) })
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT[width] })
  await page.waitForTimeout(300)
}

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT[width] }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.goto(`${DEV_SERVER_URL}/intraday`, { waitUntil: 'load' })
  await page.waitForFunction(
    () => {
      const t = document.getElementById('intraday-scroll-root')?.textContent ?? ''
      return /of (\d+) F&O names up/.test(t) && !/Loading \d+ \//.test(t) && !t.includes('Loading quotes')
    },
    undefined,
    { timeout: 30000 },
  )
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Skip')?.click())
  await page.waitForTimeout(1500)

  await shootFull(page, width, `${width}-1-dashboard.png`)

  // Sector filter: the strongest (first) Sector Strength bar.
  const sector = await page.evaluate(() => {
    const bar = document.querySelector('[role="button"][aria-label*="mean strength"]')
    bar?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return bar?.getAttribute('aria-label') ?? null
  })
  await page.waitForTimeout(600)
  await shootFull(page, width, `${width}-2-sector-filtered.png`)
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Clear all')?.click())
  await page.waitForTimeout(400)

  // Drill-down drawer for the top row of the Top Strength table.
  await page.evaluate(() => document.querySelector('button[aria-label^="Open details for"]')?.click())
  await page.waitForTimeout(1500)
  await page.screenshot({ path: path.join(OUT_DIR, `${width}-3-drawer.png`) })
  await page.evaluate(() => document.querySelector('button[aria-label="Close"]')?.click())
  await page.waitForTimeout(400)

  // Strength formula popover: the first Strength (i) on the page, scrolled into view first.
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="About the Strength metric"]')
    btn?.scrollIntoView({ block: 'center' })
  })
  await page.waitForTimeout(300)
  await page.evaluate(() => document.querySelector('button[aria-label="About the Strength metric"]')?.click())
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(OUT_DIR, `${width}-4-strength-popover.png`) })

  console.log(`${width}px: done (sector filter: ${sector})`)
  await context.close()
}

await browser.close()
console.log(`Screenshots: ${OUT_DIR}`)
process.exit(0)
