import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    // A full replace (not `extend`), so these six are the ONLY breakpoints
    // in the app — defined once here, used everywhere via sm:/md:/lg:/xl:/2xl:
    // prefixes (Tailwind auto-generates the matching max-sm:/max-md:/...
    // variants from this same object). "xs" has no prefix of its own: it's
    // simply the unprefixed/base styles, since Tailwind is mobile-first and
    // anything below `sm` is already the default with no override.
    screens: {
      sm: '480px', // large phone / small tablet portrait
      md: '768px', // tablet portrait
      lg: '1024px', // tablet landscape / small laptop
      xl: '1280px', // desktop
      '2xl': '1536px', // wide desktop
    },
    extend: {
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
        'bullish-text': 'rgb(var(--color-bullish-text) / <alpha-value>)',
        'bearish-text': 'rgb(var(--color-bearish-text) / <alpha-value>)',
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
