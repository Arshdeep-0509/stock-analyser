# RSI-HA Screener (frontend prototype)

Frontend-only prototype of a trading screener UI. No backend, no real HTTP
calls — everything runs against mock data generated in the browser.

## Stack

- Vite + React 18 + TypeScript (strict)
- Tailwind CSS v3
- Zustand for state
- react-router-dom
- lightweight-charts
- Vitest + @testing-library/react
- lucide-react

## Run instructions

```bash
npm install     # install dependencies
npm run dev     # start the dev server (http://localhost:5173, opens at /rsi-ha)
npm run build   # type-check (tsc -b) and produce a production build in dist/
npm run preview # preview the production build locally
npm test        # run the Vitest test suite once
npm run test:watch  # run Vitest in watch mode
npm run lint    # run oxlint
```

## Project structure

```
src/
  app/            AppShell, router, providers, theme tokens
  pages/          Route-level pages (RsiHaPage, IntradayPage)
  features/rsi-ha/  Feature-specific components (empty for now)
  strategy/       Ported indicator/signal logic (empty for now)
  data/           Mock API + mock WebSocket layer (empty for now)
  components/ui/  Design-system primitives (Button, Badge, Table, ...)
  lib/            Formatters, cn() classname helper, market-session logic
  types/          Shared TypeScript types (empty for now)
  store/          Zustand stores (empty for now)
```

See [CLAUDE.md](./CLAUDE.md) for the hard rules governing how this project
is built (strategy parity, no real network calls, no hardcoded business
numbers, strict TypeScript).
