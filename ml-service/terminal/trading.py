"""EMSX and TCA: a paper order ticket and the cost of its fills.

Paper fills are deliberately not flattering: a market order crosses the
spread (buys at the ask, sells at the bid) when both sides are quoted
sensibly, and a limit order fills only once the far side of the quote
reaches its limit. Quotes are about 15 minutes late, and outside market
hours they are the last ones of the day. No commission is charged.
"""

from datetime import datetime, timezone

from . import quotes, store, web

INTRADAY = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
SANE_SPREAD = 0.02          # a quote wider than 2% of its midpoint is not used


def usable_quote(q: dict) -> tuple[float | None, float | None]:
    """Bid and ask if both exist and the spread is believable."""
    bid, ask = q.get("bid"), q.get("ask")
    if bid and ask and ask >= bid and (ask - bid) / ((ask + bid) / 2) <= SANE_SPREAD:
        return bid, ask
    return None, None


def market_fill(side: str, q: dict) -> float:
    bid, ask = usable_quote(q)
    if side == "buy":
        return ask if ask else q["price"]
    return bid if bid else q["price"]


def limit_fill(side: str, limit: float, q: dict) -> float | None:
    """The fill price if the limit is reached now, else None."""
    reach = market_fill(side, q)
    if side == "buy":
        return min(limit, reach) if reach <= limit else None
    return max(limit, reach) if reach >= limit else None


def midpoint(q: dict) -> float:
    bid, ask = usable_quote(q)
    return (bid + ask) / 2 if bid and ask else q["price"]


def slippage_bps(side: str, fill: float, reference: float) -> float:
    """Cost against a reference price in basis points: positive is worse
    (paid more on a buy, received less on a sale)."""
    sign = 1 if side == "buy" else -1
    return sign * (fill - reference) / reference * 10_000


def vwap(bars: list[tuple[float, float]]) -> float | None:
    """Volume-weighted average of (price, volume) bars."""
    volume = sum(v for _, v in bars if v)
    return sum(p * v for p, v in bars if v) / volume if volume else None


def paper_positions(filled: list[dict]) -> list[dict]:
    """Net quantity and average cost by symbol from filled orders, oldest
    first. A sale reduces the position at its average cost."""
    book: dict[str, dict] = {}
    for o in sorted(filled, key=lambda o: (o["filled_at"], o["id"])):
        p = book.setdefault(o["symbol"], {"symbol": o["symbol"], "quantity": 0.0, "cost": 0.0, "realized": 0.0})
        qty = o["quantity"] if o["side"] == "buy" else -o["quantity"]
        if p["quantity"] == 0 or (p["quantity"] > 0) == (qty > 0):
            total = p["quantity"] + qty
            p["cost"] = (p["cost"] * p["quantity"] + o["fill_price"] * qty) / total
            p["quantity"] = total
        else:
            closing = min(abs(qty), abs(p["quantity"])) * (1 if p["quantity"] > 0 else -1)
            p["realized"] += closing * (o["fill_price"] - p["cost"])
            p["quantity"] += qty
            if abs(p["quantity"]) < 1e-9:
                p["quantity"], p["cost"] = 0.0, 0.0
            elif (p["quantity"] > 0) != (closing > 0):
                p["cost"] = o["fill_price"]          # flipped through zero: the rest opens fresh
    return list(book.values())


class NoQuote(Exception):
    pass


async def place(symbol: str, side: str, quantity: float, kind: str, limit: float | None) -> dict:
    got = await quotes.quotes([symbol])
    q = got.get(symbol.upper())
    if not q:
        raise NoQuote(f"No quote for {symbol}, so no order was placed.")
    bid, ask = usable_quote(q)
    order = {"symbol": symbol, "side": side, "quantity": quantity, "type": kind, "limit_price": limit,
             "arrival_mid": midpoint(q), "arrival_bid": bid, "arrival_ask": ask}
    fill = market_fill(side, q) if kind == "market" else limit_fill(side, limit, q)
    if fill is not None:
        order.update(status="filled", fill_price=fill, filled_at=store.now())
    else:
        order["status"] = "working"
    return {"id": store.add_order(order), **order}


async def check() -> list[dict]:
    working = [o for o in store.orders() if o["status"] == "working"]
    if not working:
        return []
    got = await quotes.quotes([o["symbol"] for o in working])
    filled = []
    for o in working:
        q = got.get(o["symbol"])
        price = limit_fill(o["side"], o["limit_price"], q) if q else None
        if price is not None:
            store.fill_order(o["id"], price)
            filled.append({**o, "fill_price": price})
    return filled


async def blotter() -> dict:
    all_orders = store.orders()
    positions = paper_positions([o for o in all_orders if o["status"] == "filled"])
    got = await quotes.quotes([p["symbol"] for p in positions])
    for p in positions:
        price = got.get(p["symbol"], {}).get("price")
        p["price"] = price
        p["unrealized"] = (price - p["cost"]) * p["quantity"] if price is not None and p["quantity"] else 0.0
    return {"orders": all_orders, "positions": positions}


def local_day(iso: str, offset: int) -> str:
    """The exchange's calendar day for a UTC timestamp, so a fill late in a
    New York evening (already tomorrow in UTC) belongs to that day."""
    t = datetime.fromisoformat(iso).timestamp() + offset
    return datetime.fromtimestamp(t, tz=timezone.utc).date().isoformat()


def session_for(day: str, sessions: set[str]) -> str | None:
    """The session a fill is measured against: its own day, or for a fill on
    a weekend or holiday the last session before it."""
    before = [s for s in sessions if s <= day]
    return max(before) if before else None


async def _day_bars(symbol: str) -> tuple[int, list[dict]]:
    async def make():
        async with web.client() as c:
            r = await c.get(INTRADAY.format(symbol=symbol), params={"range": "5d", "interval": "5m"})
            r.raise_for_status()
            res = r.json()["chart"]["result"][0]
        offset = res["meta"].get("gmtoffset", 0)
        q = res["indicators"]["quote"][0]
        out = []
        for t, h, low, c, v in zip(res.get("timestamp") or [], q["high"], q["low"], q["close"], q["volume"]):
            if c is not None and v:
                out.append({"day": datetime.fromtimestamp(t + offset, tz=timezone.utc).date().isoformat(), "price": (h + low + c) / 3 if h and low else c, "volume": v})
        return offset, out
    return await web.cached(f"bars5m:{symbol}", 300, make)


async def tca() -> dict:
    filled = [o for o in store.orders() if o["status"] == "filled"]
    rows = []
    for o in filled:
        offset, bars = await _day_bars(o["symbol"])
        day = session_for(local_day(o["filled_at"], offset), {b["day"] for b in bars})
        day_vwap = vwap([(b["price"], b["volume"]) for b in bars if b["day"] == day]) if day else None
        notional = o["fill_price"] * o["quantity"]
        vs_arrival = slippage_bps(o["side"], o["fill_price"], o["arrival_mid"]) if o["arrival_mid"] else None
        rows.append({
            "id": o["id"], "symbol": o["symbol"], "side": o["side"], "quantity": o["quantity"], "type": o["type"],
            "filled_at": o["filled_at"], "fill_price": o["fill_price"], "arrival_mid": o["arrival_mid"],
            "vwap": day_vwap, "notional": notional,
            "vs_arrival_bps": vs_arrival,
            "vs_vwap_bps": slippage_bps(o["side"], o["fill_price"], day_vwap) if day_vwap else None,
            "cost_dollars": vs_arrival / 10_000 * notional if vs_arrival is not None else None,
        })
    total = sum(r["notional"] for r in rows)

    def weighted(key: str) -> float | None:
        pairs = [(r[key], r["notional"]) for r in rows if r[key] is not None]
        w = sum(n for _, n in pairs)
        return sum(b * n for b, n in pairs) / w if w else None

    return {"fills": rows, "notional": total, "vs_arrival_bps": weighted("vs_arrival_bps"),
            "vs_vwap_bps": weighted("vs_vwap_bps"),
            "cost_dollars": sum(r["cost_dollars"] for r in rows if r["cost_dollars"] is not None)}
