import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAlertStore } from '../alertStore'
import type { ScreenerRow } from '../types'

function row(overrides: Partial<ScreenerRow> = {}): ScreenerRow {
  return {
    id: '1',
    symbol: 'RELIANCE-EQ',
    exchange: 'NSE',
    signal: 'BUY',
    price: 2500,
    rsi: 62,
    time: 100,
    status: 'active',
    firstSeenAt: 100,
    lastSeenAt: 100,
    pinned: false,
    ...overrides,
  }
}

afterEach(() => {
  localStorage.clear()
})

beforeEach(() => {
  useAlertStore.setState({ rules: [], notifications: [], soundEnabled: false, browserNotificationsEnabled: false })
})

describe('alertStore', () => {
  it('an any-buy rule fires only for BUY signals', () => {
    useAlertStore.getState().addRule({ type: 'any-buy', enabled: true })

    useAlertStore.getState().evaluateRow(row({ signal: 'BUY' }))
    expect(useAlertStore.getState().notifications).toHaveLength(1)

    useAlertStore.getState().evaluateRow(row({ id: '2', signal: 'SELL' }))
    expect(useAlertStore.getState().notifications).toHaveLength(1) // unchanged
  })

  it('a symbol rule fires only for that exact symbol', () => {
    useAlertStore.getState().addRule({ type: 'symbol', symbol: 'TCS-EQ', enabled: true })

    useAlertStore.getState().evaluateRow(row({ symbol: 'RELIANCE-EQ' }))
    expect(useAlertStore.getState().notifications).toHaveLength(0)

    useAlertStore.getState().evaluateRow(row({ id: '2', symbol: 'TCS-EQ' }))
    expect(useAlertStore.getState().notifications).toHaveLength(1)
  })

  it('an rsi-threshold rule respects direction and does not fire on NaN RSI', () => {
    useAlertStore.getState().addRule({ type: 'rsi-threshold', direction: 'above', value: 65, enabled: true })

    useAlertStore.getState().evaluateRow(row({ rsi: 60 }))
    expect(useAlertStore.getState().notifications).toHaveLength(0)

    useAlertStore.getState().evaluateRow(row({ id: '2', rsi: NaN }))
    expect(useAlertStore.getState().notifications).toHaveLength(0)

    useAlertStore.getState().evaluateRow(row({ id: '3', rsi: 70 }))
    expect(useAlertStore.getState().notifications).toHaveLength(1)
  })

  it('a disabled rule never fires', () => {
    useAlertStore.getState().addRule({ type: 'any-buy', enabled: true })
    const ruleId = useAlertStore.getState().rules[0].id
    useAlertStore.getState().toggleRule(ruleId)

    useAlertStore.getState().evaluateRow(row())
    expect(useAlertStore.getState().notifications).toHaveLength(0)
  })

  it('markRead/markAllRead/clearAll manage notification state', () => {
    useAlertStore.getState().addRule({ type: 'any-buy', enabled: true })
    useAlertStore.getState().evaluateRow(row())
    useAlertStore.getState().evaluateRow(row({ id: '2' }))

    const [first] = useAlertStore.getState().notifications
    useAlertStore.getState().markRead(first.id)
    expect(useAlertStore.getState().notifications.find((n) => n.id === first.id)?.read).toBe(true)
    expect(useAlertStore.getState().notifications.some((n) => !n.read)).toBe(true)

    useAlertStore.getState().markAllRead()
    expect(useAlertStore.getState().notifications.every((n) => n.read)).toBe(true)

    useAlertStore.getState().clearAll()
    expect(useAlertStore.getState().notifications).toHaveLength(0)
  })

  it('persists rules to localStorage', () => {
    useAlertStore.getState().addRule({ type: 'any-buy', enabled: true })
    const raw = localStorage.getItem('rsi-ha:alert-rules')
    expect(raw).toContain('any-buy')
  })
})
