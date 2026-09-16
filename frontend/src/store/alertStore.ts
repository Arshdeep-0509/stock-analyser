import { create } from 'zustand'
import { loadVersioned, saveVersioned } from '../lib/persistence'
import type { ScreenerRow } from './types'

const RULES_STORAGE_KEY = 'rsi-ha:alert-rules'
const RULES_STORAGE_VERSION = 1

export interface AnyBuyRule {
  id: string
  type: 'any-buy'
  enabled: boolean
}
export interface SymbolRule {
  id: string
  type: 'symbol'
  symbol: string
  enabled: boolean
}
export interface RsiThresholdRule {
  id: string
  type: 'rsi-threshold'
  direction: 'above' | 'below'
  value: number
  enabled: boolean
}
export type AlertRule = AnyBuyRule | SymbolRule | RsiThresholdRule

export interface AlertNotification {
  id: string
  ruleId: string
  rowId: string
  symbol: string
  message: string
  time: number
  read: boolean
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function ruleMatches(rule: AlertRule, row: ScreenerRow): string | null {
  if (!rule.enabled) return null
  switch (rule.type) {
    case 'any-buy':
      return row.signal === 'BUY' ? `${row.symbol} fired BUY` : null
    case 'symbol':
      return row.symbol === rule.symbol ? `${row.symbol} fired ${row.signal}` : null
    case 'rsi-threshold': {
      if (Number.isNaN(row.rsi)) return null
      const crossed = rule.direction === 'above' ? row.rsi > rule.value : row.rsi < rule.value
      return crossed ? `${row.symbol} RSI ${row.rsi.toFixed(1)} ${rule.direction} ${rule.value}` : null
    }
  }
}

function persistRules(rules: AlertRule[]): void {
  saveVersioned(RULES_STORAGE_KEY, RULES_STORAGE_VERSION, rules)
}

function loadInitialRules(): AlertRule[] {
  return loadVersioned<AlertRule[]>(RULES_STORAGE_KEY, RULES_STORAGE_VERSION, () => null) ?? []
}

function requestBrowserPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return Promise.resolve('denied')
  if (Notification.permission !== 'default') return Promise.resolve(Notification.permission)
  return Notification.requestPermission()
}

export interface AlertState {
  rules: AlertRule[]
  notifications: AlertNotification[]
  soundEnabled: boolean
  browserNotificationsEnabled: boolean

  addRule: (rule: Omit<AnyBuyRule, 'id'> | Omit<SymbolRule, 'id'> | Omit<RsiThresholdRule, 'id'>) => void
  removeRule: (id: string) => void
  toggleRule: (id: string) => void

  markRead: (id: string) => void
  markAllRead: () => void
  clearAll: () => void

  setSoundEnabled: (enabled: boolean) => void
  /** Handled gracefully if the browser denies or has no Notification API — resolves the granted permission state either way. */
  enableBrowserNotifications: () => Promise<NotificationPermission>

  /** Called by the screener store for every freshly-created row after a real scan — evaluates every enabled rule against it. */
  evaluateRow: (row: ScreenerRow) => void
}

export const useAlertStore = create<AlertState>()((set, get) => ({
  rules: loadInitialRules(),
  notifications: [],
  soundEnabled: false,
  browserNotificationsEnabled: false,

  addRule(rule) {
    const rules = [...get().rules, { ...rule, id: makeId('rule') } as AlertRule]
    set({ rules })
    persistRules(rules)
  },

  removeRule(id) {
    const rules = get().rules.filter((r) => r.id !== id)
    set({ rules })
    persistRules(rules)
  },

  toggleRule(id) {
    const rules = get().rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    set({ rules })
    persistRules(rules)
  },

  markRead(id) {
    set({ notifications: get().notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) })
  },

  markAllRead() {
    set({ notifications: get().notifications.map((n) => ({ ...n, read: true })) })
  },

  clearAll() {
    set({ notifications: [] })
  },

  setSoundEnabled(enabled) {
    set({ soundEnabled: enabled })
  },

  async enableBrowserNotifications() {
    const permission = await requestBrowserPermission()
    set({ browserNotificationsEnabled: permission === 'granted' })
    return permission
  },

  evaluateRow(row) {
    const matched: AlertNotification[] = []
    for (const rule of get().rules) {
      const message = ruleMatches(rule, row)
      if (message) {
        matched.push({ id: makeId('notif'), ruleId: rule.id, rowId: row.id, symbol: row.symbol, message, time: row.time, read: false })
      }
    }
    if (matched.length === 0) return

    set({ notifications: [...matched, ...get().notifications] })

    if (get().browserNotificationsEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const notification of matched) {
        try {
          new Notification('RSI-HA alert', { body: notification.message })
        } catch {
          // Notification construction can throw in some contexts (e.g. no user activation) — a missed browser notification isn't worth surfacing an error for.
        }
      }
    }
  },
}))
