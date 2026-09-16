/**
 * Mirrors the CSS custom properties in index.css / tailwind.config.ts for
 * contexts that need raw JS values (e.g. canvas-based chart theming).
 * Keep these two sources in sync by hand.
 */
export const theme = {
  colors: {
    surface: '#0B0F14',
    panel: '#111820',
    border: '#1E2A36',
    borderHairline: '#17212B',
    textPrimary: '#E6EDF3',
    textSecondary: '#8B9AA8',
    textMuted: '#5A6B7A',
    bullish: '#26A17B',
    bearish: '#E5484D',
    warning: '#E3A008',
    neutral: '#4A90D9',
  },
  font: {
    ui: `'Inter', system-ui, sans-serif`,
    mono: `'JetBrains Mono', ui-monospace, monospace`,
  },
  layout: {
    topbarHeight: 56,
    railWidth: 56,
    statusbarHeight: 28,
    rowHeight: 32,
  },
} as const
