"""MEMB, GWGT, MRR, WEIB and LVI: an index's members, their weights and
sectors, ranked returns, breadth and unusual volume.

Members and weights come from the tracking funds' daily holdings (SPY,
DIA, QQQ; see indexmove), sectors from State Street's eleven sector SPDR
funds, which split the S&P 500 by GICS sector. A member that is in none of
them (a Nasdaq-100 company outside the S&P 500) has no sector.
"""

import asyncio

from . import indexmove, quotes, web

SECTOR_FUNDS = {
    "xlk": "Technology", "xlf": "Financials", "xlv": "Health care", "xly": "Consumer discretionary",
    "xlp": "Consumer staples", "xle": "Energy", "xli": "Industrials", "xlb": "Materials",
    "xlre": "Real estate", "xlu": "Utilities", "xlc": "Communication",
}


async def sectors() -> dict[str, str]:
    async def make():
        async with web.client() as c:
            async def one(fund):
                r = await c.get(indexmove.SSGA.format(fund=fund))
                r.raise_for_status()
                return fund, (await asyncio.to_thread(indexmove.parse_ssga, r.content))[1]
            got = await asyncio.gather(*(one(f) for f in SECTOR_FUNDS))
        return {sym: SECTOR_FUNDS[f] for f, w in got for sym in w}
    return await web.cached("sectors", 12 * 3600, make)


def sector_weights(rows: list[dict]) -> list[dict]:
    out: dict[str, dict] = {}
    for r in rows:
        s = out.setdefault(r["sector"] or "Other", {"sector": r["sector"] or "Other", "weight": 0.0, "members": 0,
                                                     "contribution_pct": 0.0})
        s["weight"] += r["weight"]
        s["members"] += 1
        if r.get("change_pct") is not None:
            s["contribution_pct"] += r["weight"] * r["change_pct"]
    for s in out.values():
        s["change_pct"] = s["contribution_pct"] / s["weight"] if s["weight"] else None
    return sorted(out.values(), key=lambda s: -s["weight"])


def breadth(rows: list[dict]) -> dict:
    """Advances and declines, new 52-week highs and lows (within 1% of
    either end), and the share above their 50- and 200-day averages."""
    quoted = [r for r in rows if r.get("change_pct") is not None]
    n = len(quoted)

    def share(pred) -> float | None:
        have = [r for r in quoted if pred(r) is not None]
        return sum(bool(pred(r)) for r in have) / len(have) * 100 if have else None

    near = lambda r, end, sign: None if r.get(end) is None else sign * (r["price"] / r[end] - 1) * 100 <= 1  # noqa: E731
    return {
        "members": n,
        "advancing": sum(r["change_pct"] > 0 for r in quoted), "declining": sum(r["change_pct"] < 0 for r in quoted),
        "unchanged": sum(r["change_pct"] == 0 for r in quoted),
        "new_highs": sum(bool(near(r, "high_52w", -1)) for r in quoted),
        "new_lows": sum(bool(near(r, "low_52w", 1)) for r in quoted),
        "above_50d_pct": share(lambda r: None if r.get("vs_50d_pct") is None else r["vs_50d_pct"] > 0),
        "above_200d_pct": share(lambda r: None if r.get("vs_200d_pct") is None else r["vs_200d_pct"] > 0),
        "up_volume_pct": (sum(r["volume"] or 0 for r in quoted if r["change_pct"] > 0)
                          / (sum(r["volume"] or 0 for r in quoted) or 1) * 100) if n else None,
    }


async def members(code: str) -> dict:
    async def make():
        as_of, weights = await indexmove._weights(code)
        secs, got = await asyncio.gather(sectors(), quotes.quotes(list(weights)))
        rows = []
        for sym, w in weights.items():
            q = got.get(sym) or {}
            rows.append({
                "symbol": sym, "name": q.get("name"), "weight": w, "sector": secs.get(sym),
                "price": q.get("price"), "change_pct": q.get("change_pct"), "volume": q.get("volume"),
                **{k: q.get(k) for k in ("change_52w_pct", "high_52w", "low_52w", "from_high_pct", "vs_50d_pct",
                                         "vs_200d_pct", "avg_volume_3m", "pe", "forward_pe", "market_cap", "dividend_yield")},
            })
        for r in rows:
            avg = r.get("avg_volume_3m")
            r["volume_ratio"] = r["volume"] / avg if r.get("volume") and avg else None
        rows.sort(key=lambda r: -r["weight"])
        priced = [r for r in rows if r["price"] is not None]
        return {"index": code, "name": indexmove.INDICES[code]["name"], "fund": indexmove.INDICES[code]["fund"].upper(),
                "as_of": as_of, "rows": rows, "sectors": sector_weights(priced), "breadth": breadth(priced)}
    return await web.cached(f"members:{code}", 120, make)
