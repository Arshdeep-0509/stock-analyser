import { useEffect, useMemo, useState } from 'react'
import { Download, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { cn } from '../../lib/cn'
import { formatISTDate, formatISTTime, formatNumber } from '../../lib/formatters'
import { useEscapeToClose } from '../../lib/useEscapeToClose'
import type { ScreenerStore } from '../../store/screenerStore'
import type { ScreenerRow } from '../../store/types'
import type { Candle } from '../../types/domain'
import { SignalBadge } from './cells'

export interface HistoryDrawerProps {
  open: boolean
  onClose: () => void
  store: ScreenerStore
}

const OUTCOME_BAR_OFFSETS = [1, 3, 6] as const

interface Outcome {
  [offset: number]: number | null // percent change, null if that many bars haven't happened yet
}

/** Dedupes store.history (which logs both a 'created' and an 'expired' snapshot per signal instance) down to one row per id, preferring the later/expired snapshot. */
function dedupeHistory(history: readonly ScreenerRow[]): ScreenerRow[] {
  const byId = new Map<string, ScreenerRow>()
  for (const row of history) {
    const existing = byId.get(row.id)
    if (!existing || (row.status === 'expired' && existing.status !== 'expired')) byId.set(row.id, row)
  }
  return Array.from(byId.values()).sort((a, b) => b.time - a.time)
}

function computeOutcome(candles: readonly Candle[], signalTime: number): Outcome {
  const index = candles.findIndex((c) => c.time === signalTime)
  if (index === -1) return {}
  const basePrice = candles[index].close
  const outcome: Outcome = {}
  for (const offset of OUTCOME_BAR_OFFSETS) {
    const target = candles[index + offset]
    outcome[offset] = target ? ((target.close - basePrice) / basePrice) * 100 : null
  }
  return outcome
}

function useOutcomes(rows: readonly ScreenerRow[], store: ScreenerStore): Map<string, Outcome> {
  const [outcomes, setOutcomes] = useState<Map<string, Outcome>>(new Map())

  useEffect(() => {
    let cancelled = false
    const tokens = Array.from(new Set(rows.map((r) => r.token).filter((t): t is string => Boolean(t))))

    void Promise.all(
      tokens.map(async (token) => {
        const row = rows.find((r) => r.token === token)
        if (!row) return null
        const candles = await store.getState().fetchCandlesForToken(token, row.exchange)
        return [token, candles] as const
      }),
    ).then((results) => {
      if (cancelled) return
      const candlesByToken = new Map(results.filter((r): r is [string, Candle[]] => r !== null))
      const next = new Map<string, Outcome>()
      for (const row of rows) {
        if (!row.token) continue
        const candles = candlesByToken.get(row.token)
        if (candles) next.set(row.id, computeOutcome(candles, row.time))
      }
      setOutcomes(next)
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, store])

  return outcomes
}

function OutcomeCell({ value }: { value: number | null | undefined }) {
  if (value === undefined) return <span className="text-text-muted">…</span>
  if (value === null) return <span className="text-text-muted">pending</span>
  const positive = value > 0
  const negative = value < 0
  return (
    <span className={cn('font-mono tabular-nums', positive && 'text-bullish', negative && 'text-bearish')}>
      {positive ? '+' : ''}
      {formatNumber(value, 2)}%
    </span>
  )
}

function rowsToHistoryCsv(rows: readonly ScreenerRow[], outcomes: Map<string, Outcome>): string {
  const header = ['Time', 'Symbol', 'Signal', 'Price', '+1 bar %', '+3 bar %', '+6 bar %']
  const lines = [header.join(',')]
  for (const row of rows) {
    const outcome = outcomes.get(row.id) ?? {}
    lines.push(
      [
        formatISTDate(new Date(row.time * 1000)) + ' ' + formatISTTime(new Date(row.time * 1000)),
        row.symbol,
        row.signal,
        row.price.toFixed(2),
        outcome[1] === null || outcome[1] === undefined ? '' : outcome[1].toFixed(2),
        outcome[3] === null || outcome[3] === undefined ? '' : outcome[3].toFixed(2),
        outcome[6] === null || outcome[6] === undefined ? '' : outcome[6].toFixed(2),
      ].join(','),
    )
  }
  return lines.join('\n')
}

export function HistoryDrawer({ open, onClose, store }: HistoryDrawerProps) {
  const rawHistory = store((s) => s.history)
  const rows = useMemo(() => dedupeHistory(rawHistory), [rawHistory])
  const outcomes = useOutcomes(open ? rows : [], store)

  useEscapeToClose(open, onClose)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-surface/70" onClick={onClose} />
      {/* min(560px, 100%): the fixed width never exceeds the viewport itself right at the sm breakpoint (480px < 560px). */}
      <div className="relative flex h-full w-full flex-col border-l border-border bg-panel sm:w-[min(560px,100%)]" role="dialog" aria-modal="true" aria-label="History">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-panel px-4 py-3">
          <h2 className="text-sm font-semibold text-text-primary">History</h2>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const csv = rowsToHistoryCsv(rows, outcomes)
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'rsi-ha-history.csv'
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <IconButton aria-label="Close" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <p className="border-b border-border-hairline bg-warning/10 px-4 py-2 text-[11px] text-warning">
          Hypothetical, mock data, no slippage or costs — not a backtest.
        </p>

        {/*
          One scroller, both axes — the table needs a horizontal one of its
          own on narrow viewports, and the sticky header only sticks
          correctly relative to a single ancestor scroll container, not two
          nested ones.
        */}
        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <p className="p-4 text-xs text-text-muted">No signals have fired yet this session.</p>
          ) : (
            <table className="w-full min-w-[560px] text-xs">
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-border text-left text-text-muted">
                  <th className="px-4 py-1.5 font-normal">Time</th>
                  <th className="px-2 py-1.5 font-normal">Symbol</th>
                  <th className="px-2 py-1.5 font-normal">Signal</th>
                  <th className="px-2 py-1.5 text-right font-normal">Price</th>
                  <th className="px-2 py-1.5 text-right font-normal">+1 bar</th>
                  <th className="px-2 py-1.5 text-right font-normal">+3 bar</th>
                  <th className="px-4 py-1.5 text-right font-normal">+6 bar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const outcome = outcomes.get(row.id)
                  return (
                    <tr
                      key={row.id}
                      onClick={() => {
                        store.getState().openRowDetail(row.id)
                        onClose()
                      }}
                      className="cursor-pointer border-b border-border-hairline hover:bg-surface"
                    >
                      <td className="px-4 py-1.5 font-mono tabular-nums text-text-secondary">{formatISTTime(new Date(row.time * 1000))}</td>
                      <td className="px-2 py-1.5 text-text-primary">{row.symbol}</td>
                      <td className="px-2 py-1.5">
                        <SignalBadge signal={row.signal} />
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-text-primary">{formatNumber(row.price, 2)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <OutcomeCell value={outcome?.[1]} />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <OutcomeCell value={outcome?.[3]} />
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        <OutcomeCell value={outcome?.[6]} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
