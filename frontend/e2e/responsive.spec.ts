import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

/**
 * Layer 8: responsive. At every width: no horizontal page scroll, and no
 * element pokes past the right edge of the viewport (content inside its own
 * scroll container, like the wide signals grid, is clipped there and is fine).
 * Then the same again with each drawer open.
 */

const WIDTHS = [360, 390, 414, 768, 1024, 1280, 1920] as const
const DRAWERS = ['Watchlists', 'Parameters', 'Alerts', 'History', 'Settings'] as const

/**
 * Elements that poke past either edge of the viewport, unless they sit inside
 * a SCROLL container (overflow auto/scroll) that itself fits: the wide signals
 * grid scrolls sideways inside its own box, which is fine. Content cut off by
 * overflow:hidden is NOT excused: that is content the user cannot reach. The
 * spec names the right edge; the left is checked too, because a right-aligned
 * drawer that is too wide overflows leftwards.
 */
async function overflowOffenders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const clipped = (el: Element): boolean => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX
        if (ox === 'auto' || ox === 'scroll') {
          const box = p.getBoundingClientRect()
          return box.right <= vw + 1 && box.left >= -1
        }
      }
      return false
    }
    const out: string[] = []
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      // An icon's inner <path>/<circle>: the <svg> itself is checked, and its clipping comes from the svg's ancestors.
      if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || (r.right <= vw + 1 && r.left >= -1)) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || (cs.position === 'fixed' && r.left >= vw)) continue // off-canvas, not visible
      if (el.classList.contains('sr-only') || clipped(el)) continue
      out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ').slice(0, 3).join('.')} left=${Math.round(r.left)} right=${Math.round(r.right)} (viewport ${vw})`)
    }
    return out.slice(0, 10)
  })
}

async function expectNoHorizontalOverflow(page: Page, context: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  expect(scrollWidth, `${context}: page scrollWidth`).toBeLessThanOrEqual(innerWidth + 1)
  expect(await overflowOffenders(page), `${context}: elements past the viewport edges`).toEqual([])
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/rsi-ha')
      const firstItem = width < 900 ? page.locator('[role="list"][aria-label="Signals"] [role="listitem"]').first() : page.locator('[role="grid"] [role="row"][aria-selected]').first()
      await expect(firstItem).toBeVisible({ timeout: 15_000 })
    })

    test('no horizontal overflow; the right layout for the width is mounted', async ({ page }, testInfo) => {
      await expectNoHorizontalOverflow(page, 'screener')
      // Below 900px the card list is mounted and the column grid is not (and vice versa).
      await expect(page.getByRole('list', { name: 'Signals' })).toHaveCount(width < 900 ? 1 : 0)
      await expect(page.getByRole('grid', { name: 'Signals' })).toHaveCount(width < 900 ? 0 : 1)
      await testInfo.attach(`screener-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
    })

    test('no horizontal overflow with each drawer open', async ({ page }) => {
      // The detail drawer, from the first row / card.
      const first = width < 900 ? page.locator('[role="listitem"] > [role="button"]').first() : page.locator('[role="grid"] [role="row"][aria-selected]').first()
      await first.click()
      await expect(page.getByRole('heading', { name: 'Why this fired' })).toBeVisible()
      await expectNoHorizontalOverflow(page, 'detail drawer')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('heading', { name: 'Why this fired' })).toBeHidden()

      for (const name of DRAWERS) {
        await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name }).click()
        await expect(page.getByRole('dialog', { name })).toBeVisible()
        await expectNoHorizontalOverflow(page, `${name} drawer`)
        await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog', { name })).toBeHidden()
      }
    })
  })
}
