import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

/**
 * Two projects:
 *  - `unit`: everything that renders or touches the DOM (jsdom).
 *  - `node`: pure-Node checks — the parity fixture/diff machinery and the
 *    source-scanning architecture invariants — named `*.node.test.ts`.
 *
 * Coverage thresholds are ENFORCED: `npm run test:cov` exits non-zero when
 * any set falls below its floor. Vitest applies a glob's thresholds to the
 * files that glob matches; the top-level `lines` applies to every file, so
 * "everything else" is spelled out as its own glob set below — otherwise a
 * weak folder could hide behind a strong one in the global average.
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Many suites run the REAL pipeline (a ~200-instrument mock market, full scans):
      // 2-8s of pure CPU, no sleeps or waits. Under a loaded machine (coverage, a
      // parallel build) the 5s default failed them on timing, not behaviour. Nothing
      // here waits on wall time, so a generous ceiling cannot hide a hang worth finding
      // sooner; a genuinely hung test still fails, just at 30s.
      testTimeout: 30_000,
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'jsdom',
            setupFiles: ['./vitest.setup.ts'],
            include: ['src/**/*.test.{ts,tsx}'],
            exclude: ['src/**/*.node.test.ts', 'node_modules/**'],
          },
        },
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: ['src/**/*.node.test.ts', 'scripts/**/*.node.test.ts'],
          },
        },
      ],
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'json-summary', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/__tests__/**',
          'src/**/*.test.{ts,tsx}',
          'src/**/*.d.ts',
          'src/main.tsx',
          'src/test-utils/**',
          // Type-only modules: no executable statements to cover.
          'src/store/types.ts',
          'src/vite-env.d.ts',
        ],
        thresholds: {
          lines: 60,
          'src/strategy/**': { lines: 95, branches: 90 },
          'src/analytics/**': { lines: 90, branches: 85 },
          'src/lib/**': { lines: 90 },
          'src/store/**': { lines: 75 },
          'src/data/mock/**': { lines: 70 },
          // "Everything else" — every src/ folder not covered by a glob above.
          'src/{app,components,features,pages,types,data/reference}/**': { lines: 60 },
          'src/data/*.{ts,tsx}': { lines: 60 },
        },
      },
    },
  }),
)
