"""Current quotes for many symbols in one request (Yahoo's batch quote),
for watchlists, alerts and the paper order ticket."""

from . import web, yahoo

QUOTE = "https://query1.finance.yahoo.com/v7/finance/quote"
BATCH = 50


def _pct(fraction):
    """Yahoo gives some changes as fractions (0.05) and others as percents."""
    return fraction * 100 if isinstance(fraction, (int, float)) else None


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
            # the wider picture, for monitors (MEMB, MRR, WEIB, LVI)
            "change_52w_pct": q.get("fiftyTwoWeekChangePercent"),
            "high_52w": q.get("fiftyTwoWeekHigh"), "low_52w": q.get("fiftyTwoWeekLow"),
            "from_high_pct": _pct(q.get("fiftyTwoWeekHighChangePercent")),
            "vs_50d_pct": _pct(q.get("fiftyDayAverageChangePercent")),
            "vs_200d_pct": _pct(q.get("twoHundredDayAverageChangePercent")),
            "avg_volume_3m": q.get("averageDailyVolume3Month"), "avg_volume_10d": q.get("averageDailyVolume10Day"),
            "pe": q.get("trailingPE"), "forward_pe": q.get("forwardPE"), "market_cap": q.get("marketCap"),
            "dividend_yield": q.get("dividendYield"), "price_to_book": q.get("priceToBook"),
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
