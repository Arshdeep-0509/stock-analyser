import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// matchMedia — jsdom has none, and useMediaQuery() calls it on first render.
// Tests run at the "desktop" layout by default (matches: true), which the
// table-focused suites assume; a narrow-viewport test overrides
// window.matchMedia itself for the queries it cares about.
// ---------------------------------------------------------------------------
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// ---------------------------------------------------------------------------
// ResizeObserver — jsdom has none; the virtualizer and the chart size hooks
// construct one. This stub observes nothing and never fires: layout in jsdom
// is all zeros anyway, so there is nothing real to report. Tests that need a
// size mock it on the element (see mockViewportDimensions in the table tests).
// ---------------------------------------------------------------------------
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = ResizeObserverStub
  globalThis.ResizeObserver = ResizeObserverStub
}

// ---------------------------------------------------------------------------
// Fake timers + Testing Library. After every user-event action, RTL awaits a
// setTimeout(0) and only advances it itself when it detects JEST's fake
// timers (a global `jest` plus a faked setTimeout). Under Vitest's fake
// timers that check fails and the setTimeout(0) never fires, hanging the
// test. This shim makes the detection succeed and routes it to Vitest.
// ---------------------------------------------------------------------------
;(globalThis as { jest?: { advanceTimersByTime: (ms: number) => void } }).jest = {
  advanceTimersByTime: (ms: number) => {
    vi.advanceTimersByTime(ms)
  },
}

// ---------------------------------------------------------------------------
// failOnConsoleError — a React warning (they go to console.error) or any
// other console.error fails the test that caused it, instead of scrolling
// past in the output. A test that DELIBERATELY provokes an error (an error
// boundary test, a simulated network failure) opts in, per pattern, with
// allowConsoleError() — never a blanket mute.
// ---------------------------------------------------------------------------
const allowedPatterns: RegExp[] = []
let captured: string[] = []
const originalError = console.error

/** Lets the CURRENT test emit console.error lines matching `pattern`. Reset after every test. */
export function allowConsoleError(pattern: RegExp): void {
  allowedPatterns.push(pattern)
}

beforeEach(() => {
  captured = []
  allowedPatterns.length = 0
  console.error = (...args: unknown[]) => {
    const message = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')
    if (allowedPatterns.some((p) => p.test(message))) return
    captured.push(message)
  }
})

afterEach(() => {
  console.error = originalError
  if (captured.length > 0) {
    const lines = captured.map((m) => `  - ${m.slice(0, 500)}`).join('\n')
    captured = []
    throw new Error(`console.error was called during this test (failOnConsoleError):\n${lines}`)
  }
})
