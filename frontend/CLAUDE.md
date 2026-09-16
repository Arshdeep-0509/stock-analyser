# RSI-HA Frontend — Hard Rules

These rules apply to this step and every future step in this project. Do not
relax, reinterpret, or forget them as work continues.

```
HARD RULES (apply to this and every future step):
1. Do NOT change, "fix", optimise, or reinterpret any strategy or indicator
   logic from mastertrust_rsi_ha_screener.py. Port behaviour 1:1, including
   its quirks and its edge cases. If you think something is a bug, leave it
   and add a `// PARITY:` comment — do not change it.
2. Frontend only. No server, no real HTTP calls, no API keys, no .env secrets.
3. All mock data must match the REAL response shapes documented in
   STRATEGY-CONTRACT.md. No hardcoded visible values (no fake "RELIANCE +2.3%"
   strings baked into JSX). Every number on screen must come out of the
   strategy engine running on generated candles.
4. TypeScript strict. No `any`. No `@ts-ignore`.
5. Show me the file tree you changed and run `npm run build` + `npm test`
   before you tell me you're done.
```

## Where things live

- The reference strategy implementation is at `../mastertrust_rsi_ha_screener.py`
  (repo root, one level up from this `frontend/` directory).
- [`docs/STRATEGY-CONTRACT.md`](./docs/STRATEGY-CONTRACT.md) documents the
  config constants, the known docstring/code discrepancy, the real upstream
  response shapes, and the behavioural quirks that must survive porting.
  Read it before touching `src/strategy/` or `src/data/`.
- Raw upstream API shapes: `src/types/api.ts`. Normalised app shapes:
  `src/types/domain.ts`.
- The data-source contract (mock and future real implementations must both
  satisfy it) is `src/data/MarketDataSource.ts`. No implementation exists
  yet.
- Strategy/indicator ports belong in `src/strategy/`.
- Mock API and mock WebSocket implementations belong in `src/data/`.
