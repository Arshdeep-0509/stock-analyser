"""
Parity check for the TypeScript port of compute_rsi() / compute_heikin_ashi()
in frontend/src/strategy/indicators.ts.

Runs the ORIGINAL mastertrust_rsi_ha_screener.py functions (imported, not
copied or modified) against the same fixture the Vitest suite uses
(frontend/src/strategy/__tests__/fixtures/candles-60.json) and prints the
resulting rsi / ha_open / ha_close / ha_color arrays, rounded to 8 decimal
places, so they can be diffed by hand against
frontend/src/strategy/__tests__/__snapshots__/indicators.test.ts.snap.

Usage:
    python scripts/parity_check.py
"""

import json
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_PATH = REPO_ROOT / "frontend" / "src" / "strategy" / "__tests__" / "fixtures" / "candles-60.json"

# Import the ORIGINAL screener's indicator functions rather than copying
# them, so this check can never silently drift from the real source.
sys.path.insert(0, str(REPO_ROOT))
from mastertrust_rsi_ha_screener import compute_rsi, compute_heikin_ashi  # noqa: E402


def load_fixture(path: Path) -> pd.DataFrame:
    with open(path) as f:
        candles = json.load(f)
    df = pd.DataFrame(candles)
    # compute_rsi/compute_heikin_ashi only ever touch open/high/low/close;
    # "datetime" is carried along for parity with the real column set but is
    # not required by either function.
    df["datetime"] = pd.to_datetime(df["time"], unit="s")
    return df[["datetime", "open", "high", "low", "close", "volume"]]


def round8(values) -> list:
    return [None if pd.isna(v) else round(float(v), 8) for v in values]


def main() -> None:
    df = load_fixture(FIXTURE_PATH)

    # Same call order as scan_watchlist(): rsi first, then heikin ashi.
    df = compute_rsi(df)
    df = compute_heikin_ashi(df)

    print(f"Loaded {len(df)} candles from {FIXTURE_PATH.relative_to(REPO_ROOT)}\n")

    print("rsi (8dp, None == NaN):")
    print(json.dumps(round8(df["rsi"]), indent=2))

    print("\nha_open (8dp):")
    print(json.dumps(round8(df["ha_open"]), indent=2))

    print("\nha_close (8dp):")
    print(json.dumps(round8(df["ha_close"]), indent=2))

    print("\nha_color:")
    print(json.dumps(list(df["ha_color"]), indent=2))


if __name__ == "__main__":
    main()
