"""
Does waiting for a fall pay?

The replay (replay.py) found that the return rule's picks cluster after
market falls. This asks the plain question behind that: with the same money
arriving every month, does holding it back for a fall end up ahead of simply
investing it as it arrives?

The market here is the S&P 500 total-return index, month-end, from 1988 —
used as a yardstick for "stocks in general", nothing more. Cash waiting earns
the federal funds rate. Every window of a given length is tested, one starting
each month, so the answer does not hang on one lucky start date.
"""

import asyncio
import json
import statistics
from datetime import datetime, timezone

import httpx
import pandas as pd

import monitor
import pit
import pit_ingest

INDEX = "^SP500TR"
INDEX_START = "1988-01-01"
MONTHLY = 1000.0
WINDOW_YEARS = (10, 20)
FALLS = (10, 20, 30)            # % below the index's high that counts as a fall
RESULT_PATH = pit.PIT_ROOT.parent / "timing.json"

CAVEATS = [
    "The yardstick is the S&P 500 total-return index, not your own stocks.",
    "Windows that start a month apart share almost all their months. The history holds "
    "four large falls (2000, 2008, 2020, 2022), so this is a handful of real tests.",
    "No costs or taxes. Cash earns the federal funds rate.",
]


async def ingest_index() -> int:
    """Store the index's full history in the PIT store."""
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        res = await pit_ingest._yahoo_chart(INDEX, client, span=None, start=INDEX_START)
    df = pit_ingest.parse_eod(INDEX, res)
    pit.write_snapshot("prices_eod", df)
    return len(df)


def load() -> tuple[list[str], list[float], list[float]]:
    """Month-ends as (labels, index level, cash return earned over the month)."""
    conn = pit.connect()
    now = datetime.now(timezone.utc).isoformat()
    px = pit.prices_asof(conn, now, symbols=[INDEX])
    level = px.set_index("date")["close"].resample("ME").last().dropna()
    rate = conn.execute("""
        SELECT date, value FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY date ORDER BY ingested_at DESC) AS rn
          FROM macro WHERE series = 'FEDFUNDS') WHERE rn = 1 ORDER BY date""").df()
    yearly_pct = rate.set_index("date")["value"].resample("ME").last().reindex(level.index).ffill().bfill()
    return ([d.strftime("%Y-%m") for d in level.index], level.tolist(),
            (yearly_pct / 100 / 12).tolist())


def end_value(level: list[float], cash_return: list[float], fall: float | None,
              hold_back: float, monthly: float = MONTHLY, high: float = 0.0) -> tuple[float, float]:
    """Invest `monthly` at each month-end but the last, and value it all at the
    last. `hold_back` is the share of each payment kept in cash until the index
    stands `fall` % or more below its high (`high` carries the high reached
    before the window). Returns (end value, cash still uninvested)."""
    units = cash = 0.0
    for t in range(len(level) - 1):
        high = max(high, level[t])
        cash += monthly * hold_back
        units += monthly * (1 - hold_back) / level[t]
        if fall is not None and level[t] <= high * (1 - fall / 100):
            units += cash / level[t]
            cash = 0.0
        cash *= 1 + cash_return[t + 1]
    return units * level[-1] + cash, cash


def strategies() -> list[dict]:
    out = [{"key": "steady", "label": "Invest every month as it arrives", "fall": None, "hold_back": 0.0}]
    for fall in FALLS:
        out.append({"key": f"wait_{fall}", "fall": fall, "hold_back": 1.0,
                    "label": f"Hold everything until the market is {fall}% below its high"})
    for fall in FALLS:
        out.append({"key": f"half_{fall}", "fall": fall, "hold_back": 0.5,
                    "label": f"Invest half; hold half for a {fall}% fall"})
    return out


def compare(labels: list[str], level: list[float], cash_return: list[float], years: int) -> dict:
    """Every strategy over every `years`-long window, set against steady."""
    months = years * 12
    plans = strategies()
    ends: dict[str, list[float]] = {p["key"]: [] for p in plans}
    idle: dict[str, int] = {p["key"]: 0 for p in plans}
    highs = [0.0]
    for x in level:
        highs.append(max(highs[-1], x))
    starts = range(0, len(level) - months)
    for s in starts:
        for p in plans:
            value, cash = end_value(level[s:s + months + 1], cash_return[s:s + months + 1],
                                    p["fall"], p["hold_back"], high=highs[s])
            ends[p["key"]].append(value)
            idle[p["key"]] += cash > 0.25 * value
    steady = ends["steady"]
    rows = []
    for p in plans:
        ratios = [v / b for v, b in zip(ends[p["key"]], steady)]
        rows.append({
            "key": p["key"], "label": p["label"],
            "median_end": round(statistics.median(ends[p["key"]])),
            "worst_end": round(min(ends[p["key"]])),
            "best_end": round(max(ends[p["key"]])),
            "beat_steady_pct": round(100 * sum(r > 1 for r in ratios) / len(ratios), 1),
            "median_vs_steady_pct": round((statistics.median(ratios) - 1) * 100, 1) + 0.0,
            "worst_vs_steady_pct": round((min(ratios) - 1) * 100, 1),
            "best_vs_steady_pct": round((max(ratios) - 1) * 100, 1),
            "mostly_cash_at_end_pct": round(100 * idle[p["key"]] / len(ratios), 1),
        })
    return {"years": years, "windows": len(starts), "paid_in": round(MONTHLY * months),
            "first_start": labels[0], "last_start": labels[len(starts) - 1],
            "strategies": rows}


def verdict(twenty: dict) -> dict:
    steady, rivals = twenty["strategies"][0], twenty["strategies"][1:]
    most_wins = max(r["beat_steady_pct"] for r in rivals)
    typical = [r["median_vs_steady_pct"] for r in rivals]
    pays = any(r["beat_steady_pct"] >= 60 and r["median_vs_steady_pct"] >= 2 for r in rivals)
    return {
        "waiting_pays": pays,
        "headline": ("Waiting for a fall came out ahead more often than not."
                     if pays else
                     "Waiting for a fall did not pay. Investing every month came out ahead."),
        "detail": (f"Over {twenty['windows']} twenty-year periods, ${MONTHLY:,.0f} a month invested as it "
                   f"arrived ended at a median ${steady['median_end']:,}. No waiting plan beat that in more "
                   f"than {most_wins}% of periods. The typical waiting plan ended between "
                   f"{abs(max(typical))}% and {abs(min(typical))}% "
                   f"{'ahead' if max(typical) > 0 else 'behind'}."),
    }


def compute() -> dict:
    labels, level, cash_return = load()
    windows = [compare(labels, level, cash_return, y) for y in WINDOW_YEARS]
    return {
        "ran_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "index": INDEX, "from": labels[0], "to": labels[-1], "monthly": MONTHLY,
        "verdict": verdict(windows[-1]),
        "windows": windows,
        "caveats": CAVEATS,
    }


def run() -> dict:
    """Run the comparison, save the result, log the trial."""
    out = compute()
    RESULT_PATH.write_text(json.dumps(out, indent=1))
    monitor.log_experiment(
        "timing", {"index": INDEX, "from": out["from"], "to": out["to"]},
        {f"{r['key']}_20y": {"beat_steady_pct": r["beat_steady_pct"],
                             "median_vs_steady_pct": r["median_vs_steady_pct"]}
         for r in out["windows"][-1]["strategies"] if r["key"] != "steady"})
    return out


def latest() -> dict | None:
    try:
        return json.loads(RESULT_PATH.read_text())
    except (OSError, ValueError):
        return None


if __name__ == "__main__":
    print(f"index rows stored: {asyncio.run(ingest_index())}")
    result = run()
    print(result["verdict"])
    for w in result["windows"]:
        print(f"\n== {w['years']}-year periods: {w['windows']} of them, {w['first_start']} to {w['last_start']}; paid in ${w['paid_in']:,} ==")
        for r in w["strategies"]:
            print(f"  {r['label']:<58} median ${r['median_end']:>9,}  beat steady {r['beat_steady_pct']:>5}%  "
                  f"typical {r['median_vs_steady_pct']:>6}%  worst {r['worst_vs_steady_pct']:>6}%  best {r['best_vs_steady_pct']:>6}%  "
                  f"mostly cash at end {r['mostly_cash_at_end_pct']}%")
