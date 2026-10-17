"""RV: a company beside the companies Yahoo lists as similar, on the
screener's measures. Yahoo's list comes from what its readers look at
together, so it is not strictly an industry peer group."""

from statistics import median

from . import screener, web

SIMILAR = "https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/{symbol}"

MEASURES = ["mkt_cap", "pe", "roe", "margin", "growth", "yield", "exp_return", "chg_1y"]


def parse_similar(payload: dict) -> list[str]:
    try:
        recs = payload["finance"]["result"][0]["recommendedSymbols"]
    except (KeyError, IndexError, TypeError):
        return []
    return [r["symbol"] for r in recs if r.get("symbol")]


def compare(symbol: str, peers: list[str], table: dict[str, dict]) -> dict:
    """Rows for the company and its peers, with the peers' median for each
    measure and where the company ranks (1 = highest)."""
    rows = [{"symbol": s, "self": s == symbol, "covered": s in table, **table.get(s, {})}
            for s in [symbol, *peers]]
    medians, ranks = {}, {}
    for m in MEASURES:
        peer_values = [r[m] for r in rows if not r["self"] and r.get(m) is not None]
        medians[m] = round(median(peer_values), 2) if peer_values else None
        mine = table.get(symbol, {}).get(m)
        everyone = sorted((r[m] for r in rows if r.get(m) is not None), reverse=True)
        ranks[m] = everyone.index(mine) + 1 if mine is not None else None
    return {"symbol": symbol, "rows": rows, "peer_median": medians, "rank": ranks,
            "of": len(rows)}


async def relative(symbol: str) -> dict:
    async def similar():
        async with web.client() as c:
            r = await c.get(SIMILAR.format(symbol=symbol))
            r.raise_for_status()
            return parse_similar(r.json())
    peers = await web.cached(f"similar:{symbol}", 86400, similar)
    table = {r["symbol"]: r for r in (await screener.table())["rows"]}
    return compare(symbol, peers, table)
