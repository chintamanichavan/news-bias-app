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
        "date": day, "rule": "Buy equal-weighted with each June list, hold a year; tested 2010-2022 with 30 June buys (loseless.py).",
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


def holding(snaps: list[dict], day: str) -> dict:
    """The snapshot whose pick is held on `day`: the latest June list on or
    before it, or the first list before any June."""
    june = [x for x in snaps if x["date"][5:7] == "06" and x["date"] <= day]
    return june[-1] if june else snaps[0]


async def _closes(tickers: list[str], days: int) -> dict[str, pd.Series]:
    async def one(t):
        try:
            return t, pd.Series(dict(await lab._daily_closes(t, days)))
        except Exception:
            return t, None
    return {t: c for t, c in await asyncio.gather(*[one(t) for t in tickers]) if c is not None and len(c)}


def _change(c: pd.Series, a: str, b: str) -> float | None:
    """Close on or before `b` over close on or before `a`. A stock that
    stopped trading keeps its last close: sold there, cash after."""
    x, y = c[c.index <= a], c[c.index <= b]
    return float(y.iloc[-1] / x.iloc[-1] - 1) if len(x) and len(y) else None


def performance(today: date | None = None) -> dict:
    """The plan as lived since the first list: each month from one snapshot
    to the next (or today), the held pick in equal amounts if that
    snapshot's trend read was up, else Treasury bills; against IWM held."""
    snaps = [json.loads(p.read_text()) for p in sorted(DIR.glob("*.json"))]
    if not snaps:
        return {"months": []}
    end = (today or date.today()).isoformat()
    for x in snaps:
        x.setdefault("pick", pick(x["date"], [c["symbol"] for c in x["kept"]]))
    tickers = {c["symbol"]: c["ticker"] for x in snaps for c in x["kept"]}
    held = sorted({tickers[s] for x in snaps for s in holding(snaps, x["date"])["pick"]})
    days = (pd.Timestamp(end) - pd.Timestamp(snaps[0]["date"])).days + 30
    closes = asyncio.run(_closes(held + [FUND, "^IRX"], days))
    months, plan, fund = [], 1.0, 1.0
    for i, x in enumerate(snaps):
        a, b = x["date"], snaps[i + 1]["date"] if i + 1 < len(snaps) else end
        if b <= a:
            continue
        names = [tickers[s] for s in holding(snaps, a)["pick"]]
        if x["trend"]["above"]:
            got = [r for t in names if t in closes and (r := _change(closes[t], a, b)) is not None]
            r = float(np.mean(got)) if got else 0.0
        else:
            irx = closes.get("^IRX")
            rate = float(irx[irx.index <= a].iloc[-1]) / 100 if irx is not None else 0.0
            r = rate * (pd.Timestamp(b) - pd.Timestamp(a)).days / 360
        f = _change(closes[FUND], a, b) if FUND in closes else None
        plan *= 1 + r
        fund *= 1 + (f or 0.0)
        months.append({"from": a, "to": b, "in": x["trend"]["above"], "plan": r, "fund": f})
    return {"since": snaps[0]["date"], "to": end, "plan": plan - 1, "fund": fund - 1, "months": months}


def action(snaps: list[dict]) -> dict:
    """What the plan asks of the holder now, from the last two lists: the
    trend reading then and now, and whether the held pick changed."""
    now = snaps[-1]
    up = now["trend"]["above"]
    if len(snaps) == 1:
        return {"do": "buy" if up else "bills", "why": "first list" + ("" if up else "; trend below its average")}
    before = snaps[-2]
    was_up = before["trend"]["above"]
    new_pick = holding(snaps, now["date"])["date"] != holding(snaps[:-1], before["date"])["date"]
    if up and not was_up:
        return {"do": "buy", "why": "small caps closed back above their 10-month average"}
    if was_up and not up:
        return {"do": "sell", "why": "small caps closed below their 10-month average"}
    if up and new_pick:
        return {"do": "rebuy", "why": "the June pick replaces last year's"}
    return {"do": "hold" if up else "bills", "why": "no change since the last list"}


def latest() -> dict | None:
    paths = sorted(DIR.glob("*.json"))
    if not paths:
        return None
    snaps = [json.loads(p.read_text()) for p in paths]
    for x in snaps:
        x.setdefault("pick", pick(x["date"], [c["symbol"] for c in x["kept"]]))   # lists before picks
    out = snaps[-1]
    out["action"] = action(snaps)
    return out


if __name__ == "__main__":
    print(snapshot())
