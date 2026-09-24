import { test as base, expect, type Locator } from '@playwright/test'

/**
 * 2026-01-05 (a Monday) 13:00 IST, mid-session: the same instant as the unit
 * suite's SESSION_NOW. Every E2E test starts the page's clock here, so the
 * mock market (built from the seed AND the clock) is identical on every run,
 * whatever the real time of day, and the feed is live rather than closed.
 */
export const E2E_SESSION_START = new Date('2026-01-05T13:00:00+05:30')

/**
 * Console errors a test may tolerate, each matched by message and justified.
 * Empty on purpose: the build is fully offline (no CDN fonts, no network), so
 * there is no environment noise to excuse. Add an entry only with a reason.
 */
const ALLOWED_CONSOLE_ERRORS: { pattern: RegExp; reason: string }[] = []

interface Fixtures {
  /** Errors seen so far (console.error, uncaught exceptions, unhandled rejections). Checked after every test. */
  pageErrors: string[]
  /**
   * Opt out of the pinned clock (`test.use({ realClock: true })`). Playwright's fake clock also drives
   * requestAnimationFrame and replaces `performance`, which would falsify frame timing: the perf spec uses
   * the real clock and forces the session open instead.
   */
  realClock: boolean
}

export const test = base.extend<Fixtures>({
  pageErrors: async ({}, use) => {
    await use([])
  },
  realClock: [false, { option: true }],
  page: async ({ page, pageErrors, realClock }, use) => {
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = msg.text()
      if (!ALLOWED_CONSOLE_ERRORS.some((a) => a.pattern.test(text))) pageErrors.push(`console.error: ${text}`)
    })
    // Uncaught exceptions AND unhandled promise rejections both surface here.
    page.on('pageerror', (err) => pageErrors.push(`pageerror: ${err.message}`))

    if (!realClock) {
      await page.clock.install({ time: E2E_SESSION_START })
      await page.clock.resume()
    }
    // The first-run tour is a modal: dismissed up front so it never sits over what a test clicks.
    await page.addInitScript(() => {
      window.localStorage.setItem('rsi-ha:tour-dismissed', JSON.stringify({ version: 1, data: true }))
    })

    await use(page)
    expect(pageErrors, 'console errors / unhandled rejections during the test').toEqual([])
  },
})

export { expect }

/**
 * Boxes of the given elements, top to bottom, for overlap checks. The height
 * is the element's CONTENT height (scrollHeight): a card sized to its virtual
 * slot (`h-full`) whose content spills out of a too-small slot still reports
 * the slot's height as its box, and only the content height shows the
 * overlap a user sees.
 */
export async function contentBoxesTopToBottom(locator: Locator): Promise<{ y: number; height: number }[]> {
  const boxes = await locator.evaluateAll((els) => els.map((el) => ({ y: el.getBoundingClientRect().top, height: Math.max(el.getBoundingClientRect().height, el.scrollHeight) })))
  return boxes.sort((a, b) => a.y - b.y)
}

/** Every adjacent pair: the second starts at or below the first's bottom (half a pixel of rounding allowed). */
export function overlaps(boxes: readonly { y: number; height: number }[]): string[] {
  const bad: string[] = []
  for (let i = 1; i < boxes.length; i++) {
    const prev = boxes[i - 1]
    if (boxes[i].y < prev.y + prev.height - 0.5) bad.push(`#${i}: top ${boxes[i].y.toFixed(1)} < ${prev.y.toFixed(1)} + ${prev.height.toFixed(1)}`)
  }
  return bad
}

/** The screener's data rows (not the sticky header row). */
export function signalRows(page: import('@playwright/test').Page): Locator {
  return page.locator('[role="grid"][aria-label="Signals"] [role="row"][aria-selected]')
}

/** Every data row's symbol (the row's 2nd cell), in DOM order. Rows are virtualized: this is the rendered window, which holds every row while the list fits on screen. */
export async function visibleSymbols(page: import('@playwright/test').Page): Promise<string[]> {
  return signalRows(page).evaluateAll((rows) => rows.map((r) => `${r.children[1]?.textContent ?? ''}|${r.children[3]?.textContent ?? ''}`))
}
