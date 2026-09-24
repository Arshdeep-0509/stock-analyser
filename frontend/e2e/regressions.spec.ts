import { contentBoxesTopToBottom, expect, overlaps, test } from './fixtures'

/**
 * Layer 6, regression 1: needs real layout, so it runs here rather than in
 * jsdom (which measures every element at 0px). The rest of Layer 6 is in
 * src/__tests__/regressions.test.ts.
 */
test.describe('1. VIRTUALIZER REMEASURE ON LAYOUT FLIP', () => {
  test('wide -> narrow -> wide: cards and rows never overlap', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/rsi-ha')
    // Data rows only (the sticky header row carries aria-sort cells, not aria-selected).
    const gridRows = page.locator('[role="grid"] [role="row"][aria-selected]')
    await expect(gridRows.first()).toBeVisible({ timeout: 15_000 })
    expect(overlaps(await contentBoxesTopToBottom(gridRows))).toEqual([])

    await page.setViewportSize({ width: 800, height: 900 })
    const cards = page.locator('[role="list"][aria-label="Signals"] [role="listitem"] > [role="button"]')
    await expect(cards.nth(1)).toBeVisible()
    const cardBoxes = await contentBoxesTopToBottom(cards)
    expect(cardBoxes.length).toBeGreaterThan(1)
    expect(overlaps(cardBoxes)).toEqual([])

    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(gridRows.nth(1)).toBeVisible()
    const rowBoxes = await contentBoxesTopToBottom(gridRows)
    expect(rowBoxes.length).toBeGreaterThan(1)
    expect(overlaps(rowBoxes)).toEqual([])
  })
})
