"""Current quotes for many symbols in one request (Yahoo's batch quote),
for watchlists, alerts and the paper order ticket."""

from . import web, yahoo

QUOTE = "https://query1.finance.yahoo.com/v7/finance/quote"
BATCH = 50


def parse(payload: dict) -> dict[str, dict]:
    out = {}
    for q in (payload.get("quoteResponse") or {}).get("result") or []:
        if q.get("regularMarketPrice") is None:
            continue
        out[q["symbol"]] = {
            "symbol": q["symbol"],
            "name": q.get("shortName") or q.get("longName") or q["symbol"],
            "price": q["regularMarketPrice"],
            "change": q.get("regularMarketChange"),
            "change_pct": q.get("regularMarketChangePercent"),
            "volume": q.get("regularMarketVolume"),
            "bid": q.get("bid") or None,
            "ask": q.get("ask") or None,
            "currency": q.get("currency"),
            "market_state": q.get("marketState"),
            "time": q.get("regularMarketTime"),
        }
    return out


async def quotes(symbols: list[str]) -> dict[str, dict]:
    """symbol -> quote for every symbol Yahoo knows; unknown ones are absent."""
    wanted = sorted({s.upper() for s in symbols if s})
    if not wanted:
        return {}

    async def make():
        out: dict[str, dict] = {}
        async with web.client() as c:
            crumb = await yahoo._crumb(c)
            for i in range(0, len(wanted), BATCH):
                part = wanted[i:i + BATCH]
                params = {"symbols": ",".join(part), **({"crumb": crumb} if crumb else {})}
                r = await c.get(QUOTE, params=params)
                r.raise_for_status()
                out.update(parse(r.json()))
        return out
    return await web.cached(f"q:{','.join(wanted)}", 30, make)
