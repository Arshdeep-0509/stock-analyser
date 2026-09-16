import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      screens: {
        // The single breakpoint this app designs around: table <-> cards,
        // drawer <-> full-screen. Named for what's true ABOVE it (Tailwind
        // breakpoints are min-width/mobile-first).
        desktop: '900px',
      },
      colors: {
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
        border: {
          DEFAULT: 'rgb(var(--color-border) / <alpha-value>)',
          hairline: 'rgb(var(--color-border-hairline) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--color-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted) / <alpha-value>)',
        },
        bullish: 'rgb(var(--color-bullish) / <alpha-value>)',
        bearish: 'rgb(var(--color-bearish) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        neutral: 'rgb(var(--color-neutral) / <alpha-value>)',
      },
      fontFamily: {
        ui: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xs: ['12px', '16px'],
        sm: ['13px', '18px'],
      },
      spacing: {
        px1: '4px',
        px2: '8px',
        px3: '12px',
        px4: '16px',
      },
      height: {
        topbar: '56px',
        rail: '56px',
        statusbar: '28px',
        row: '32px',
      },
      width: {
        rail: '56px',
      },
    },
  },
  plugins: [],
} satisfies Config
