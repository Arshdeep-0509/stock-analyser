import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, signalRows, test } from './fixtures'

/**
 * Layer 8: accessibility. axe finds zero serious or critical violations on
 * each state the spec names, plus the manual checks axe cannot make.
 */

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/rsi-ha')
  await expect(signalRows(page).first()).toBeVisible({ timeout: 15_000 })
})

async function seriousViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
}

test.describe('axe: zero serious or critical violations', () => {
  test('the loaded screener', async ({ page }) => {
    expect(await seriousViolations(page)).toEqual([])
  })

  test('the open detail drawer', async ({ page }) => {
    await signalRows(page).first().click()
    await expect(page.getByRole('heading', { name: 'Why this fired' })).toBeVisible()
    expect(await seriousViolations(page)).toEqual([])
  })

  test('the parameters drawer', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Parameters' }).click()
    await expect(page.getByRole('dialog', { name: 'Parameters' })).toBeVisible()
    expect(await seriousViolations(page)).toEqual([])
  })

  test('the shortcuts overlay', async ({ page }) => {
    await page.getByRole('button', { name: 'Show keyboard shortcuts' }).click()
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
    expect(await seriousViolations(page)).toEqual([])
  })

  test('the light theme', async ({ page }) => {
    await page.getByRole('button', { name: 'Switch to light theme' }).click()
    await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible()
    expect(await seriousViolations(page)).toEqual([])
  })
})

test('every interactive element is reachable by Tab, with a visible focus ring', async ({ page }) => {
  // Everything a user can operate that is on screen and in the tab order (roving-tabindex rows use -1 by design).
  const interactive = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'))
    return els
      .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
      .map((el, i) => {
        el.dataset.a11yId = String(i)
        return String(i)
      })
  })
  expect(interactive.length).toBeGreaterThan(10)

  await page.locator('body').focus()
  const reached = new Set<string>()
  const noRing: string[] = []
  for (let i = 0; i < interactive.length + 20; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const cs = getComputedStyle(el)
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow !== 'none' && cs.boxShadow !== '')
      return { id: el.dataset.a11yId ?? null, ring, label: el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName }
    })
    if (!info) continue
    if (info.id !== null) reached.add(info.id)
    if (!info.ring) noRing.push(info.label)
  }
  expect(interactive.filter((id) => !reached.has(id))).toEqual([])
  expect([...new Set(noRing)]).toEqual([])
})

test('the table is role="grid" with aria-rowcount', async ({ page }) => {
  const grid = page.getByRole('grid', { name: 'Signals' })
  await expect(grid).toBeVisible()
  expect(Number(await grid.getAttribute('aria-rowcount'))).toBe(await signalRows(page).count())
})

test('the aria-live region announces one message per scan, not one per row', async ({ page }) => {
  await page.evaluate(() => {
    const region = document.querySelector('[aria-live="polite"]')
    const w = window as unknown as { __announcements: string[] }
    w.__announcements = []
    if (region) new MutationObserver(() => w.__announcements.push(region.textContent ?? '')).observe(region, { childList: true, characterData: true, subtree: true })
  })
  const announcements = () => page.evaluate(() => (window as unknown as { __announcements: string[] }).__announcements.filter((t) => t.length > 0))

  // The first scan announced nothing (it is the starting state, not news).
  expect(await announcements()).toEqual([])

  // Let scheduled scans run across bar closes until one produces genuinely new rows.
  for (let i = 0; i < 12 && (await announcements()).length === 0; i++) {
    await page.clock.fastForward('05:00')
    await page.waitForTimeout(1500)
  }
  const said = await announcements()
  expect(said).toHaveLength(1)
  // One message naming at most three signals ("… And N more." beyond that), never the whole table.
  expect((said[0].match(/ signal, /g) ?? []).length).toBeLessThanOrEqual(3)
})

test('no control conveys its state by colour alone', async ({ page }) => {
  // Toggle-style controls must expose their state to assistive tech (aria-pressed / aria-checked / aria-selected / checked),
  // since their visual "on" state is a colour change.
  const offenders = await page.evaluate(() => {
    const groups: { name: string; els: Element[] }[] = [
      { name: 'signal filter chips', els: Array.from(document.querySelectorAll('[role="group"][aria-label="Filter by signal"] button')) },
      { name: 'replay speed chips', els: Array.from(document.querySelectorAll('button')).filter((b) => /^\d+x$/.test(b.textContent?.trim() ?? '')) },
      { name: 'left-rail sections', els: Array.from(document.querySelectorAll('nav[aria-label="Sections"] button')) },
    ]
    const stateful = (el: Element) => el.hasAttribute('aria-pressed') || el.hasAttribute('aria-checked') || el.hasAttribute('aria-selected') || el.hasAttribute('aria-current')
    return groups.flatMap((g) => g.els.filter((el) => !stateful(el)).map((el) => `${g.name}: ${el.textContent?.trim() || el.getAttribute('aria-label')}`))
  })
  expect(offenders).toEqual([])
})
