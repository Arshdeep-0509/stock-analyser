import { expect, signalRows, test } from './fixtures'

/**
 * Layer 7: the prototype's honesty claims must survive the UI. It is a
 * simulation; nothing on screen may present itself as a live market feed.
 */

test('the "PROTOTYPE · SIMULATED DATA" pill is visible at 1920px', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 })
  await page.goto('/rsi-ha')
  await expect(page.getByRole('banner').getByText('PROTOTYPE — SIMULATED DATA', { exact: true })).toBeVisible()
})

test('at 390px the same pill is still there, in its compact "SIMULATED" form', async ({ page }) => {
  // Deliberate in TopBar.tsx: below `sm` the pill shortens to "SIMULATED" (never disappears).
  // The spec asks for the full text at 390; the app's design is the short form, reported as a deviation.
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/rsi-ha')
  await expect(page.getByRole('banner').getByText('SIMULATED', { exact: true })).toBeVisible()
})

/** Every "live" / "real-time" (any case) in `text` that is NOT within 20 characters of "simulated". */
function unqualifiedLiveClaims(text: string): string[] {
  const bad: string[] = []
  for (const m of text.matchAll(/\b(live|real[- ]?time)\b/gi)) {
    const at = m.index ?? 0
    const window = text.slice(Math.max(0, at - 20), at + m[0].length + 20)
    if (!/simulated/i.test(window)) bad.push(`…${text.slice(Math.max(0, at - 30), at + m[0].length + 30).replace(/\s+/g, ' ')}…`)
  }
  return bad
}

for (const path of ['/rsi-ha', '/intraday']) {
  test(`${path}: no "live" or "real-time" claim that is not qualified as simulated`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(path)
    if (path === '/rsi-ha') await expect(signalRows(page).first()).toBeVisible({ timeout: 15_000 })
    // Fully loaded: the panels' session badges are rendered (LIVE · SIMULATED while open).
    else await expect(page.getByText('LIVE · SIMULATED').first()).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(0)
    const text = await page.locator('body').innerText()
    expect(unqualifiedLiveClaims(text)).toEqual([])
  })
}

test('the History panel carries its "not a backtest" disclaimer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/rsi-ha')
  await expect(signalRows(page).first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'History' }).click()
  await expect(page.getByRole('dialog', { name: 'History' }).getByText(/not a backtest/)).toBeVisible()
})

test('the "Place order" button is disabled', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/rsi-ha')
  await signalRows(page).first().click()
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled()
})
