"""
The lose-less screen, live — today's list, kept as a record.

The same rules as the test (loseless.py), applied to what is on file
today: every non-financial filer worth $50M or more by its last public
float with a recent 10-K (winners.filers_on), the smaller half by size,
less the fifth whose latest 10-K was rewritten most, the most-shorted fifth
at the last FINRA settlement, and any company whose 8-Ks in the past year
reported a delisting notice, a restatement or a change of auditor. Only
companies listed on an exchange are kept; the test also held OTC names.

Beside the list, the trend rule (trend.py) read on the Russell 2000 fund
(IWM): small caps above their 10-month average at the last month-end, or
not.

The rule it was tested as: buy the list equal-weighted each 30 June, hold
a year. Fifty of them, drawn at random with the date as the seed, keep
most of that (loseless.holdings) and are listed as "pick". Each month's snapshot goes to record/screen/ and is committed,
never rewritten, so the list builds a record of its own.
"""

import asyncio
import json
from datetime import date
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

import eightk
import filers
import lab
import loseless
import reports
import shorts
import tracker
import winners

DIR = Path(__file__).parent / "record" / "screen"
LISTED = {"Nasdaq", "NYSE", "CBOE"}
PICK = 50             # loseless.holdings(): 50 kept the 1-in-20 worst year near -34%
FUND = "IWM"


def trend(today: date) -> dict:
    """The fund's month-end closes against their 10-month average."""
    r = httpx.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{FUND}",
                  params={"range": "2y", "interval": "1mo"}, headers=lab.YAHOO_HEADERS, timeout=30)
    res = r.json()["chart"]["result"][0]
    closes = pd.Series(res["indicators"]["adjclose"][0]["adjclose"],
                       index=pd.to_datetime(res["timestamp"], unit="s").strftime("%Y-%m")).dropna()
    done = closes[closes.index < today.strftime("%Y-%m")]          # complete months only
    avg = float(done.iloc[-10:].mean())
    return {"fund": FUND, "month_end": done.index[-1], "close": round(float(done.iloc[-1]), 2),
            "average_10m": round(avg, 2), "above": bool(done.iloc[-1] > avg)}


def pick(day: str, symbols: list[str]) -> list[str]:
    """PICK of the kept companies, at random with the date as the seed: the
    same list from the same day's snapshot, every time."""
    rng = np.random.default_rng(int(day.replace("-", "")))
    pool = sorted(symbols)
    return sorted(rng.choice(pool, min(PICK, len(pool)), replace=False).tolist())


def build(today: date | None = None, refresh: bool = True) -> dict:
    today = today or date.today()
    day = today.isoformat()
    if refresh:
        filers.refresh(today)
    info, pts, conn = winners.filers_context()
    df = pd.DataFrame(winners.filers_on(day, info, pts, conn))
    if refresh:
        asyncio.run(reports.update(set(df["symbol"])))
        ciks = {int(s[3:]) for s in set(df["symbol"]) | set(winners.panel_all()["symbol"])}
        eightk.load(ciks, rebuild=True)
    df = reports.attach(df)
    s = shorts.latest(pd.Timestamp(day))
    df = df.merge(shorts.ratios(pd.Timestamp(day), s, shorts.tickers(), pts), on="symbol", how="left")
    filed = len(df)
    df = loseless.flag(eightk.attach(df))
    meta = info[["tickers", "exchanges"]]
    df = df.join(meta, on="symbol")
    df["ticker"] = df["tickers"].fillna("").str.split(",").str[0]
    df["exchange"] = df["exchanges"].fillna("").str.split(",").str[0]
    df["listed"] = df["exchange"].isin(LISTED)
    df["float"] = np.exp(df["log_size"])
    reasons = lambda r: [k for k in ("rewritten", "shorted", "bad_news") if r[k]]
    df["drop"] = df.apply(reasons, axis=1)
    kept = df[(df["drop"].str.len() == 0) & df["listed"]].sort_values("float")
    cols = ["symbol", "ticker", "exchange", "name", "float", "cosine_content", "short_ratio"]
    clean = lambda g: json.loads(g[cols].to_json(orient="records"))
    return {
        "date": day, "rule": "Buy equal-weighted each 30 June, hold a year; tested 2010-2022 (loseless.py).",
        "short_settlement": s["settled"].iloc[0] if len(s) else None,
        "trend": trend(today),
        "counts": {"filers": filed, "small_half": int(len(df)), "rewritten": int(df["rewritten"].sum()),
                   "shorted": int(df["shorted"].sum()), "bad_news": int(df["bad_news"].sum()),
                   "not_listed": int((~df["listed"]).sum()), "kept": int(len(kept))},
        "largest_float": float(df["float"].max()),
        "kept": clean(kept),
        "pick": pick(day, kept["symbol"].tolist()),
        "dropped": [{**r, "why": w} for r, w in zip(clean(df[df["drop"].str.len() > 0]), df[df["drop"].str.len() > 0]["drop"])],
    }


def snapshot(save: bool = True, refresh: bool = True) -> Path:
    out = build(refresh=refresh)
    DIR.mkdir(parents=True, exist_ok=True)
    path = DIR / f"{out['date']}.json"
    path.write_text(json.dumps(out, indent=1))
    if save:
        tracker.commit(path)
    return path


def latest() -> dict | None:
    snaps = sorted(DIR.glob("*.json"))
    if not snaps:
        return None
    out = json.loads(snaps[-1].read_text())
    out.setdefault("pick", pick(out["date"], [c["symbol"] for c in out["kept"]]))   # lists before picks
    return out


if __name__ == "__main__":
    print(snapshot())
