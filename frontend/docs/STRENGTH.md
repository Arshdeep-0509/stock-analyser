# Strength

## This is our own metric, not theirs

The reference dashboard (AshishChadha.com) shows a "Strength" column — a
number to one decimal with a colour-coded dot — on every table. Its formula
is proprietary; we do not know it and have made no attempt to reverse-engineer
or guess it. **What follows is our own definition**, designed independently
to serve the same purpose (a quick sense of how remarkable today's move is),
documented in full, and disclosed in-product: every "Strength" column header
carries an info icon (`StrengthInfo`, `src/components/ui/StrengthCell.tsx`)
whose popover ends with the same sentence this document does:

> Our own definition, not the one used by any commercial dashboard.

## The formula

Implementation: [`src/analytics/strength.ts`](../src/analytics/strength.ts).

```
sigmaDaily  = stdev of the last 20 daily log returns          (volatility)
move        = (ltp / prevClose) - 1                           (today's move)
zMove       = |move| / sigmaDaily                             (how unusual)
rvol        = volumeSoFarToday
              / medianVolumeToSameTimeOfDay(last 10 sessions) (participation)
persistence = |Σ barReturn| / Σ|barReturn|   over today's closed 5-min bars
                                                               (0..1, direction efficiency)
Strength    = zMove × sqrt(max(rvol, 0.01)) × (0.5 + 0.5 × persistence)
```

Strength is **unsigned** — it measures conviction/how remarkable a move is,
never its direction. Direction is the separate Intraday arrow shown
alongside it.

## Why each term

- **zMove** normalises a 2% move in a sleepy FMCG name against a 2% move in
  a high-beta metal — the same raw percentage move means very different
  things depending on how much that stock usually moves day to day.
- **sqrt(rvol)** rewards genuine participation (real volume behind the move)
  without letting one freak volume spike dominate the metric — the square
  root compresses the tail, so 4x normal volume only doubles this factor,
  not quadruples it.
- **persistence** separates a clean trend (bar after bar in the same
  direction) from a name that covered the same net distance by chopping
  sideways all day. It's a direction-efficiency ratio in `[0, 1]`, so the
  `(0.5 + 0.5 × persistence)` factor only ever *halves* Strength at worst (a
  maximally choppy day) — it never zeroes a big, unusual, well-participated
  move out entirely just because the tape was choppy.

## Guards (documented behaviour, not bugs)

- **Fewer than 5 sessions of history** (4 completed daily closes plus
  today's in-progress one) → Strength is `NaN`. The UI renders a pale/blank
  dot for this, never a fake `0` — a `0` would claim "we checked and there's
  no conviction," when the truth is "we don't have enough history to check
  at all."
- **`sigmaDaily === 0`** (a perfectly flat price history) → Strength is `0`,
  never `Infinity` or `NaN` from a division by zero.
- **No closed 5-minute bars yet today** → `persistence` defaults to `0`
  (no evidence of directional efficiency either way yet), not `NaN` — zMove
  and rvol can still be meaningful before the first intraday bar closes.
- **No prior-session volume history at the same time of day** → `rvol`
  defaults to `0` rather than dividing by zero.

## Colour bands

The one place these thresholds live: `strengthTone()` in
[`src/analytics/strength.ts`](../src/analytics/strength.ts).

| Range | Tone | Colour |
| --- | --- | --- |
| `>= 1.0` | `high` | green |
| `0.5 – 0.99` | `medium` | orange |
| `0.05 – 0.49` | `low` | yellow |
| `< 0.05` or `NaN` | `none` | pale grey |

These were derived from the reference screenshots: values like 5.3 and 1.1
render green there, 0.9 and 0.6 render orange, 0.4 and 0.1 render yellow, and
a blank cell renders pale. We matched the *bands*, not the underlying
formula that produces the numbers falling into them.

## Explaining a value

`explainStrength()` ([`src/analytics/explainStrength.ts`](../src/analytics/explainStrength.ts))
returns the three multiplied factors behind a Strength value plus a
one-line summary, e.g.:

```
Strength 2.4 = zMove 1.8 × √rvol 1.3 × persistence-factor 1.0
```

It's built directly off the same internal breakdown `computeStrength()`
uses (`computeStrengthBreakdown()`), so the explanation shown on hover/click
can never drift out of sync with the number displayed in the cell.

## Regenerating / verifying

`npm run smoke:strength` runs Strength across the full mock universe at the
default seed and prints the resulting distribution (count per tone band,
min/median/max, and the top few symbols) — the check that the shape looks
like the reference screenshots (one or two standouts in the 3–7 range, a
long tail near zero) rather than a uniform or degenerate distribution.
