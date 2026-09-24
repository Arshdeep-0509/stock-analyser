# Sector & index reference data

## The gap

`mastertrust_rsi_ha_screener.py` reads exactly these columns from
`CompactScrip.csv` (STRATEGY-CONTRACT.md §3.3):

`exchange`, `instrument_name`, `trading_symbol`, `exchange_token`,
`close_price`, `expiry`, `company_name`, `strike`, `option_type`.

There is **no sector column and no index-membership column**. Nothing the
Master Trust contract gives us, and nothing `src/strategy/universe.ts`
produces from it, can tell you that HDFCBANK is a "Bank" or that it belongs
to BANK NIFTY. The dashboard screenshots group instruments by sector and show
per-index panels, so that grouping has to come from a second, independently
maintained dataset — it cannot be derived from the strategy engine's output.

This directory (`src/data/reference/`) is that dataset, kept deliberately
separate from `src/strategy/` (PARITY-LOCKED, 1:1 with the Python) and from
`src/data/mock/` (deterministic seeded generation). It is hand-authored, not
computed, and it does not pretend to be anything else.

## What's here

- **`sectors.ts`** — `SECTORS` (the fixed 30-name vocabulary from the
  screenshots) and `SYMBOL_SECTOR`, a `Record<string, Sector>` covering every
  base symbol in `src/data/mock/nseSymbols.ts` (`NSE_SYMBOLS` — the seed
  identity list the mock scrip master draws from). Anything not explicitly
  listed falls back to `'Others'`, and `SYMBOL_SECTOR_FALLBACKS` records which
  symbols that happened to, with a dev-console line reporting the count so a
  silent gap can't hide. Today that count is 0 — every symbol in
  `NSE_SYMBOLS` has an explicit entry.
- **`indices.ts`** — `INDEX_PANELS`, the 12 dashboard cards (NIFTY 50, BANK
  NIFTY, METAL, PHARMA, PSU BANK, PVT BANK, AUTO, FINANCIAL, FMCG, IT, REALTY,
  OTHERS) in display order, each with a `constituents: string[]` over base
  symbols. Membership is many-to-many by design (e.g. HDFCBANK is in both
  BANK NIFTY and FINANCIAL) — an instrument never carries a single "index"
  field. `OTHERS` is computed, not listed: every base symbol in
  `NSE_SYMBOLS` not already a constituent of one of the other 11 panels.
- **`src/analytics/enrich.ts`** — `enrichInstrument()`, which decorates an
  `Instrument` (as produced by the parity-locked loaders in
  `src/strategy/universe.ts`) with `.sector` after the fact, by looking up
  its `companyName` (the scrip master always sets `company_name` to the base
  symbol, for EQ/FUTSTK/OPTSTK rows alike) in `SYMBOL_SECTOR`. The universe
  loaders themselves are untouched.

## Known approximations

The sector vocabulary is fixed (it's exactly what the screenshots show), but
it doesn't have a bucket for every real NSE sector. Where nothing fit
cleanly, the mapping either used the closest available bucket or fell back to
`Others`:

- Hospitals (APOLLOHOSP, MAXHEALTH, FORTIS), hotels (INDHOTEL, LEMONTREE) →
  `Others` (no healthcare-services or hospitality bucket exists).
- Aviation/rail travel (INDIGO, IRCTC), ports/logistics (ADANIPORTS, CONCOR)
  → `Logistics`, the closest existing bucket.
- Internet/e-commerce platforms including fintech and job-search
  (ZOMATO, NYKAA, PAYTM, POLICYBZR, NAUKRI, DMART) → `E-commerce`.
- Footwear and apparel retailers/manufacturers (TRENT, PAGEIND, BATAINDIA,
  RELAXO) → `Readymade Garments`, the closest existing bucket.
- Telecom carriers and tower infrastructure (BHARTIARTL, IDEA, INDUSTOWER) →
  `Telecomm Equipment`, the only telecom-adjacent bucket in the vocabulary.
- `Edible Oil` and a few other declared sectors currently have zero
  constituents — no symbol in `NSE_SYMBOLS` fits them. That's expected: the
  30-name vocabulary is fixed independently of which ~180 large/mid-cap names
  happen to be in the mock universe.

None of this is asserted as real-world GICS/NSE classification — it's a
best-effort mapping sized for a 180-symbol mock universe and a fixed,
screenshot-derived vocabulary.

`INDEX_PANELS.OTHERS` has the same kind of caveat: real F&O eligibility is
decided per-seed at scrip-master generation time
(`src/data/mock/scripMaster.ts` randomly picks which base symbols get
futures/options on every `generateUniverse()` call), so there is no static
list of "the F&O underlyings" to compute OTHERS from. `indices.ts` uses the
full `NSE_SYMBOLS` base-symbol list as a stand-in universe instead. This is a
reference/classification concern (which index a symbol *would* belong to),
independent of whether that symbol actually got an F&O contract in any given
generated session.

## What the real backend should do instead

A real deployment should **not** ship a hand-maintained TypeScript file for
this. Two better sources exist once `HttpMarketDataSource`
(docs/BACKEND-HANDOFF.md) is real:

1. **NSE publishes index constituents directly** (e.g. the index factsheets /
   CSV downloads for NIFTY 50, NIFTY BANK, NIFTY IT, sectoral indices, etc.).
   The backend should fetch and cache these rather than hand-list them.
2. **The broker's full contract file has more columns than the screener
   reads.** `mastertrust_rsi_ha_screener.py` only touches 9 of them
   (STRATEGY-CONTRACT.md §3.3); the real `CompactScrip.csv`/contract master
   may carry sector/industry metadata in columns the Python simply never
   asked for. Worth checking before assuming a third-party sector feed is
   needed at all.

Either way, the backend should serve `{ symbol -> sector }` and
`{ indexKey -> constituents[] }` as its own endpoints, and this file's
`SYMBOL_SECTOR` / `INDEX_PANELS` become the mock fixtures a
`MockMarketDataSource`-style implementation of that endpoint returns — not
something the frontend keeps maintaining by hand once real data exists.

## How to regenerate/extend

1. Add the new base symbol to `src/data/mock/nseSymbols.ts` first (it has to
   exist in the mock identity pool before it can appear anywhere else).
2. Add an entry to `EXPLICIT_SYMBOL_SECTOR` in `sectors.ts`. If you skip
   this, the dev console will report it as a fallback to `Others` — that's
   the intended signal to come back and classify it properly.
3. If it belongs to one of the 12 dashboard panels, add it to that panel's
   `constituents` array in `indices.ts`. `OTHERS` needs no manual edit — it
   recomputes automatically.
4. Run `npm test` — `src/data/reference/__tests__/sectors.test.ts` and
   `indices.test.ts` assert every symbol resolves, every panel's
   constituents actually exist, `OTHERS` stays disjoint from the named
   panels, and no panel is empty.
