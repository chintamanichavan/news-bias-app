"""
Widen the long-term universe: filings for the largest N SEC filers, then a
decade of prices for the ones that have earnings worth valuing.

Filings are cheap to hold and prices are not, so the order matters: pull
fundamentals wide, keep only filers with five or more years of positive
dollar EPS, and fetch prices for those alone. The price list is saved to
data/wide_symbols.json so the nightly ingest keeps it fresh.

    python widen.py --top 3000
"""

import argparse
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pandas as pd

import pit
import pit_ingest

WIDE_PATH = Path(__file__).parent / "data" / "wide_symbols.json"
# tickers already asked for: many foreign filers have no US-GAAP facts, and
# a resumed run should not download them again to learn that twice
TRIED_PATH = Path(__file__).parent / "data" / "wide_tried.json"
MIN_EPS_YEARS = 5


def wide_symbols() -> list[str]:
    try:
        return json.loads(WIDE_PATH.read_text())["symbols"]
    except (OSError, ValueError, KeyError):
        return []


def valuable(f: pd.DataFrame) -> list[str]:
    """Filers the return rule can value: MIN_EPS_YEARS or more annual dollar
    EPS figures, the latest one positive."""
    e = f[(f["tag"] == "EarningsPerShareDiluted") & (f["unit"] == "USD/shares")
          & f["period_start"].notna()].copy()
    e["dur"] = (e["period_end"] - e["period_start"]).dt.days
    e = e[(e["dur"] >= 300) & (e["dur"] <= 400)].sort_values("period_end")
    out = []
    for sym, g in e.groupby("symbol"):
        if g["period_end"].dt.year.nunique() >= MIN_EPS_YEARS and g["value"].iloc[-1] > 0:
            out.append(str(sym))
    return sorted(out)


async def _roster(client: httpx.AsyncClient, top: int) -> list[str]:
    r = await client.get("https://www.sec.gov/files/company_tickers.json")
    r.raise_for_status()
    # the SEC lists filers largest first; one ticker per company
    seen_cik, out = set(), []
    for row in r.json().values():
        t = row["ticker"]
        if row["cik_str"] in seen_cik or not t.replace("-", "").isalpha():
            continue
        seen_cik.add(row["cik_str"])
        out.append(t)
        if len(out) >= top:
            break
    return out


async def _prices(symbols: list[str], client: httpx.AsyncClient, chunk: int = 150) -> int:
    total = 0
    for i in range(0, len(symbols), chunk):
        frames = []
        for sym in symbols[i:i + chunk]:
            for attempt in range(3):
                try:
                    frames.append(await pit_ingest._yahoo_eod(sym, client))
                    break
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 429 and attempt < 2:
                        await asyncio.sleep(20 * (attempt + 1))
                        continue
                    print(f"[widen] prices {sym} skipped: {e!r}")
                    break
                except Exception as e:
                    print(f"[widen] prices {sym} skipped: {e!r}")
                    break
            await asyncio.sleep(0.12)
        if frames:
            batch = pd.concat(frames, ignore_index=True)
            pit.write_snapshot("prices_eod", batch)
            total += len(batch)
            print(f"[widen] prices: {i + len(frames)}/{len(symbols)} symbols", flush=True)
    return total


async def run(top: int = 3000, chunk: int = 250) -> dict:
    now = lambda: datetime.now(timezone.utc).isoformat()  # noqa: E731
    conn = pit.connect()
    have = set(pit.fundamentals_asof(conn, now())["symbol"].dropna().unique())
    async with httpx.AsyncClient(timeout=60, headers=pit_ingest.UA, follow_redirects=True) as client:
        roster = await _roster(client, top)
        try:
            tried = set(json.loads(TRIED_PATH.read_text()))
        except (OSError, ValueError):
            tried = set()
        todo = [s for s in roster if s not in have and s not in tried]
        print(f"[widen] roster {len(roster)}, already held {len(roster) - len(todo)}, fetching {len(todo)}", flush=True)
        facts = 0
        for i in range(0, len(todo), chunk):
            part = todo[i:i + chunk]
            facts += await pit_ingest.ingest_edgar(part, client, limit=len(part))
            tried.update(part)
            TRIED_PATH.write_text(json.dumps(sorted(tried)))
            print(f"[widen] filings: {min(i + chunk, len(todo))}/{len(todo)}", flush=True)

        conn = pit.connect()
        f = pit.fundamentals_asof(conn, now())
        keep = valuable(f)
        priced = set(pit.prices_asof(conn, now())["symbol"].unique())
        need = [s for s in keep if s not in priced]
        print(f"[widen] {f['symbol'].nunique()} filers, {len(keep)} valuable, {len(need)} need prices", flush=True)
        rows = await _prices(need, client)

    WIDE_PATH.write_text(json.dumps({"updated": now(), "symbols": keep}))
    out = {"filers": int(f["symbol"].nunique()), "valuable": len(keep),
           "new_facts": facts, "new_price_rows": rows}
    print(json.dumps(out), flush=True)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=3000)
    asyncio.run(run(ap.parse_args().top))
