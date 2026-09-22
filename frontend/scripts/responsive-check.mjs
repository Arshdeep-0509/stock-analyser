/**
 * Automated responsive verification for /rsi-ha across the app's supported
 * width range (360px - 1920px). For each width: loads the page, waits for
 * real signal rows (never a placeholder), then asserts no horizontal page
 * overflow — first in the base populated state, then again after opening
 * each of the detail drawer, the Parameters drawer, and the shortcuts
 * overlay. Screenshots every state to <REPO>/tmp/responsive/.
 *
 * Requires a CDP-reachable Chromium/Edge instance (see the CDP_URL env var)
 * and the dev server already running at DEV_SERVER_URL.
 *
 * Usage:
 *   CDP_URL=http://localhost:9331 DEV_SERVER_URL=http://localhost:5180 node scripts/responsive-check.mjs
 */
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const CDP_URL = process.env.CDP_URL ?? 'http://localhost:9331'
const DEV_SERVER_URL = process.env.DEV_SERVER_URL ?? 'http://localhost:5180'
// Node resolves a leading "/" against the current drive root on Windows
// (-> D:\tmp\responsive here) rather than a real POSIX /tmp — that's fine,
// it's still an ephemeral, non-project location, which is the point.
const SHOT_DIR = path.resolve('/tmp/responsive')

const WIDTHS = [360, 390, 414, 768, 1024, 1280, 1920]
const HEIGHT = 900

await mkdir(SHOT_DIR, { recursive: true })

const browser = await chromium.connectOverCDP(CDP_URL)
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
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  const innerWidth = await page.evaluate(() => window.innerWidth)
  const scrollOk = scrollWidth <= innerWidth + 1

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

const report = []

for (const width of WIDTHS) {
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

  report.push({ width, results, consoleErrors })
  await page.close()
}

await browser.close()

// --- Report ---
let allPass = true
console.log('\n=== Responsive check report ===\n')
for (const { width, results, consoleErrors } of report) {
  console.log(`--- ${width}px ---`)
  for (const r of results) {
    const pass = r.skipped ? true : r.scrollOk && r.elementsOk
    if (!pass) allPass = false
    const status = r.skipped ? `SKIP (${r.skipped})` : pass ? 'PASS' : 'FAIL'
    console.log(`  [${status}] ${r.label}${r.error ? ` — ${r.error}` : ''}`)
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
console.log('width  | populated | detail | parameters | shortcuts | console')
for (const { width, results, consoleErrors } of report) {
  const cell = (label) => {
    const r = results.find((x) => x.label === label)
    if (!r) return '  ?  '
    if (r.skipped) return ' skip'
    return r.scrollOk && r.elementsOk ? ' PASS' : ' FAIL'
  }
  console.log(
    `${String(width).padEnd(6)} | ${cell('populated table').padEnd(9)} | ${cell('detail drawer open').padEnd(6)} | ${cell('parameters drawer open').padEnd(10)} | ${cell('shortcuts overlay open').padEnd(9)} | ${consoleErrors.length === 0 ? ' PASS' : ' FAIL'}`,
  )
}

console.log(`\nScreenshots: ${SHOT_DIR}`)
console.log(allPass ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED')
process.exit(allPass ? 0 : 1)
