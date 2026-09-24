import { useEffect, useRef, useState } from 'react'
import {
  BaselineSeries,
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { theme } from '../../app/theme'
import { CHART_HEIGHT_CLASS } from './chartHeight'
import { haStreakLength } from '../../strategy/indicators'
import type { StrategyParams } from '../../strategy/constants'
import type { AnalyzedCandle, Candle, SignalKind } from '../../types/domain'
import { formatNumber } from '../../lib/formatters'

/**
 * The only fields this chart actually reads off a "row" — deliberately NOT
 * `ScreenerRow` itself, so a caller with a different row shape (e.g.
 * /intraday's drill-down drawer, built from an IntradayRow) can construct
 * one of these directly instead of needing a second chart component.
 * `signal` is optional: omitting it (and `level`) renders a plain chart with
 * neither a BUY/SELL marker nor a breakout level line — the correct
 * behaviour for a row that isn't currently a signal or a breakout.
 */
export interface SignalChartRow {
  time: number
  signal?: SignalKind
  level?: number
}

export interface SignalChartProps {
  candles: Candle[]
  analyzed: AnalyzedCandle[]
  params: StrategyParams
  row: SignalChartRow
  showRawOverlay: boolean
  /** Optional VWAP reference line — /intraday's drill-down drawer passes today's session VWAP (IntradayRow.vwap); /rsi-ha's own detail view omits it. Drawn as a plain price line, distinct in colour/style from the breakout level line so the two are never confused. */
  vwap?: number
}

export interface HoverInfo {
  time: number
  open: number
  high: number
  low: number
  close: number
  haOpen: number
  haHigh: number
  haLow: number
  haClose: number
  haColor: 'green' | 'red'
  streak: number
  rsi: number
}

const UPPER_STRETCH = 7
const LOWER_STRETCH = 3

export function SignalChart({ candles, analyzed, params, row, showRawOverlay, vwap }: SignalChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || analyzed.length === 0) return

    const chart: IChartApi = createChart(container, {
      layout: {
        background: { color: 'transparent' },
        textColor: theme.colors.textSecondary,
        fontFamily: theme.font.ui,
        panes: { separatorColor: theme.colors.border, separatorHoverColor: theme.colors.border },
      },
      grid: {
        vertLines: { color: theme.colors.borderHairline },
        horzLines: { color: theme.colors.borderHairline },
      },
      rightPriceScale: { borderColor: theme.colors.border },
      timeScale: { borderColor: theme.colors.border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: true,
    })

    // ---- Upper pane: Heikin-Ashi candles, built ONLY from haOpen/haHigh/haLow/haClose ----
    const haSeries = chart.addSeries(
      CandlestickSeries,
      {
        upColor: theme.colors.bullish,
        downColor: theme.colors.bearish,
        borderUpColor: theme.colors.bullish,
        borderDownColor: theme.colors.bearish,
        wickUpColor: theme.colors.bullish,
        wickDownColor: theme.colors.bearish,
      },
      0,
    )
    haSeries.setData(
      analyzed.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.haOpen,
        high: c.haHigh,
        low: c.haLow,
        close: c.haClose,
      })),
    )

    let rawSeries: ISeriesApi<'Candlestick'> | undefined
    if (showRawOverlay) {
      rawSeries = chart.addSeries(
        CandlestickSeries,
        {
          upColor: 'rgba(230,237,243,0.22)',
          downColor: 'rgba(230,237,243,0.10)',
          borderVisible: false,
          wickUpColor: 'rgba(230,237,243,0.3)',
          wickDownColor: 'rgba(230,237,243,0.3)',
          priceLineVisible: false,
          lastValueVisible: false,
        },
        0,
      )
      rawSeries.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })))
    }

    // ---- Signal marker + streak tint ----
    const markers: SeriesMarker<Time>[] = []
    const signalIndex = analyzed.findIndex((c) => c.time === row.time)

    if (signalIndex >= 0 && (row.signal === 'BUY' || row.signal === 'SELL')) {
      const isBuy = row.signal === 'BUY'
      markers.push({
        time: analyzed[signalIndex].time as UTCTimestamp,
        position: isBuy ? 'belowBar' : 'aboveBar',
        color: isBuy ? theme.colors.bullish : theme.colors.bearish,
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        text: row.signal,
      })

      // Tint the two bars of the qualifying streak (the signal bar and the
      // one before it — the exact pair haStreakLength() confirms as "2nd
      // candle"), distinct from the arrow marking the signal itself.
      for (const idx of [signalIndex - 1, signalIndex]) {
        if (idx < 0) continue
        markers.push({
          time: analyzed[idx].time as UTCTimestamp,
          position: 'inBar',
          color: theme.colors.neutral,
          shape: 'circle',
          size: 0.6,
        })
      }
    }

    if (markers.length > 0) {
      createSeriesMarkers(haSeries, markers.sort((a, b) => (a.time as number) - (b.time as number)))
    }

    // ---- Breakout: level line + lookback-window shading ----
    if (row.level !== undefined && (row.signal === 'BREAKOUT-UP' || row.signal === 'BREAKOUT-DOWN')) {
      const isUp = row.signal === 'BREAKOUT-UP'
      haSeries.createPriceLine({
        price: row.level,
        color: theme.colors.warning,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `20-bar ${isUp ? 'high' : 'low'} ${formatNumber(row.level, 2)}`,
      })

      if (signalIndex >= 0) {
        const lookback = params.breakoutLookback
        const windowStart = Math.max(0, signalIndex - lookback)
        // Lightweight-charts has no native vertical time-range shade in its
        // stable API, so the lookback window is marked with a thin tinted
        // strip along the bottom of the upper pane instead of a full shade.
        const strip = chart.addSeries(
          BaselineSeries,
          {
            baseValue: { type: 'price', price: 0 },
            topFillColor1: 'rgba(227,160,8,0.18)',
            topFillColor2: 'rgba(227,160,8,0.18)',
            bottomFillColor1: 'rgba(0,0,0,0)',
            bottomFillColor2: 'rgba(0,0,0,0)',
            lineVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          },
          0,
        )
        const stripLow = Math.min(...candles.slice(windowStart, signalIndex).map((c) => c.low))
        strip.setData(
          analyzed.slice(windowStart, signalIndex).map((c) => ({ time: c.time as UTCTimestamp, value: stripLow * 1.0005 })),
        )
      }
    }

    // ---- VWAP: a plain reference line, distinct from the breakout level's dashed warning line ----
    if (vwap !== undefined && !Number.isNaN(vwap)) {
      haSeries.createPriceLine({
        price: vwap,
        color: theme.colors.neutral,
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `VWAP ${formatNumber(vwap, 2)}`,
      })
    }

    // ---- Lower pane: RSI line, 60-65/35-40 bands shaded, 30/70 reference lines ----
    const rsiPoints = analyzed.filter((c) => !Number.isNaN(c.rsi)).map((c) => ({ time: c.time as UTCTimestamp, value: c.rsi }))
    const rsiSeries = chart.addSeries(LineSeries, { color: theme.colors.neutral, lineWidth: 2 }, 1)
    rsiSeries.setData(rsiPoints)
    rsiSeries.applyOptions({
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    })

    if (rsiPoints.length > 0) {
      const first = rsiPoints[0].time
      const last = rsiPoints[rsiPoints.length - 1].time

      const buyBand = chart.addSeries(
        BaselineSeries,
        {
          baseValue: { type: 'price', price: params.rsiBuyLow },
          topFillColor1: 'rgba(38,161,123,0.22)',
          topFillColor2: 'rgba(38,161,123,0.22)',
          bottomFillColor1: 'rgba(0,0,0,0)',
          bottomFillColor2: 'rgba(0,0,0,0)',
          lineVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        1,
      )
      buyBand.setData([
        { time: first, value: params.rsiBuyHigh },
        { time: last, value: params.rsiBuyHigh },
      ])

      const sellBand = chart.addSeries(
        BaselineSeries,
        {
          baseValue: { type: 'price', price: params.rsiSellHigh },
          bottomFillColor1: 'rgba(229,72,77,0.22)',
          bottomFillColor2: 'rgba(229,72,77,0.22)',
          topFillColor1: 'rgba(0,0,0,0)',
          topFillColor2: 'rgba(0,0,0,0)',
          lineVisible: false,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        1,
      )
      sellBand.setData([
        { time: first, value: params.rsiSellLow },
        { time: last, value: params.rsiSellLow },
      ])
    }

    rsiSeries.createPriceLine({ price: 70, color: theme.colors.textMuted, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '70' })
    rsiSeries.createPriceLine({ price: 30, color: theme.colors.textMuted, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: '30' })

    const panes = chart.panes()
    panes[0]?.setStretchFactor(UPPER_STRETCH)
    panes[1]?.setStretchFactor(LOWER_STRETCH)

    // ---- Crosshair-synced tooltip: same haStreakLength() the engine uses, called on the hovered bar ----
    chart.subscribeCrosshairMove((param) => {
      if (param.time === undefined) {
        setHover(null)
        return
      }
      const idx = analyzed.findIndex((c) => c.time === param.time)
      if (idx === -1) {
        setHover(null)
        return
      }
      const c = analyzed[idx]
      const { streak } = haStreakLength(analyzed, idx)
      setHover({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        haOpen: c.haOpen,
        haHigh: c.haHigh,
        haLow: c.haLow,
        haClose: c.haClose,
        haColor: c.haColor,
        streak,
        rsi: c.rsi,
      })
    })

    return () => {
      chart.remove()
    }
  }, [candles, analyzed, params, row, showRawOverlay, vwap])

  return (
    <div className="relative">
      <div ref={containerRef} className={CHART_HEIGHT_CLASS} />
      {hover && <ChartTooltip info={hover} />}
    </div>
  )
}

function ChartTooltip({ info }: { info: HoverInfo }) {
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 rounded border border-border bg-panel/95 px-2.5 py-2 font-mono text-[11px] tabular-nums text-text-secondary shadow-lg">
      <div className="mb-1 text-text-primary">
        O {formatNumber(info.open, 2)} H {formatNumber(info.high, 2)} L {formatNumber(info.low, 2)} C {formatNumber(info.close, 2)}
      </div>
      <div className={info.haColor === 'green' ? 'text-bullish' : 'text-bearish'}>
        HA {formatNumber(info.haOpen, 2)} / {formatNumber(info.haHigh, 2)} / {formatNumber(info.haLow, 2)} / {formatNumber(info.haClose, 2)} ·{' '}
        {info.haColor.toUpperCase()} · streak {info.streak}
      </div>
      <div>RSI {Number.isNaN(info.rsi) ? '—' : formatNumber(info.rsi, 2)}</div>
    </div>
  )
}
