import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../../../strategy/constants'
import type { ScreenerStore } from '../../../store/screenerStore'
import { makeRow, renderWithRouter, seededStore } from '../../../test-utils/fixtures'
import { ParametersDrawer } from '../ParametersDrawer'
import { ParamsOverrideBanner } from '../ParamsOverrideBanner'

// Spec name mapping: "ParametersPanel" -> ParametersDrawer (+ ParamsOverrideBanner,
// the amber banner the table shows above the rows).

const FROZEN_DEFAULTS = structuredClone({ ...DEFAULT_PARAMS })
// Captured at IMPORT, before any store exists: zustand's immer middleware deep-freezes state, and the store's initial
// state holds DEFAULT_PARAMS — so checking isFrozen after a store is created would pass even if the source never froze it.
const FROZEN_AT_IMPORT = Object.isFrozen(DEFAULT_PARAMS)
const DEBOUNCE_MS = 400

function renderPanel(store: ScreenerStore) {
  return renderWithRouter(
    <>
      <ParamsOverrideBanner store={store} />
      <ParametersDrawer open onClose={() => {}} store={store} />
    </>,
  )
}

const buyMin = (): HTMLElement => screen.getByLabelText('Minimum BUY band RSI')
const buyMax = (): HTMLElement => screen.getByLabelText('Maximum BUY band RSI')

/** Both the amber banner and the drawer footer name the count — BOTH must be right (asserting either one lets the other be wrong). */
function expectEveryCount(n: number): void {
  const mentions = screen.getAllByText(/Running with \d+ modified parameters?/)
  expect(mentions).toHaveLength(2)
  for (const m of mentions) expect(m.textContent).toMatch(new RegExp(`Running with ${n} modified parameter${n === 1 ? '' : 's'}\\b`))
}

/** Lets the drawer's 400ms debounce fire and the resulting setParams() rescan settle. */
async function flushDebounce(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(DEBOUNCE_MS)
  })
  await act(async () => {})
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
  // Every test in this file must leave the shared defaults exactly as they were.
  expect({ ...DEFAULT_PARAMS }).toEqual(FROZEN_DEFAULTS)
})

describe('Parameters panel', () => {
  it('every slider handle has its own accessible name (the BUY and SELL bands are distinguishable)', () => {
    renderPanel(seededStore([makeRow()]))
    const names = screen.getAllByRole('slider').map((el) => el.getAttribute('aria-label'))
    expect(names).toEqual(['Minimum BUY band RSI', 'Maximum BUY band RSI', 'Minimum SELL band RSI', 'Maximum SELL band RSI'])
    expect(new Set(names).size).toBe(names.length)
  })

  it('starts on the reference defaults: no amber banner', () => {
    renderPanel(seededStore([makeRow()]))
    expect(screen.queryByText(/modified parameter/)).toBeNull()
    expect(screen.getByText('Matches the reference strategy defaults')).toBeInTheDocument()
  })

  it('moving the RSI band shows the amber "modified parameters" banner, naming the correct count', async () => {
    const store = seededStore([makeRow()])
    renderPanel(store)

    fireEvent.change(buyMin(), { target: { value: '55' } })
    await flushDebounce()
    expect(store.getState().params.rsiBuyLow).toBe(55)
    expectEveryCount(1)

    fireEvent.change(buyMax(), { target: { value: '70' } })
    await flushDebounce()
    expectEveryCount(2)
  })

  it('Reset restores DEFAULT_PARAMS exactly and clears the banner', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    const store = seededStore([makeRow()])
    renderPanel(store)
    fireEvent.change(buyMin(), { target: { value: '50' } })
    await flushDebounce()
    expect(screen.getAllByText(/modified parameter/).length).toBeGreaterThan(0)

    await user.click(screen.getAllByRole('button', { name: /Reset to (screener )?defaults/ })[0])
    await act(async () => {})
    expect(store.getState().params).toEqual(DEFAULT_PARAMS)
    expect(screen.queryByText(/Running with \d+ modified/)).toBeNull()
  })

  it("the BUY band's low cannot exceed its high, and the high cannot go below the low", async () => {
    const store = seededStore([makeRow()])
    renderPanel(store)

    fireEvent.change(buyMin(), { target: { value: '90' } }) // above the high (65)
    await flushDebounce()
    expect(store.getState().params.rsiBuyLow).toBe(DEFAULT_PARAMS.rsiBuyHigh)
    expect(store.getState().params.rsiBuyLow).toBeLessThanOrEqual(store.getState().params.rsiBuyHigh)

    fireEvent.change(buyMax(), { target: { value: '10' } }) // below the (new) low
    await flushDebounce()
    const { rsiBuyLow, rsiBuyHigh } = store.getState().params
    expect(rsiBuyHigh).toBe(rsiBuyLow)
    expect(rsiBuyLow).toBeLessThanOrEqual(rsiBuyHigh)
  })

  it('DEFAULT_PARAMS is frozen and editing never writes through to it', async () => {
    expect(FROZEN_AT_IMPORT).toBe(true)
    const store = seededStore([makeRow()])
    renderPanel(store)
    fireEvent.change(buyMin(), { target: { value: '40' } })
    fireEvent.change(screen.getByDisplayValue(String(DEFAULT_PARAMS.rsiPeriod)), { target: { value: '21' } })
    await flushDebounce()
    expect(store.getState().params).not.toBe(DEFAULT_PARAMS)
    expect(store.getState().params.rsiPeriod).toBe(21)
    expect({ ...DEFAULT_PARAMS }).toEqual(FROZEN_DEFAULTS) // (also asserted after every test)
  })
})
