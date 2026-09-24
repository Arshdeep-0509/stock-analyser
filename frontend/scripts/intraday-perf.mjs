/**
 * Performance budget check for /intraday (default seed, live clock).
 *
 *  1. First meaningful paint: ms from navigation start until the Market
 *     Meter's computed "<n> of <total> F&O names up" line is in the DOM with
 *     total > 0 — recorded IN the page by a MutationObserver installed before
 *     any app script runs, so it's page time, not driver round-trip time.
 *     Also records when the full universe finished loading.
 *  2. Steady-state scripting per animation frame with ticks flowing: CDP
 *     Performance.getMetrics' cumulative ScriptDuration, sampled at the start
 *     and end of a window, divided by the number of animation frames the page
 *     itself counted (a rAF loop) in that window. Also reports the worst
 *     frame-to-frame gap and how many frames exceeded 50ms.
 *  3. Render counts: opens the `~` devtools panel, resets its render
 *     counters, lets ticks flow for WINDOW_SEC, and reads the overlay.
 *
 * Usage (dev server already running):
 *   DEV_SERVER_URL=http://localhost:5180 node scripts/intraday-perf.mjs
 */
import { chromium } from 'playwright-core'

const DEV_SERVER_URL = process.env.DEV_SERVER_URL ?? 'http://localhost:5180'
const WINDOW_SEC = Number(process.env.WINDOW_SEC ?? 50)
const WIDTH = Number(process.env.WIDTH ?? 1920)
const FMP_BUDGET_MS = 2000
const SCRIPT_PER_FRAME_BUDGET_MS = 8

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: WIDTH, height: 1080 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.addInitScript(() => {
  const marks = { fmp: null, full: null }
  window.__intradayPerf = marks
  const check = () => {
    const text = document.getElementById('intraday-scroll-root')?.textContent ?? ''
    const m = text.match(/of (\d+) F&O names up more than/)
    if (m && Number(m[1]) > 0 && marks.fmp === null) marks.fmp = performance.now()
    if (m && Number(m[1]) > 0 && !/Loading \d+ \/ \d+ instruments/.test(text) && !text.includes('Loading quotes') && marks.full === null) {
      marks.full = performance.now()
    }
    if (marks.full !== null) observer.disconnect()
  }
  const observer = new MutationObserver(check)
  document.addEventListener('DOMContentLoaded', () => observer.observe(document.body, { subtree: true, childList: true, characterData: true }))
})

await page.goto(`${DEV_SERVER_URL}/intraday`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__intradayPerf?.full !== null, undefined, { timeout: 30000 })
const marks = await page.evaluate(() => window.__intradayPerf)

// Dismiss the first-run tour if present.
await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Skip')?.click())

// Open the `~` devtools panel and zero its render counters.
await page.keyboard.press('Backquote')
await page.waitForTimeout(300)
await page.evaluate(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Reset')?.click())

const cdp = await context.newCDPSession(page)
await cdp.send('Performance.enable')
const metric = async (name) => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === name)?.value ?? 0

await page.evaluate(() => {
  const s = { frames: 0, worstGap: 0, over50: 0, last: performance.now(), running: true }
  window.__frameStats = s
  const loop = (t) => {
    if (!s.running) return
    const gap = t - s.last
    if (s.frames > 0) {
      s.worstGap = Math.max(s.worstGap, gap)
      if (gap > 50) s.over50 += 1
    }
    s.last = t
    s.frames += 1
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
})
const scriptStart = await metric('ScriptDuration')
const taskStart = await metric('TaskDuration')
const wallStart = Date.now()

await page.waitForTimeout(WINDOW_SEC * 1000)

const scriptEnd = await metric('ScriptDuration')
const taskEnd = await metric('TaskDuration')
const wallMs = Date.now() - wallStart
const frames = await page.evaluate(() => {
  window.__frameStats.running = false
  return window.__frameStats
})

const renderCounts = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[aria-label="Render counts"] li')).map((li) => li.textContent?.replace(/\s+/g, ' ').trim()),
)
const ticking = await page.evaluate(() => document.getElementById('intraday-scroll-root')?.textContent?.match(/of (\d+) F&O names up/)?.[1])

const scriptMs = (scriptEnd - scriptStart) * 1000
const taskMs = (taskEnd - taskStart) * 1000
const perFrame = scriptMs / Math.max(1, frames.frames)

console.log(`\n=== /intraday performance @ ${WIDTH}px, default seed ===`)
console.log(`First meaningful paint (analytics on screen): ${Math.round(marks.fmp)} ms  [budget < ${FMP_BUDGET_MS}] ${marks.fmp < FMP_BUDGET_MS ? 'PASS' : 'FAIL'}`)
console.log(`Full universe + quotes loaded:                ${Math.round(marks.full)} ms`)
console.log(`Steady-state window: ${(wallMs / 1000).toFixed(1)} s, ${frames.frames} animation frames (${(frames.frames / (wallMs / 1000)).toFixed(1)} fps)`)
console.log(`  scripting total ${Math.round(scriptMs)} ms, main-thread tasks total ${Math.round(taskMs)} ms`)
console.log(`  scripting per animation frame (mean): ${perFrame.toFixed(2)} ms  [budget < ${SCRIPT_PER_FRAME_BUDGET_MS}] ${perFrame < SCRIPT_PER_FRAME_BUDGET_MS ? 'PASS' : 'FAIL'}`)
console.log(`  worst frame gap ${Math.round(frames.worstGap)} ms, frames > 50ms: ${frames.over50}`)
console.log(`\nRender counts after ${WINDOW_SEC}s of live ticking (from the ~ devtools overlay):`)
for (const line of renderCounts) console.log(`  ${line}`)
console.log(`\nUniverse on screen: ${ticking} names. Console/page errors: ${errors.length}${errors.length ? ' ' + JSON.stringify(errors.slice(0, 3)) : ''}`)

await browser.close()
process.exit(marks.fmp < FMP_BUDGET_MS && perFrame < SCRIPT_PER_FRAME_BUDGET_MS && errors.length === 0 ? 0 : 1)
