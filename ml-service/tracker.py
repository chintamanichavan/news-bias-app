"""
The live record — the rules written down each month before anyone knows how
they will do, then scored against SPY as the months arrive.

Every backtest here sees only the companies that still trade and rules
chosen after the fact (proof.py, beyond.py). A record kept forward has
neither flaw: a snapshot names the companies the rules pick that day, with
that day's prices, and a company that later fails or is bought stays in the
record at its last price.

Each snapshot keeps every S&P 500 member's evidence groups (evidence.py)
and two lists:
- good_all_three: a good group for buybacks, profitability and momentum
  (beat the market in more than 70% of ten-year windows since 1963);
- buyback_profitable: buys back or holds its share count, and sits in a
  good profitability group — the low-turnover version.

A list is held equal-weighted from its snapshot to the next, dividends in,
and compared with SPY and with every member snapshotted (the control).

Run monthly (ops/artha-tracker.timer): refresh prices, snapshot, and commit
the snapshot, so git's history shows when each was written and that none
changed after.
"""

import asyncio
import json
import subprocess
import time
from pathlib import Path

import duckdb
import httpx
import numpy as np
import pandas as pd

import evidence
import pit
import pit_ingest
import pricer
import scorecard

DIR = Path(__file__).parent / "record"     # tracked in git, unlike data/
LISTS = ("good_all_three", "buyback_profitable", "control")


def good(group: dict | None) -> bool:
    return group is not None and group["won_10y"] > 0.7


def lists(groups: dict[str, dict]) -> dict[str, list[str]]:
    """The rule lists from one day's evidence groups."""
    return {
        "good_all_three": sorted(t for t, g in groups.items()
                                 if all(good(g.get(k)) for k in ("issuance", "profitability", "momentum"))),
        "buyback_profitable": sorted(t for t, g in groups.items()
                                     if good(g.get("issuance")) and good(g.get("profitability"))),
        "control": sorted(groups),
    }


def refresh_prices(symbols: list[str]) -> int:
    """Full histories with splits and dividends: after a split only a full
    download keeps a series in one set of units."""
    async def go():
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            return await pit_ingest.ingest_history(symbols, client, chunk=150)
    return asyncio.run(go())


def snapshot(as_of: str | None = None) -> dict:
    """Write today's lists, with each member's price on the day."""
    day = as_of or time.strftime("%Y-%m-%d")
    tickers = [c["ticker"] for c in scorecard.cards(day)]
    groups = evidence.company_groups(day, tickers)
    values = pricer.market_values(day, tickers + ["SPY"])
    priced = {t: v["price"] for t, v in values.items()}
    price_date = max(v["date"] for v in values.values())
    snap = {"date": day, "price_date": price_date, "taken_at": time.strftime("%Y-%m-%d %H:%M"),
            "lists": lists({t: g for t, g in groups.items() if t in priced}),
            "groups": {t: {k: g["label"] for k, g in gs.items()} for t, gs in groups.items()}}
    DIR.mkdir(parents=True, exist_ok=True)
    path = DIR / f"{day}.json"
    if path.exists():
        raise FileExistsError(f"{path} exists: a snapshot is never rewritten")
    path.write_text(json.dumps(snap, indent=1))
    return snap


def commit(path: Path) -> None:
    """Commit this one file, leaving anything else staged as it is."""
    subprocess.run(["git", "add", "--", path.name], cwd=path.parent, check=True)
    subprocess.run(["git", "commit", "-m", f"Live record: snapshot {path.stem}", "--", path.name],
                   cwd=path.parent, check=True)


def snapshots() -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted(DIR.glob("*.json"))]


def period_returns(tickers: list[str], start: str, end: str) -> dict[str, float]:
    """Each name's return from its last close on or before `start` to its last
    close on or before `end`, dividends paid between added in. A name that
    stopped trading keeps its last price."""
    conn = duckdb.connect()
    for table in ("prices_eod", "corporate_actions"):
        pricer._store(conn, table)
    marks = ",".join("?" * len(tickers))
    px = conn.execute(f"""
        SELECT symbol, date, close FROM (
          SELECT symbol, date, close, ROW_NUMBER() OVER (
            PARTITION BY symbol, date ORDER BY ingested_at DESC) rn
          FROM prices_eod WHERE symbol IN ({marks}) AND date <= CAST(? AS DATE))
        WHERE rn = 1 ORDER BY symbol, date""", [*tickers, end]).df()
    divs = conn.execute(f"""
        SELECT symbol, sum(value) AS d FROM (
          SELECT symbol, date, value, ROW_NUMBER() OVER (
            PARTITION BY symbol, date ORDER BY ingested_at DESC) rn
          FROM corporate_actions WHERE kind = 'dividend' AND symbol IN ({marks})
            AND date > CAST(? AS DATE) AND date <= CAST(? AS DATE))
        WHERE rn = 1 GROUP BY 1""", [*tickers, start, end]).df().set_index("symbol")["d"]
    out = {}
    for sym, rows in px.groupby("symbol"):
        before = rows[rows["date"] <= pd.Timestamp(start)]
        if before.empty:
            continue
        p0, p1 = before["close"].iloc[-1], rows["close"].iloc[-1]
        out[sym] = float((p1 + divs.get(sym, 0.0)) / p0 - 1)
    return out


def record(latest: str | None = None) -> dict:
    """Each list's return over every period since the first snapshot."""
    snaps = snapshots()
    if not snaps:
        return {"periods": [], "lists": {}}
    if latest is None:
        conn = duckdb.connect()
        pricer._store(conn, "prices_eod")
        latest = str(conn.execute("SELECT max(date) FROM prices_eod WHERE symbol = 'SPY'").fetchone()[0])[:10]
    periods = []
    for i, s in enumerate(snaps):
        start = s["price_date"]
        end = snaps[i + 1]["price_date"] if i + 1 < len(snaps) else latest
        if end <= start:
            continue
        names = sorted(set(s["lists"]["control"]) | {"SPY"})
        r = period_returns(names, start, end)
        row = {"snapshot": s["date"], "start": start, "end": end, "spy": r.get("SPY")}
        for k in LISTS:
            got = [r[t] for t in s["lists"][k] if t in r]
            row[k] = float(np.mean(got)) if got else None
            row[f"n_{k}"] = len(s["lists"][k])
        periods.append(row)
    total = {k: float(np.prod([1 + p[k] for p in periods if p[k] is not None]) - 1)
             for k in (*LISTS, "spy")}
    return {"since": snaps[0]["date"], "through": latest, "periods": periods, "total": total,
            "current": snaps[-1]["lists"], "snapshots": len(snaps)}


if __name__ == "__main__":
    members = [c["ticker"] for c in scorecard.cards(time.strftime("%Y-%m-%d"))]
    print(f"[tracker] refreshing {len(members) + 1} price histories", flush=True)
    refresh_prices(members + ["SPY"])
    snap = snapshot()
    commit(DIR / f"{snap['date']}.json")
    print(json.dumps({k: len(v) for k, v in snap["lists"].items()}), flush=True)
    print(json.dumps(record()["total"]), flush=True)
