import type { Locator, Page } from '@playwright/test'
import { expect, signalRows, test } from './fixtures'

/**
 * Layer 8: visual regression. Baselines live in e2e/__screenshots__/ and are
 * committed; a deliberate UI change is re-baselined with
 * `npx playwright test e2e/visual.spec.ts --update-snapshots` (see
 * docs/TESTING.md). Everything that moves on its own is MASKED, or every run
 * would diff: the clock, the LTP and Chg % columns (live ticks), and the scan
 * countdowns.
 */

function liveRegions(page: Page): Locator[] {
  return [
    page.getByRole('banner').getByText(/IST/), // the simulated clock in the top bar
    page.locator('[role="row"][aria-selected] > :nth-child(6), [role="row"][aria-selected] > :nth-child(7)'), // LTP, Chg %
    page.getByText(/next scan in \d+s/), // toolbar countdown
    page.getByRole('contentinfo').filter({ hasText: 'Universe:' }), // status bar (countdown, last scan time)
  ]
}

async function open(page: Page, width = 1440): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/rsi-ha')
  const first = width < 900 ? page.locator('[role="list"][aria-label="Signals"] [role="listitem"]').first() : signalRows(page).first()
  await expect(first).toBeVisible({ timeout: 15_000 })
}

test('the table', async ({ page }) => {
  await open(page)
  // Element-level: maxDiffPixelRatio (0.01) is then measured against the table, not the whole page,
  // so a restyle of the rows is not diluted below the threshold by everything around them.
  await expect(page.getByRole('grid', { name: 'Signals' })).toHaveScreenshot('table.png', { mask: liveRegions(page) })
})

test('the detail drawer', async ({ page }) => {
  await open(page)
  await signalRows(page).first().click()
  // Wait for the drawer's own async content (checklist and chart) before the snapshot.
  await expect(page.getByRole('heading', { name: 'Why this fired' }).locator('xpath=following-sibling::ul[not(@role="status")][1]')).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading chart' })).toHaveCount(0)
  await expect(page).toHaveScreenshot('drawer.png', { mask: [...liveRegions(page), page.getByText(/^LTP /)] })
})

test('the parameters panel', async ({ page }) => {
  await open(page)
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Parameters' }).click()
  await expect(page.getByRole('dialog', { name: 'Parameters' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Parameters' })).toHaveScreenshot('parameters.png', { mask: liveRegions(page) })
})

test('the empty state', async ({ page }) => {
  await open(page)
  await page.getByRole('textbox', { name: 'Search symbol' }).fill('ZZZZNOSUCH')
  await expect(signalRows(page)).toHaveCount(0)
  await expect(page.getByRole('main')).toHaveScreenshot('empty.png', { mask: liveRegions(page) })
})

test('the light theme', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible()
  await expect(page).toHaveScreenshot('light.png', { mask: liveRegions(page) })
})

test('390px', async ({ page }) => {
  await open(page, 390)
  // The card list shows LTP inside each card: mask the cards' live figures too.
  await expect(page).toHaveScreenshot('390.png', { mask: [...liveRegions(page), page.locator('[role="listitem"] > [role="button"] > div:nth-child(2) > :nth-child(n+2)')] })
})
