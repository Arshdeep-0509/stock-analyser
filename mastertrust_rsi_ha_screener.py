"""
Master Trust REST API - RSI + Heikin Ashi Screener
====================================================

Strategy implemented:
    - Timeframe : 5-minute candles
    - BUY  signal : RSI(14) >= 60  AND  the LAST candle is the 2nd consecutive
                    GREEN Heikin-Ashi candle (i.e. a fresh green streak that
                    has just been confirmed by a second green candle)
    - SELL signal : RSI(14) <= 40  AND  the LAST candle is the 2nd consecutive
                    RED Heikin-Ashi candle
    - Filter      : only consider stocks whose last close price >= Rs. 2000

IMPORTANT - READ BEFORE RUNNING
--------------------------------
I confirmed the following directly from Master Trust's public API docs
(tradeapi.mastertrust.co.in):
    - OAuth2 login flow (get_auth_url / exchange_code_for_token)
    - Scrip/symbol search endpoint (/api/v1/search)
    - Contract info endpoint (/api/v1/contract/<exchange>)
    - Order management endpoints (not used here since you only want analysis)

I could NOT find a documented historical-candle or live-quote endpoint on the
public docs page, even though Master Trust's marketing page advertises
"historical market data" and "real-time OHLC feed" as features. That detail
is very likely hidden behind their authenticated developer docs, or only
available after you register for an API key.

=> Before this script will actually work, log in to
   https://tradeapi.mastertrust.co.in/ with your developer account, find the
   section for historical/candle data (or ask their API support team), and
   fill in the REAL endpoint path + params inside `fetch_historical_candles()`
   below. I've left it as a clearly marked placeholder with the shape most
   Indian broker APIs use, so it's a small edit, not a rewrite.

Also confirm the exact string their API expects for a 5-minute interval
(commonly "5minute", "5m", or "5" depending on the broker) and update
CANDLE_INTERVAL accordingly.
"""

import io
import os
import secrets
import time
import zipfile
from datetime import datetime, timedelta
from urllib.parse import quote, urlparse, parse_qs

import numpy as np
import pandas as pd
import requests
from dotenv import load_dotenv

load_dotenv()

# ------------------------------------------------------------------
# CONFIG - loaded from .env (see .env.example for the template)
# ------------------------------------------------------------------
# tradeapi.mastertrust.co.in is just the docs site, not the API host
BASE_URL = os.environ.get(
    "MASTERTRUST_BASE_URL", "https://masterswift-beta.mastertrust.co.in")

# your "App ID" from the developer console
CLIENT_ID = os.environ.get("MASTERTRUST_CLIENT_ID")
# your "App Secret"
CLIENT_SECRET = os.environ.get("MASTERTRUST_CLIENT_SECRET")
# must exactly match what you registered on the dashboard (check trailing slash!)
REDIRECT_URI = os.environ.get("MASTERTRUST_REDIRECT_URI", "http://127.0.0.1")
ACCESS_TOKEN = os.environ.get("MASTERTRUST_ACCESS_TOKEN")  # from --login

# TODO: confirm the exact value Master Trust expects
CANDLE_INTERVAL = "5minute"
MIN_PRICE = 2000.0
RSI_PERIOD = 14
RSI_BUY_LOW = 60
RSI_BUY_HIGH = 65
RSI_SELL_LOW = 35
RSI_SELL_HIGH = 40
SCAN_EVERY_SECONDS = 300                    # re-scan every 5 minutes

HEADERS = {"Authorization": f"Bearer {ACCESS_TOKEN}"}


# ------------------------------------------------------------------
# Small helper: retry on rate-limit / transient errors
# ------------------------------------------------------------------
def api_get(url, params=None, headers=None, max_retries=3, backoff=2):
    for attempt in range(1, max_retries + 1):
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        if resp.status_code == 429:
            wait = backoff ** attempt
            print(f"[rate-limited] {url} - retrying in {wait}s")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp
    raise RuntimeError(
        f"Gave up on {url} after {max_retries} retries (rate limited)")


# ------------------------------------------------------------------
# AUTH  (confirmed from docs)
# ------------------------------------------------------------------
def get_auth_url(client_id=CLIENT_ID, redirect_uri=REDIRECT_URI):
    """Open this URL in a browser once, log in with your trading credentials +
    2FA, and copy the 'code' param Master Trust redirects you back with."""
    state = secrets.token_urlsafe(
        16)  # must be >= 8 chars or Master Trust rejects with invalid_state
    return (
        f"{BASE_URL}/oauth2/auth?scope=orders%20holdings&state={state}"
        f"&client_id={client_id}&redirect_uri={quote(redirect_uri, safe='')}&response_type=code"
    )


def exchange_code_for_token(code, client_id=CLIENT_ID, client_secret=CLIENT_SECRET, redirect_uri=REDIRECT_URI):
    resp = requests.post(
        f"{BASE_URL}/oauth2/token",
        data={
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
        # server requires client_secret_basic, not client_secret_post
        auth=(client_id, client_secret),
        timeout=10,
    )
    if not resp.ok:
        print(
            f"\n[token exchange failed] HTTP {resp.status_code}: {resp.text}\n")
    resp.raise_for_status()
    return resp.json()  # contains access_token - copy it into ACCESS_TOKEN above


def run_one_time_login():
    """
    Run this ONCE (separately, before running the scanner) to get your
    access token:

        python3 mastertrust_rsi_ha_screener.py --login

    It prints a URL - open it in your browser, log in, and after login your
    browser will try to redirect to http://127.0.0.1/?code=XXXX... and likely
    show a "site can't be reached" page. That's fine - just copy the 'code='
    value from the browser's address bar and paste it here when prompted.
    """
    url = get_auth_url()
    print("\n1) Open this URL in your browser and log in:\n")
    print(url)
    print("\n2) After login, copy the 'code' value (or the whole redirected URL) from the address bar.")
    pasted = input("\n3) Paste it here: ").strip()

    if pasted.startswith("http"):
        code = parse_qs(urlparse(pasted).query).get("code", [""])[0]
        if not code:
            raise SystemExit(
                "Could not find a 'code' parameter in that URL - did the login fail?")
    else:
        code = pasted

    token_data = exchange_code_for_token(code)
    print("\nSuccess! Your access token is:\n")
    print(token_data.get("access_token"))
    print("\nCopy this into MASTERTRUST_ACCESS_TOKEN in your .env file, then run the script normally.")
    return token_data


# ------------------------------------------------------------------
# SCRIP LOOKUP  (confirmed from docs)
# ------------------------------------------------------------------
def search_symbol(keyword):
    resp = api_get(f"{BASE_URL}/api/v1/search",
                   params={"key": keyword}, headers=HEADERS)
    return resp.json()


def get_token_for_symbol(symbol, exchange="NSE"):
    """Look up the instrument token Master Trust uses internally for a symbol.
    Real response shape: {"error": {...}, "result": [{"exchange", "trading_symbol", "token", ...}]}."""
    results = search_symbol(symbol)
    for item in results.get("result", []):
        if item.get("exchange") == exchange and symbol.upper() in item.get("trading_symbol", "").upper():
            return item.get("token")
    return None


# ------------------------------------------------------------------
# HISTORICAL CANDLES  (confirmed from Master Trust IT support)
# ------------------------------------------------------------------
def fetch_historical_candles(token, exchange="NSE", interval=CANDLE_INTERVAL, days_back=5):
    """
    Returns a pandas DataFrame with columns:
    ['datetime', 'open', 'high', 'low', 'close', 'volume'], oldest row first.

    Uses /api/v1/charts/tdv - candletype=1 is a regular time-based candle,
    data_duration is the candle size in minutes (so "5minute" -> 5).
    """
    duration_minutes = int("".join(filter(str.isdigit, interval)))
    to_date = datetime.now()
    from_date = to_date - timedelta(days=days_back)

    params = {
        "token": token,
        "exchange": exchange,
        "starttime": int(from_date.timestamp()),
        "endtime": int(to_date.timestamp()),
        "candletype": 1,
        "data_duration": duration_minutes,
    }
    resp = api_get(f"{BASE_URL}/api/v1/charts/tdv",
                   params=params, headers=HEADERS)
    data = resp.json()

    candles = data["data"]["candles"]
    df = pd.DataFrame(candles, columns=[
                      "datetime", "open", "high", "low", "close", "volume"])
    df["datetime"] = pd.to_datetime(df["datetime"])
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col])
    df = df.sort_values("datetime").reset_index(drop=True)

    # The API includes the still-forming current candle as the last row -
    # drop it so RSI/HA/signals are only ever computed on a closed candle.
    now = pd.Timestamp.now(tz=df["datetime"].dt.tz)
    candle_end = df["datetime"] + pd.Timedelta(minutes=duration_minutes)
    return df[candle_end <= now].reset_index(drop=True)


# ------------------------------------------------------------------
# INDICATORS
# ------------------------------------------------------------------
def compute_rsi(df, period=RSI_PERIOD):
    delta = df["close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()
    rs = avg_gain / avg_loss
    df["rsi"] = 100 - (100 / (1 + rs))
    return df


def compute_heikin_ashi(df):
    ha_close = (df["open"] + df["high"] + df["low"] + df["close"]) / 4
    ha_open = pd.Series(index=df.index, dtype=float)
    ha_open.iloc[0] = (df["open"].iloc[0] + df["close"].iloc[0]) / 2

    for i in range(1, len(df)):
        ha_open.iloc[i] = (ha_open.iloc[i - 1] + ha_close.iloc[i - 1]) / 2

    ha_high = pd.concat([df["high"], ha_open, ha_close], axis=1).max(axis=1)
    ha_low = pd.concat([df["low"], ha_open, ha_close], axis=1).min(axis=1)
    ha_color = np.where(ha_close >= ha_open, "green", "red")

    df["ha_open"] = ha_open
    df["ha_close"] = ha_close
    df["ha_high"] = ha_high
    df["ha_low"] = ha_low
    df["ha_color"] = ha_color
    return df


def ha_streak_length(df, idx):
    """How many consecutive candles (ending at idx) share the same HA color."""
    color = df["ha_color"].iloc[idx]
    streak = 1
    i = idx - 1
    while i >= 0 and df["ha_color"].iloc[i] == color:
        streak += 1
        i -= 1
    return streak, color


# ------------------------------------------------------------------
# SIGNAL LOGIC
# ------------------------------------------------------------------
def check_signal(df):
    """
    df must already have 'rsi' and 'ha_color' columns, sorted oldest -> newest.
    Returns 'BUY', 'SELL', or None for the LAST completed candle.

    "2nd candle" is interpreted as: the color just flipped and this is the
    SECOND candle confirming the new color (streak length == 2) - not just
    any two candles in a row inside a longer streak. Adjust ha_streak_length
    usage below if you meant something different.
    """
    if len(df) < 3 or pd.isna(df["rsi"].iloc[-1]):
        return None

    last = df.iloc[-1]
    if last["close"] < MIN_PRICE:
        return None

    streak, color = ha_streak_length(df, len(df) - 1)
    is_2nd_candle = streak == 2

    if RSI_BUY_LOW <= last["rsi"] <= RSI_BUY_HIGH and is_2nd_candle and color == "green":
        return "BUY"
    if RSI_SELL_LOW <= last["rsi"] <= RSI_SELL_HIGH and is_2nd_candle and color == "red":
        return "SELL"
    return None


# ------------------------------------------------------------------
# FULL NSE EQUITY UNIVERSE  (confirmed from Master Trust IT support)
# ------------------------------------------------------------------
def load_nse_equity_universe(min_price=MIN_PRICE):
    """Download Master Trust's full instrument master (Compact.zip ->
    CompactScrip.csv) and return [(symbol, token), ...] for every NSE equity
    stock whose LAST CLOSE IN THAT FILE is >= min_price.

    This file's close_price is a cached snapshot, not live - it's only used
    to build a manageable scan universe. The real, live price/RSI/HA check
    still happens per-symbol in check_signal() on every scan.
    """
    resp = api_get(f"{BASE_URL}/api/v1/contract/Compact",
                    params={"info": "download"}, headers=HEADERS)
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        with zf.open("CompactScrip.csv") as f:
            df = pd.read_csv(f, low_memory=False)

    df = df[(df["exchange"] == "NSE") & (df["instrument_name"] == "EQ")].copy()
    df["close_price"] = pd.to_numeric(df["close_price"], errors="coerce")
    df = df[df["close_price"] >= min_price]
    return list(df[["trading_symbol", "exchange_token"]].itertuples(index=False, name=None))


# ------------------------------------------------------------------
# SCANNER
# ------------------------------------------------------------------
def scan_watchlist(watchlist):
    """watchlist: list of (symbol, token) tuples - see load_nse_equity_universe()."""
    signals = []
    for symbol, token in watchlist:
        try:
            df = fetch_historical_candles(token)
            df = compute_rsi(df)
            df = compute_heikin_ashi(df)
            signal = check_signal(df)

            if signal:
                last = df.iloc[-1]
                signals.append(
                    {
                        "symbol": symbol,
                        "signal": signal,
                        "price": last["close"],
                        "rsi": round(last["rsi"], 2),
                        "time": last["datetime"],
                    }
                )
        except Exception as e:
            print(f"[error] {symbol}: {e}")
    return signals


if __name__ == "__main__":
    import sys

    if "--login" in sys.argv:
        run_one_time_login()
        sys.exit(0)

    if not ACCESS_TOKEN:
        print("MASTERTRUST_ACCESS_TOKEN is not set in .env yet. Run this first:\n")
        print("    python3 mastertrust_rsi_ha_screener.py --login\n")
        sys.exit(1)

    print("Downloading NSE equity instrument master...")
    universe = load_nse_equity_universe()
    print(f"Scanning {len(universe)} NSE stocks priced >= Rs.{MIN_PRICE:.0f} "
          f"every {SCAN_EVERY_SECONDS}s. Ctrl+C to stop.")
    while True:
        results = scan_watchlist(universe)
        if not results:
            print(f"{datetime.now()}  no signals")
        for r in results:
            print(
                f"{r['time']}  {r['symbol']:10s}  {r['signal']:4s}  "
                f"price={r['price']:.2f}  rsi={r['rsi']}"
            )
        time.sleep(SCAN_EVERY_SECONDS)
