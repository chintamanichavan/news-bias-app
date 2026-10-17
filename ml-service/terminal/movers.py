"""MOST (movers and most active) and MMAP (market heat map), from Yahoo's
predefined screeners. Quotes are about 15 minutes late."""

import asyncio

from . import web

SCREENER = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved"

LISTS = {"gainers": "day_gainers", "losers": "day_losers", "active": "most_actives"}

# Yahoo's sector lists come largest company first.
SECTORS = {
    "Technology": "ms_technology",
    "Communication": "ms_communication_services",
    "Consumer cyclical": "ms_consumer_cyclical",
    "Consumer defensive": "ms_consumer_defensive",
    "Financials": "ms_financial_services",
    "Health care": "ms_healthcare",
    "Industrials": "ms_industrials",
    "Energy": "ms_energy",
    "Materials": "ms_basic_materials",
    "Real estate": "ms_real_estate",
    "Utilities": "ms_utilities",
}


def parse_quotes(payload: dict) -> list[dict]:
    """Screener JSON to rows with the fields the terminal shows."""
    try:
        quotes = payload["finance"]["result"][0]["quotes"]
    except (KeyError, IndexError, TypeError):
        return []
    rows = []
    for q in quotes:
        if not q.get("symbol") or q.get("regularMarketPrice") is None:
            continue
        rows.append({
            "symbol": q["symbol"],
            "name": q.get("shortName") or q.get("longName") or q["symbol"],
            "price": q.get("regularMarketPrice"),
            "change_pct": q.get("regularMarketChangePercent"),
            "volume": q.get("regularMarketVolume"),
            "avg_volume_3m": q.get("averageDailyVolume3Month"),
            "market_cap": q.get("marketCap"),
        })
    return rows


def one_per_company(rows: list[dict]) -> list[dict]:
    """Drop second share classes (GOOG after GOOGL, BRK-A after BRK-B) so a
    company is counted once in a sector's weight."""
    seen, out = set(), []
    for r in rows:
        name = r["name"].lower().replace("class a", "").replace("class c", "").strip(" ,.")
        root = r["symbol"].split("-")[0].split(".")[0]   # BRK-A, BRK-B -> BRK
        if name in seen or root in seen:
            continue
        seen.update((name, root))
        out.append(r)
    return out


def weighted_change(rows: list[dict]) -> float | None:
    """A sector's move: each company's change weighted by its market cap."""
    pairs = [(r["market_cap"], r["change_pct"]) for r in rows
             if r.get("market_cap") and r.get("change_pct") is not None]
    total = sum(cap for cap, _ in pairs)
    return sum(cap * ch for cap, ch in pairs) / total if total else None


async def _screen(c, scr_id: str, count: int) -> list[dict]:
    r = await c.get(SCREENER, params={"scrIds": scr_id, "count": count})
    r.raise_for_status()
    return parse_quotes(r.json())


async def movers(kind: str) -> dict:
    async def make():
        async with web.client() as c:
            return {"kind": kind, "rows": await _screen(c, LISTS[kind], 50)}
    return await web.cached(f"movers:{kind}", 120, make)


async def heatmap(per_sector: int = 15) -> dict:
    async def make():
        async with web.client() as c:
            lists = await asyncio.gather(*(_screen(c, sid, per_sector * 2) for sid in SECTORS.values()))
        sectors = []
        for name, rows in zip(SECTORS, lists):
            top = one_per_company(rows)[:per_sector]
            if not top:
                continue
            sectors.append({
                "name": name,
                "change_pct": weighted_change(top),
                "market_cap": sum(r["market_cap"] or 0 for r in top),
                "names": top,
            })
        sectors.sort(key=lambda s: -s["market_cap"])
        return {"sectors": sectors}
    return await web.cached("heatmap", 120, make)
