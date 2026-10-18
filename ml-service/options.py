"""
Are some calls cheap? A forward record.

Index options cost more than the swings they insure: since 1990 VIX has run
4.1 volatility points above the S&P 500's next-month realised volatility,
on 85% of days (measured 2026-10-18). Buyers on average lose. Goyal &
Saretto, "Cross-Section of Option Returns and Volatility" (Journal of
Financial Economics 94, 2009), found the overpricing is uneven across
stocks: options whose implied volatility sits far above the stock's own
past-year volatility do badly, and those whose implied volatility sits
below it do well.

There is no free history of option prices, so this keeps one from now.
Each Friday afternoon, while the market is open, snapshot() saves for every
S&P 500 member two expiries (nearest 30 and 180 days) and five strikes each
(nearest 0.9, 1.0, 1.1, 1.2 and 1.3 times the price): bid, ask, open
interest, the implied volatility of the midpoint (our own Black-Scholes
inversion, no dividends; Yahoo's figure is not documented), and the stock's
past-year and past-quarter volatility. Snapshots go to record/options/ in
git. score() settles every call whose expiry has passed, at its intrinsic
value on the last close, bought at the ask: the price a person would pay.

Small caps are left out: most have no listed options or spreads that eat a
fifth of the price.

Pre-registered, 2026-10-18, for the 30-day at-the-money calls:
- the average call bought at the ask loses money;
- the fifth with the lowest implied-minus-past volatility beats the highest
  fifth by 10 points or more per month;
- the cheapest fifth still does not beat buying the stock outright, after
  the spread. Judged after 26 weekly snapshots have expired.
"""

import asyncio
import math
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

import lab
import scorecard
import tracker

DIR = Path(__file__).parent / "record" / "options"
DAYS = (30, 180)
MONEYNESS = (0.9, 1.0, 1.1, 1.2, 1.3)
RATE = 4                     # Yahoo requests a second
BASE = "https://query2.finance.yahoo.com"


def call_value(s: float, k: float, t: float, r: float, vol: float) -> float:
    if t <= 0 or vol <= 0:
        return max(s - k, 0.0)
    d1 = (math.log(s / k) + (r + vol * vol / 2) * t) / (vol * math.sqrt(t))
    n = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
    return s * n(d1) - k * math.exp(-r * t) * n(d1 - vol * math.sqrt(t))


def implied_vol(price: float, s: float, k: float, t: float, r: float) -> float:
    """The volatility at which call_value equals `price`; NaN outside the
    no-arbitrage range."""
    lo, hi = 1e-4, 5.0
    if not call_value(s, k, t, r, lo) <= price <= call_value(s, k, t, r, hi):
        return float("nan")
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if call_value(s, k, t, r, mid) < price else (lo, mid)
    return (lo + hi) / 2


def members() -> list[str]:
    last = pd.read_csv(scorecard.DATA / "sp500_members.csv").iloc[-1]
    return sorted(t.replace(".", "-") for t in last["tickers"].split(","))


async def _get(client, pace, url, params) -> dict | None:
    for attempt in range(4):
        await pace()
        try:
            r = await client.get(url, params=params)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 404:
                return None
        except (httpx.HTTPError, ValueError):
            pass
        await asyncio.sleep(3 * (attempt + 1))
    return None


def _vol(closes: list[float], n: int) -> float:
    x = np.diff(np.log(np.asarray(closes[-(n + 1):])))
    return float(x.std(ddof=1) * math.sqrt(252)) if len(x) > 20 else float("nan")


async def _one(client, pace, crumb, ticker, now, r) -> list[dict]:
    chart = await _get(client, pace, f"{BASE}/v8/finance/chart/{ticker}", {"range": "1y", "interval": "1d"})
    try:
        closes = [c for c in chart["chart"]["result"][0]["indicators"]["quote"][0]["close"] if c]
    except (TypeError, KeyError, IndexError):
        return []
    first = await _get(client, pace, f"{BASE}/v7/finance/options/{ticker}", {"crumb": crumb})
    try:
        res = first["optionChain"]["result"][0]
    except (TypeError, KeyError, IndexError):
        return []
    spot = res.get("quote", {}).get("regularMarketPrice")
    if not spot or not res.get("expirationDates"):
        return []
    hv1y, hv3m = _vol(closes, 252), _vol(closes, 63)
    expiries = res["expirationDates"]
    rows = []
    for days in DAYS:
        e = min(expiries, key=lambda x: abs(x - now - days * 86400))
        chain = await _get(client, pace, f"{BASE}/v7/finance/options/{ticker}", {"crumb": crumb, "date": e})
        try:
            calls = chain["optionChain"]["result"][0]["options"][0]["calls"]
        except (TypeError, KeyError, IndexError):
            continue
        t = (e - now) / (365 * 86400)
        for m in MONEYNESS:
            c = min(calls, key=lambda x: abs(x["strike"] / spot - m))
            bid, ask = c.get("bid") or 0.0, c.get("ask") or 0.0
            mid = (bid + ask) / 2 if bid and ask else float("nan")
            rows.append({"ticker": ticker, "spot": spot, "target_days": days,
                         "expiry": datetime.fromtimestamp(e, tz=timezone.utc).date().isoformat(),
                         "years": t, "strike": c["strike"], "bid": bid, "ask": ask,
                         "open_interest": c.get("openInterest", 0), "volume": c.get("volume", 0),
                         "iv": implied_vol(mid, spot, c["strike"], t, r) if mid == mid else float("nan"),
                         "hv_1y": hv1y, "hv_3m": hv3m, "rate": r})
    return rows


async def collect(tickers: list[str]) -> pd.DataFrame:
    lock, state = asyncio.Lock(), {"next": 0.0}

    async def pace():
        async with lock:
            now = asyncio.get_running_loop().time()
            if now < state["next"]:
                await asyncio.sleep(state["next"] - now)
            state["next"] = max(now, state["next"]) + 1 / RATE

    now = int(datetime.now(timezone.utc).timestamp())
    async with httpx.AsyncClient(headers=lab.YAHOO_HEADERS, timeout=30, follow_redirects=True) as client:
        crumb = await lab._yahoo_session(client)
        irx = await _get(client, pace, f"{BASE}/v8/finance/chart/^IRX", {"range": "5d", "interval": "1d"})
        r = [c for c in irx["chart"]["result"][0]["indicators"]["quote"][0]["close"] if c][-1] / 100
        sem = asyncio.Semaphore(8)

        async def one(t):
            async with sem:
                return await _one(client, pace, crumb, t, now, r)
        got = await asyncio.gather(*[one(t) for t in tickers])
    df = pd.DataFrame([row for rows in got for row in rows]).drop_duplicates(["ticker", "expiry", "strike"])
    df["taken"] = datetime.now(timezone.utc).isoformat(timespec="minutes")
    return df


def snapshot(save: bool = True) -> Path:
    df = asyncio.run(collect(members()))
    DIR.mkdir(parents=True, exist_ok=True)
    path = DIR / f"{datetime.now().date().isoformat()}.parquet"
    df.to_parquet(path, index=False)
    if save:
        tracker.commit(path)
    return path


def settle(df: pd.DataFrame) -> pd.DataFrame:
    """Expired calls with their payoff at the last close on or before
    expiry, the return bought at the ask, and the stock's own return."""
    today = datetime.now().date().isoformat()
    df = df[(df["expiry"] < today) & (df["ask"] > 0)].copy()
    if df.empty:
        return df
    closes = {}
    for t in df["ticker"].unique():
        try:
            closes[t] = pd.Series(dict(asyncio.run(lab._daily_closes(t, 400))))
        except Exception:
            pass
    end = [closes[t][closes[t].index <= e].iloc[-1] if t in closes and (closes[t].index <= e).any() else np.nan
           for t, e in zip(df["ticker"], df["expiry"])]
    df["end"] = end
    df["call_return"] = np.maximum(df["end"] - df["strike"], 0) / df["ask"] - 1
    df["stock_return"] = df["end"] / df["spot"] - 1
    return df.dropna(subset=["end"])


def score() -> dict:
    """The pre-registered comparison on every expired at-the-money call."""
    snaps = sorted(DIR.glob("*.parquet"))
    if not snaps:
        return {"snapshots": 0}
    df = settle(pd.concat([pd.read_parquet(p) for p in snaps], ignore_index=True))
    out = {"snapshots": len(snaps), "settled": int(len(df))}
    for days in DAYS:
        g = df[(df["target_days"] == days) & ((df["strike"] / df["spot"] - 1).abs() < 0.05)].copy()
        g["gap"] = g["iv"] - g["hv_1y"]
        g = g.dropna(subset=["gap"])
        if len(g) < 50:
            continue
        g["fifth"] = g.groupby("taken")["gap"].rank(pct=True).mul(5).apply(np.ceil)
        by = g.groupby("fifth")[["call_return", "stock_return"]].agg(["mean", "median"])
        out[f"{days}d_at_the_money"] = {
            "calls": int(len(g)), "snapshots_settled": int(g["taken"].nunique()),
            "mean_call": float(g["call_return"].mean()),
            "cheap_minus_dear": float(by.loc[1.0, ("call_return", "mean")] - by.loc[5.0, ("call_return", "mean")]),
            "by_fifth": {int(k): {"call_mean": float(v[("call_return", "mean")]),
                                  "call_median": float(v[("call_return", "median")]),
                                  "stock_mean": float(v[("stock_return", "mean")])} for k, v in by.iterrows()}}
    return out


if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["score"]:
        print(score())
    else:
        print(snapshot())
