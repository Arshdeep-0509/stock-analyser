import { readFileSync } from 'node:fs'
import { rowsToCsv } from '../src/features/rsi-ha/exportRows'
import { E2E_SEED } from '../playwright.config'
import { expect, signalRows, test, visibleSymbols } from './fixtures'

/**
 * Layer 7: the screener in a real browser, against the production build,
 * seed pinned via VITE_SEED and the clock pinned by the fixture, so every
 * run sees the same market. Every test also fails on any console error or
 * unhandled rejection (see fixtures.ts).
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/rsi-ha')
  await expect(signalRows(page).first()).toBeVisible({ timeout: 15_000 })
})

const statusBar = (page: import('@playwright/test').Page) => page.getByRole('contentinfo').filter({ hasText: 'Universe:' })

async function statusSignalCount(page: import('@playwright/test').Page): Promise<number> {
  const text = (await statusBar(page).textContent()) ?? ''
  const m = /Signals:\s*(\d+)/.exec(text)
  if (!m) throw new Error(`no signal count in status bar: ${text}`)
  return Number(m[1])
}

async function gridRowCount(page: import('@playwright/test').Page): Promise<number> {
  return Number(await page.getByRole('grid', { name: 'Signals' }).getAttribute('aria-rowcount'))
}

test('loads /rsi-ha and shows a populated table within 15s', async ({ page }) => {
  expect(await signalRows(page).count()).toBeGreaterThan(0)
})

test("the status bar's signal count equals the visible row count", async ({ page }) => {
  const count = await statusSignalCount(page)
  expect(count).toBeGreaterThan(0)
  expect(await gridRowCount(page)).toBe(count)
  // The whole list fits on screen here, so the rendered rows are all of them too.
  expect(await signalRows(page).count()).toBe(count)
})

test('searching narrows the table and updates the URL; reloading the URL restores the filtered view', async ({ page }) => {
  const all = await gridRowCount(page)
  const [first] = await visibleSymbols(page)
  const term = first.split('|')[0].slice(0, 4)
  await page.getByRole('textbox', { name: 'Search symbol' }).fill(term)
  await expect(page).toHaveURL(new RegExp(`[?&]q=${term}`))
  await expect.poll(() => gridRowCount(page)).toBeLessThan(all)
  const narrowed = await gridRowCount(page)
  for (const s of await visibleSymbols(page)) expect(s.split('|')[0]).toContain(term)

  await page.reload()
  await expect(signalRows(page).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('textbox', { name: 'Search symbol' })).toHaveValue(term)
  expect(await gridRowCount(page)).toBe(narrowed)
})

test('clicking a row opens the drawer with the same RSI and a "why this fired" checklist; Esc closes it', async ({ page }) => {
  const row = signalRows(page).first()
  const [symbol, rsiText] = await row.evaluate((r) => [r.children[1]?.textContent ?? '', r.children[7]?.textContent ?? ''])
  await row.click()

  // The symbol cell also carries the exchange tag ("ZEEL26JANFUTNFO"); the drawer heading is the bare symbol.
  const heading = page.getByRole('heading', { level: 2 }).filter({ hasNotText: 'Why this fired' }).first()
  await expect(heading).toBeVisible()
  const title = (await heading.textContent()) ?? ''
  expect(title.length).toBeGreaterThan(0)
  expect(symbol.startsWith(title)).toBe(true)
  await expect(page.getByRole('heading', { name: 'Why this fired' })).toBeVisible()
  // The checklist loads the candles first (a skeleton list stands in meanwhile): wait for the real items.
  const checklist = page.getByRole('heading', { name: 'Why this fired' }).locator('xpath=following-sibling::ul[not(@role="status")][1]')
  await expect(checklist.getByRole('listitem').filter({ hasText: /RSI/ }).first()).toBeVisible()

  // The drawer states the RSI to 2 dp ("RSI 43.11 is…" / "RSI(14) = 43.11 is…"); the row shows it to 1 dp.
  const rsiLine = await checklist.getByRole('listitem').filter({ hasText: /RSI/ }).first().textContent()
  const drawerRsi = Number(/RSI(?:\(14\))?(?: =)? ([\d.]+)/.exec(rsiLine ?? '')?.[1])
  expect(drawerRsi.toFixed(1)).toBe(Number(rsiText).toFixed(1))

  await page.keyboard.press('Escape')
  await expect(heading).toBeHidden()
})

test('Parameters: moving the RSI band shows the amber banner and changes the row count; Reset restores it', async ({ page }) => {
  const before = await gridRowCount(page)
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Parameters' }).click()
  const dialog = page.getByRole('dialog', { name: 'Parameters' })
  await expect(dialog).toBeVisible()

  // The BUY band's lower handle, dragged well down: 60 -> 40.
  const buyLow = dialog.getByRole('slider', { name: 'Minimum BUY band RSI' })
  await buyLow.focus()
  for (let i = 0; i < 20; i++) await buyLow.press('ArrowLeft')
  await expect(dialog.getByText('BUY band 40–65')).toBeVisible()

  await expect(page.getByText(/Running with 1 modified parameter — not the reference strategy/).first()).toBeVisible()
  await expect.poll(() => gridRowCount(page)).not.toBe(before)

  await dialog.getByRole('button', { name: /Reset to defaults/ }).click()
  await expect.poll(() => gridRowCount(page)).toBe(before)
  await expect(dialog.getByText('Matches the reference strategy defaults')).toBeVisible()
})

test('pause freezes the countdown; resume restarts it', async ({ page }) => {
  const nextScanText = async (): Promise<string> => /Next scan:\s*(paused|\d+s|—)/.exec((await statusBar(page).textContent()) ?? '')?.[1] ?? ''
  const nextScan = async (): Promise<number> => Number(/^(\d+)s$/.exec(await nextScanText())?.[1])
  const start = await nextScan()
  await expect.poll(nextScan).toBeLessThan(start) // the countdown is running

  await page.getByRole('button', { name: 'Pause scanning' }).click()
  await expect(page.getByText('· scanning paused')).toBeVisible()
  await expect.poll(nextScanText).toBe('paused')
  // Frozen: 3 more seconds of (simulated) time, still no countdown.
  await page.clock.runFor(3000)
  expect(await nextScanText()).toBe('paused')

  await page.getByRole('button', { name: 'Resume scanning' }).click()
  const resumed = await expect.poll(nextScan).toBeGreaterThan(0).then(() => nextScan())
  await expect.poll(nextScan, { timeout: 5_000 }).toBeLessThan(resumed)
})

test("CSV export downloads a file whose header row matches rowsToCsv's", async ({ page }) => {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const file = await (await download).path()
  const [header, ...rows] = readFileSync(file, 'utf8').split('\n')
  expect(header).toBe(rowsToCsv([]))
  expect(rows).toHaveLength(await gridRowCount(page))
})

test('the devtools panel (`~`) shows the seed', async ({ page }) => {
  await page.keyboard.press('Backquote')
  await expect(page.getByText('MOCK DEVTOOLS')).toBeVisible()
  // <dt>Seed</dt><dd>424242 (epoch 0)</dd>
  await expect(page.locator('dt', { hasText: /^Seed$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(`${E2E_SEED} (epoch 0)`)
})
