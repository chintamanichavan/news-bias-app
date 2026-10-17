"""MOV: which members moved an index today, and by how many points.

Weights come from each index's tracking fund, published daily for the
previous close: State Street's SPY for the S&P 500 and DIA for the Dow,
Invesco's QQQ for the Nasdaq-100. A member's contribution is its weight
times its return since that close, in percent and in index points. Fund
weights are the index's to within the fund's small cash holding.
"""

import asyncio
import io
from datetime import datetime, timezone

import pandas as pd

from . import quotes, web

SSGA = "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-{fund}.xlsx"
INVESCO = ("https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/{fund}/holdings/fund"
           "?idType=ticker&interval=monthly&productType=ETF")

INDICES = {
    "SPX": {"name": "S&P 500", "symbol": "^GSPC", "fund": "spy", "issuer": "ssga"},
    "INDU": {"name": "Dow Jones Industrial Average", "symbol": "^DJI", "fund": "dia", "issuer": "ssga"},
    "NDX": {"name": "Nasdaq-100", "symbol": "^NDX", "fund": "QQQ", "issuer": "invesco"},
}


def yahoo_ticker(t: str) -> str:
    return t.strip().upper().replace(".", "-").replace("/", "-")


def parse_ssga(content: bytes) -> tuple[str | None, dict[str, float]]:
    """(as-of text, {ticker: weight fraction}) from a State Street holdings
    file: a few title lines, then a table headed Name, Ticker, ..., Weight."""
    raw = pd.read_excel(io.BytesIO(content), header=None)
    as_of = None
    for _, row in raw.head(6).iterrows():
        if str(row[0]).startswith("Holdings"):
            as_of = str(row[1]).replace("As of ", "")
    head = next(i for i, row in raw.iterrows() if str(row[1]).strip() == "Ticker")
    table = raw.iloc[head + 1:]
    weights: dict[str, float] = {}
    cols = list(raw.iloc[head])
    t_col, w_col = cols.index("Ticker"), cols.index("Weight")
    for _, row in table.iterrows():
        ticker, weight = row[t_col], pd.to_numeric(row[w_col], errors="coerce")
        if isinstance(ticker, str) and ticker.strip() not in ("", "-") and pd.notna(weight) \
                and not ticker.upper().startswith("CASH"):
            weights[yahoo_ticker(ticker)] = weights.get(yahoo_ticker(ticker), 0.0) + float(weight) / 100
    return as_of, weights


def parse_invesco(payload: dict) -> tuple[str | None, dict[str, float]]:
    """(as-of date, {ticker: weight fraction}) from Invesco's holdings JSON:
    shares and the foreign members' ADRs, not cash or futures."""
    weights: dict[str, float] = {}
    for h in payload.get("holdings", []):
        kind = h.get("securityTypeName") or ""
        if h.get("ticker") and (kind == "Common Stock" or kind.startswith("American Depository Receipt")) \
                and h.get("percentageOfTotalNetAssets") is not None:
            weights[yahoo_ticker(h["ticker"])] = h["percentageOfTotalNetAssets"] / 100
    return payload.get("effectiveDate"), weights


def contributions(weights: dict[str, float], quotes_by: dict[str, dict], index_prev: float) -> list[dict]:
    """Each member's part in today's move, largest effect first. Weights are
    at the previous close, so weight times return is the member's share of
    the index's return."""
    rows = []
    for symbol, w in weights.items():
        q = quotes_by.get(symbol)
        if not q or q.get("change_pct") is None:
            continue
        r = q["change_pct"] / 100
        rows.append({"symbol": symbol, "name": q.get("name"), "weight": w, "price": q["price"],
                     "change_pct": q["change_pct"], "contribution_pct": w * r * 100,
                     "points": w * r * index_prev})
    rows.sort(key=lambda r: -abs(r["points"]))
    return rows


async def _weights(code: str) -> tuple[str | None, dict[str, float]]:
    async def make():
        async with web.client() as c:
            ix = INDICES[code]
            if ix["issuer"] == "ssga":
                r = await c.get(SSGA.format(fund=ix["fund"]))
                r.raise_for_status()
                return await asyncio.to_thread(parse_ssga, r.content)
            r = await c.get(INVESCO.format(fund=ix["fund"]))
            r.raise_for_status()
            return parse_invesco(r.json())
    return await web.cached(f"weights:{code}", 6 * 3600, make)


async def movers(code: str) -> dict:
    async def make():
        as_of, weights = await _weights(code)
        index_symbol = INDICES[code]["symbol"]
        got = await quotes.quotes([index_symbol, *weights])
        idx = got.get(index_symbol)
        if not idx or idx.get("change") is None:
            raise RuntimeError(f"no quote for {INDICES[code]['name']}")
        prev = idx["price"] - idx["change"]
        rows = contributions(weights, got, prev)
        explained = sum(r["points"] for r in rows)
        return {
            "index": code, "name": INDICES[code]["name"], "level": idx["price"], "change": idx["change"],
            "change_pct": idx["change_pct"], "weights_as_of": as_of,
            "fund": INDICES[code]["fund"].upper(),
            "members": len(weights), "quoted": len(rows), "explained_points": explained,
            "advancers": sum(r["change_pct"] > 0 for r in rows), "decliners": sum(r["change_pct"] < 0 for r in rows),
            "rows": rows, "built_at": datetime.now(timezone.utc).isoformat(),
        }
    return await web.cached(f"mov:{code}", 120, make)
