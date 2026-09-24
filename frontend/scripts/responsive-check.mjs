/**
 * Automated responsive verification for /rsi-ha AND /intraday across the
 * app's supported width range (360px - 1920px).
 *
 * /rsi-ha, per width: loads the page, waits for real signal rows (never a
 * placeholder), then asserts no horizontal page overflow — first in the
 * base populated state, then again after opening each of the detail drawer,
 * the Parameters drawer, and the shortcuts overlay.
 *
 * /intraday, per width: time until the analytics are on screen, no
 * placeholder left, no horizontal overflow, every chart's smallest rendered
 * font >= MIN_CHART_FONT_PX, sector cards wide enough to use, then a
 * sector-filtered state, the drill-down drawer (full-screen below sm) and
 * the Strength (i) popover (inside the viewport).
 *
 * Screenshots every state to <REPO>/tmp/responsive/. ROUTES=intraday (or
 * rsi-ha) limits the run to one page.
 *
 * Requires the dev server already running at DEV_SERVER_URL. Launches
 * Playwright's own headless Chromium, or attaches to one over CDP if CDP_URL
 * is set.
 *
 * Usage:
 *   DEV_SERVER_URL=http://localhost:5180 node scripts/responsive-check.mjs
 *   ROUTES=intraday DEV_SERVER_URL=http://localhost:5180 node scripts/responsive-check.mjs
 */
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

/** Optional: attach to an already-running Chromium over CDP. Unset (the default), the script launches Playwright's own headless Chromium. */
const CDP_URL = process.env.CDP_URL
const DEV_SERVER_URL = process.env.DEV_SERVER_URL ?? 'http://localhost:5180'
// Node resolves a leading "/" against the current drive root on Windows
// (-> D:\tmp\responsive here) rather than a real POSIX /tmp — that's fine,
// it's still an ephemeral, non-project location, which is the point.
const SHOT_DIR = path.resolve('/tmp/responsive')

const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [360, 390, 414, 768, 1024, 1280, 1920]
const T0 = Date.now()
/** Progress to stderr, so a slow step is visible while the run is still going. */
const progress = (msg) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${msg}\n`)
const HEIGHT = 900

await mkdir(SHOT_DIR, { recursive: true })

const browser = CDP_URL ? await chromium.connectOverCDP(CDP_URL, { timeout: 15000 }) : await chromium.launch({ headless: true })
const context = browser.contexts()[0] ?? (await browser.newContext())

/** Every element whose right edge extends past the viewport, excluding anything inside its own horizontally-scrollable ancestor (a table/chart/code block is allowed to scroll sideways). */
async function findOverflowingElements(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const offenders = []
    document.querySelectorAll('body *').forEach((el) => {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      if (rect.right <= vw + 1) return

      let node = el.parentElement
      let insideScroller = false
      while (node && node !== document.body) {
        const style = getComputedStyle(node)
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
          insideScroller = true
          break
        }
        node = node.parentElement
      }
      if (insideScroller) return

      offenders.push({
        tag: el.tagName,
        cls: el.className?.toString?.().slice(0, 90) ?? '',
        right: Math.round(rect.right),
        vw,
        text: el.textContent?.trim().slice(0, 40) ?? '',
      })
    })
    return offenders
  })
}

async function checkNoOverflow(page, label, results) {
  progress(`  check: ${label}`)
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const innerWidth = await page.evaluate(() => window.innerWidth)
  // /intraday scrolls inside its own root (overflow-y:auto, which makes overflow-x auto too) — sideways scroll THERE is horizontal page scroll as well.
  const rootOk = await page.evaluate(() => {
    const root = document.getElementById('intraday-scroll-root')
    return !root || root.scrollWidth <= root.clientWidth + 1
  })
  const scrollOk = scrollWidth <= innerWidth + 1 && rootOk

  const offenders = await findOverflowingElements(page)
  const elementsOk = offenders.length === 0

  results.push({
    label,
    scrollOk,
    elementsOk,
    scrollWidth,
    innerWidth,
    offenders: offenders.slice(0, 5),
  })
  return scrollOk && elementsOk
}

function evalClick(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    el.click()
    return true
  }, selector)
}

function clickByText(page, text, role = 'button') {
  return page.evaluate(
    ({ t, r }) => {
      const els = Array.from(document.querySelectorAll(r))
      const el = els.find((e) => e.textContent?.includes(t))
      el?.click()
      return !!el
    },
    { t: text, r: role },
  )
}

/** Smallest on-screen font size (px) of any visible chart <text> on the page — the "every chart legible" check. SVG text scales with its viewBox, so its authored fontSize alone says nothing; this multiplies by the element's actual screen transform. */
async function minChartFontPx(page) {
  return page.evaluate(() => {
    let min = Infinity
    let where = ''
    document.querySelectorAll('#intraday-scroll-root svg text').forEach((el) => {
      if (el.closest('.sr-only')) return
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || !el.textContent?.trim()) return
      const ctm = el.getScreenCTM()
      if (!ctm) return
      const size = parseFloat(getComputedStyle(el).fontSize) * Math.hypot(ctm.c, ctm.d)
      if (size < min) {
        min = size
        where = `${el.closest('section')?.querySelector('h2,h3')?.textContent?.trim() ?? '?'} "${el.textContent.trim().slice(0, 16)}"`
      }
    })
    return { min: Number.isFinite(min) ? Math.round(min * 10) / 10 : null, where }
  })
}

/** Anything still showing a loading/placeholder state inside the dashboard. */
async function findPlaceholders(page) {
  return page.evaluate(() => {
    const root = document.getElementById('intraday-scroll-root')
    if (!root) return ['no #intraday-scroll-root']
    const found = []
    if (root.querySelector('.animate-pulse.rounded')) found.push('skeleton')
    const text = root.textContent ?? ''
    for (const needle of ['Loading quotes', 'Loading ', 'Chart coming in a later step', 'No F&O names loaded yet']) {
      if (text.includes(needle)) found.push(needle)
    }
    return found
  })
}

const MIN_CHART_FONT_PX = Number(process.env.MIN_CHART_FONT_PX ?? 8)
const SM_BREAKPOINT = 480

async function checkIntraday(page, width, results, metrics) {
  const startedAt = Date.now()
  await page.goto(`${DEV_SERVER_URL}/intraday`, { waitUntil: 'load' })
  // Analytics on screen = the Market Meter's computed "<n> of <total> F&O names up" line, with a nonzero universe.
  await page.waitForFunction(
    () => {
      const m = document.body.textContent?.match(/of (\d+) F&O names up more than/)
      return m && Number(m[1]) > 0
    },
    undefined,
    { timeout: 30000 },
  )
  metrics.analyticsMs = Date.now() - startedAt
  await clickByText(page, 'Skip')
  // Let the first tick flushes and the 1s meter snapshot land.
  await page.waitForTimeout(1200)

  const placeholders = await findPlaceholders(page)
  results.push({ label: 'no placeholders', scrollOk: placeholders.length === 0, elementsOk: true, offenders: [], note: placeholders.join(', ') })

  await checkNoOverflow(page, 'dashboard', results)
  const font = await minChartFontPx(page)
  metrics.minChartFontPx = font.min
  results.push({ label: 'charts legible', scrollOk: font.min === null || font.min >= MIN_CHART_FONT_PX, elementsOk: true, offenders: [], note: `min ${font.min}px at ${font.where}` })

  const cardWidths = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#intraday-scroll-root section'))
      .filter((s) => s.querySelector('button[aria-label^="Expand "]:not([aria-label="Expand table"])'))
      .map((s) => Math.round(s.getBoundingClientRect().width)),
  )
  metrics.minSectorCardPx = cardWidths.length ? Math.min(...cardWidths) : null
  results.push({
    label: 'sector cards usable',
    scrollOk: cardWidths.length > 0 && Math.min(...cardWidths) >= Math.min(300, width - 40),
    elementsOk: true,
    offenders: [],
    note: `${cardWidths.length} cards, narrowest ${metrics.minSectorCardPx}px`,
  })
  await page.screenshot({ path: path.join(SHOT_DIR, `intraday-${width}-dashboard.png`) })

  // --- Sector filter (Sector Strength bar click) ---
  const filtered = await page.evaluate(() => {
    const bar = document.querySelector('[role="button"][aria-label*="mean strength"]')
    bar?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return bar?.getAttribute('aria-label') ?? null
  })
  await page.waitForTimeout(400)
  if (filtered) {
    await checkNoOverflow(page, 'sector filtered', results)
    await page.screenshot({ path: path.join(SHOT_DIR, `intraday-${width}-sector-filtered.png`) })
    await clickByText(page, 'Clear all')
    await page.waitForTimeout(300)
  } else {
    results.push({ label: 'sector filtered', scrollOk: false, elementsOk: false, offenders: [], note: 'no Sector Strength bar found' })
  }

  // --- Drill-down drawer ---
  const opened = await evalClick(page, 'button[aria-label^="Open details for"]')
  await page.waitForTimeout(600)
  if (opened) {
    await checkNoOverflow(page, 'drawer open', results)
    const drawerWidth = await page.evaluate(() => Math.round(document.querySelector('.fixed.inset-0.z-50 > div:nth-child(2)')?.getBoundingClientRect().width ?? 0))
    const fullScreenOk = width >= SM_BREAKPOINT || drawerWidth >= width - 1
    results.push({ label: 'drawer full-screen <sm', scrollOk: fullScreenOk, elementsOk: true, offenders: [], note: `drawer ${drawerWidth}px of ${width}px` })
    await page.screenshot({ path: path.join(SHOT_DIR, `intraday-${width}-drawer.png`) })
    await evalClick(page, 'button[aria-label="Close"]')
    await page.waitForTimeout(300)
  } else {
    results.push({ label: 'drawer open', scrollOk: false, elementsOk: false, offenders: [], note: 'no symbol button to open' })
  }

  // --- Strength formula popover ---
  const popoverOpened = await evalClick(page, 'button[aria-label="About the Strength metric"]')
  await page.waitForTimeout(300)
  if (popoverOpened) {
    await checkNoOverflow(page, 'strength popover', results)
    const inside = await page.evaluate(() => {
      const r = document.querySelector('[role="dialog"][aria-label="About the Strength metric"]')?.getBoundingClientRect()
      return !!r && r.left >= 0 && r.right <= window.innerWidth
    })
    results.push({ label: 'popover in viewport', scrollOk: inside, elementsOk: true, offenders: [] })
    await page.screenshot({ path: path.join(SHOT_DIR, `intraday-${width}-strength-popover.png`) })
    // Dispatched in-page, like the /rsi-ha checks below: Playwright's page.keyboard.press() can stall on the second page of a headless run.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  } else {
    results.push({ label: 'strength popover', scrollOk: false, elementsOk: false, offenders: [], note: 'no Strength (i) button' })
  }
}

const ROUTES = (process.env.ROUTES ?? 'rsi-ha,intraday').split(',')
const report = []

for (const width of WIDTHS) {
  if (!ROUTES.includes('intraday')) break
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message))
  const results = []
  const metrics = {}
  try {
    progress(`/intraday @ ${width}px`)
    await page.setViewportSize({ width, height: HEIGHT })
    await checkIntraday(page, width, results, metrics)
  } catch (err) {
    results.push({ label: 'ERROR', scrollOk: false, elementsOk: false, error: err instanceof Error ? err.message : String(err) })
  }
  report.push({ route: 'intraday', width, results, consoleErrors, metrics })
  await page.close()
}

for (const width of WIDTHS) {
  if (!ROUTES.includes('rsi-ha')) break
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message))

  const results = []
  try {
    await page.setViewportSize({ width, height: HEIGHT })
    await page.goto(`${DEV_SERVER_URL}/rsi-ha`, { waitUntil: 'load' })

    // Real rows, never a placeholder: wait for an actual nonzero signal count.
    await page.waitForFunction(
      () => {
        const m = document.body.textContent?.match(/(\d+) of (\d+) signals/)
        return m && Number(m[2]) > 0
      },
      undefined,
      { timeout: 30000 },
    )

    // Dismiss the first-run tour if it's showing, so it doesn't block later interactions.
    await clickByText(page, 'Skip')
    await page.waitForTimeout(200)

    await checkNoOverflow(page, 'populated table', results)
    await page.screenshot({ path: path.join(SHOT_DIR, `${width}-populated.png`) })

    // --- Detail drawer ---
    const rowOpened = await page.evaluate(() => {
      const card = document.querySelector('[role="listitem"] [role="button"]')
      const row = document.querySelector('[role="row"][aria-selected]')
      const target = card ?? row
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return !!target
    })
    if (rowOpened) {
      await page.waitForTimeout(500)
      await checkNoOverflow(page, 'detail drawer open', results)
      await page.screenshot({ path: path.join(SHOT_DIR, `${width}-detail.png`) })
      await evalClick(page, 'button[aria-label="Close"]')
      await page.waitForTimeout(200)
    } else {
      results.push({ label: 'detail drawer open', scrollOk: true, elementsOk: true, skipped: 'no row available to open' })
    }

    // --- Parameters drawer ---
    await evalClick(page, 'button[aria-label="Parameters"]')
    await page.waitForTimeout(400)
    await checkNoOverflow(page, 'parameters drawer open', results)
    await page.screenshot({ path: path.join(SHOT_DIR, `${width}-parameters.png`) })
    await evalClick(page, 'button[aria-label="Close"]')
    await page.waitForTimeout(200)

    // --- Shortcuts overlay ---
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true })))
    await page.waitForTimeout(300)
    await checkNoOverflow(page, 'shortcuts overlay open', results)
    await page.screenshot({ path: path.join(SHOT_DIR, `${width}-shortcuts.png`) })
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await page.waitForTimeout(200)
  } catch (err) {
    results.push({ label: 'ERROR', scrollOk: false, elementsOk: false, error: err instanceof Error ? err.message : String(err) })
  }

  report.push({ route: 'rsi-ha', width, results, consoleErrors })
  await page.close()
}

// Detach only — never close a browser this script didn't launch.
await browser.close().catch(() => {})

// --- Report ---
let allPass = true
console.log('\n=== Responsive check report ===\n')
for (const { route, width, results, consoleErrors, metrics } of report) {
  console.log(`--- /${route} @ ${width}px ---${metrics ? ` ${JSON.stringify(metrics)}` : ''}`)
  for (const r of results) {
    const pass = r.skipped ? true : r.scrollOk && r.elementsOk
    if (!pass) allPass = false
    const status = r.skipped ? `SKIP (${r.skipped})` : pass ? 'PASS' : 'FAIL'
    console.log(`  [${status}] ${r.label}${r.note ? ` (${r.note})` : ''}${r.error ? ` — ${r.error}` : ''}`)
    if (!pass && !r.skipped) {
      if (!r.scrollOk) console.log(`      scrollWidth=${r.scrollWidth} > innerWidth=${r.innerWidth}`)
      if (!r.elementsOk) {
        for (const o of r.offenders) {
          console.log(`      overflow: <${o.tag.toLowerCase()} class="${o.cls}"> right=${o.right} > vw=${o.vw} text="${o.text}"`)
        }
      }
    }
  }
  if (consoleErrors.length > 0) {
    allPass = false
    console.log(`  [FAIL] console/page errors: ${JSON.stringify(consoleErrors.slice(0, 5))}`)
  }
}

console.log('\n=== Summary table ===\n')
for (const route of ROUTES) {
  const rows = report.filter((r) => r.route === route)
  if (rows.length === 0) continue
  const labels = rows[0].results.map((r) => r.label).filter((l) => l !== 'ERROR')
  console.log(`/${route}`)
  console.log(`width  | ${labels.join(' | ')} | console`)
  for (const { width, results, consoleErrors } of rows) {
    const cell = (label) => {
      const r = results.find((x) => x.label === label)
      if (!r) return '?'.padEnd(label.length)
      if (r.skipped) return 'skip'.padEnd(label.length)
      return (r.scrollOk && r.elementsOk ? 'PASS' : 'FAIL').padEnd(label.length)
    }
    const errored = results.some((r) => r.label === 'ERROR')
    console.log(`${String(width).padEnd(6)} | ${labels.map(cell).join(' | ')} | ${consoleErrors.length === 0 ? 'PASS' : 'FAIL'}${errored ? '  (ERROR)' : ''}`)
  }
  console.log('')
}

console.log(`\nScreenshots: ${SHOT_DIR}`)
console.log(allPass ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED')
process.exit(allPass ? 0 : 1)
