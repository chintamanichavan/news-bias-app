"""Options tools on Cboe's public delayed chains (15 minutes late): VM
(volatility monitor), OVI (unusual option activity), MOSO (most active
contracts), CWS (covered calls), OSCH (option search), VSV (variance swap
strike by replication), VCAL (implied earnings moves) and CDVM
(commodity volatility, realised from futures and implied from commodity
funds' options).
"""

import asyncio
import math
from datetime import date, datetime, timezone

from . import options, quotes, rates, returns, web, yahoo

CBOE = "https://cdn.cboe.com/api/global/delayed_quotes/options/{symbol}.json"
# index options: Cboe's root and Yahoo's symbol for the index itself
INDEX_ROOTS = {"SPX": "^GSPC", "NDX": "^NDX", "RUT": "^RUT", "VIX": "^VIX", "XSP": "^GSPC", "DJX": "^DJI"}
YAHOO_TO_ROOT = {"^GSPC": "SPX", "^NDX": "NDX", "^RUT": "RUT", "^VIX": "VIX", "^DJI": "DJX"}


def cboe_path(symbol: str) -> str:
    s = symbol.upper()
    root = YAHOO_TO_ROOT.get(s, s.replace("^", ""))
    return f"_{root}" if root in INDEX_ROOTS else root.replace("-", ".")


def yahoo_symbol(symbol: str) -> str:
    s = symbol.upper().replace("^", "")
    return INDEX_ROOTS.get(s, symbol.upper())

VIX_FAMILY = [("^VIX9D", "S&P 500, 9 days"), ("^VIX", "S&P 500, 30 days (VIX)"), ("^VIX3M", "S&P 500, 3 months"),
              ("^VIX6M", "S&P 500, 6 months"), ("^VXN", "Nasdaq-100"), ("^VXD", "Dow"), ("^RVX", "Russell 2000"),
              ("^VVIX", "Volatility of VIX"), ("^SKEW", "Cboe SKEW (tail risk)"), ("^OVX", "Crude oil (USO)"),
              ("^GVZ", "Gold (GLD)")]

UNIVERSE = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "BRK.B", "JPM", "LLY",
            "V", "UNH", "XOM", "MA", "COST", "HD", "PG", "JNJ", "NFLX", "AMD", "BAC", "CRM", "ORCL", "KO", "WMT", "PLTR",
            "INTC", "DIS", "UBER", "BA", "COIN", "MU", "SMCI", "HOOD", "GLD", "TLT"]

COMMODITIES = [("CL=F", "USO", "Crude oil"), ("NG=F", "UNG", "Natural gas"), ("GC=F", "GLD", "Gold"), ("SI=F", "SLV", "Silver"),
               ("HG=F", "CPER", "Copper"), ("ZC=F", "CORN", "Corn"), ("ZW=F", "WEAT", "Wheat"), ("ZS=F", "SOYB", "Soybeans")]


def parse_occ(code: str) -> dict:
    """OCC option symbol 'AAPL261016C00345000' → root, expiry, kind, strike."""
    tail = code[-15:]
    return {"root": code[:-15], "expiry": f"20{tail[0:2]}-{tail[2:4]}-{tail[4:6]}", "kind": tail[6],
            "strike": int(tail[7:]) / 1000}


async def chain(symbol: str) -> dict:
    path = cboe_path(symbol)

    async def make():
        async with web.client() as c:
            r = await c.get(CBOE.format(symbol=path))
            if r.status_code == 403 or r.status_code == 404:
                raise options.NoOptions(f"Cboe lists no options for {symbol}.")
            r.raise_for_status()
            d = r.json()["data"]
        rows = []
        for o in d.get("options", []):
            rows.append({**parse_occ(o["option"]), "symbol": o["option"], "bid": o.get("bid") or 0.0, "ask": o.get("ask") or 0.0,
                         "iv": o.get("iv"), "delta": o.get("delta"), "gamma": o.get("gamma"), "theta": o.get("theta"),
                         "vega": o.get("vega"), "volume": o.get("volume") or 0.0, "open_interest": o.get("open_interest") or 0.0,
                         "last": o.get("last_trade_price")})
        meta = {k: d.get(k) for k in ("current_price", "close", "iv30", "iv30_change", "volume", "price_change_percent")}
        return {"symbol": symbol.upper(), **meta, "options": rows}
    return await web.cached(f"cboe:{path}", 300, make)


def days_to(expiry: str, today: date) -> int:
    return (date.fromisoformat(expiry) - today).days


def mid(o: dict) -> float | None:
    return (o["bid"] + o["ask"]) / 2 if o["ask"] > 0 and o["ask"] >= o["bid"] else None


# ── variance swaps by replication (the VIX method) ──────────────────────────

def expiry_variance(opts: list[dict], t: float, r: float) -> dict | None:
    """Cboe's VIX formula for one expiry: the forward from put-call parity
    at the strike where calls and puts cost most alike, then out-of-the-
    money options weighted by 1/K², stopping after two strikes with no bid."""
    calls = {o["strike"]: o for o in opts if o["kind"] == "C" and mid(o) is not None}
    puts = {o["strike"]: o for o in opts if o["kind"] == "P" and mid(o) is not None}
    both = sorted(set(calls) & set(puts))
    if len(both) < 3 or t <= 0:
        return None
    k_star = min(both, key=lambda k: abs(mid(calls[k]) - mid(puts[k])))
    fwd = k_star + math.exp(r * t) * (mid(calls[k_star]) - mid(puts[k_star]))
    below = [k for k in sorted(set(calls) | set(puts)) if k <= fwd]
    if not below:
        return None
    k0 = max(below)
    chosen: list[tuple[float, float]] = []
    zeros = 0
    for k in sorted([k for k in puts if k < k0], reverse=True):
        if puts[k]["bid"] <= 0:
            zeros += 1
            if zeros == 2:
                break
            continue
        zeros = 0
        chosen.append((k, mid(puts[k])))
    zeros = 0
    for k in sorted(k for k in calls if k > k0):
        if calls[k]["bid"] <= 0:
            zeros += 1
            if zeros == 2:
                break
            continue
        zeros = 0
        chosen.append((k, mid(calls[k])))
    at_k0 = [mid(x[k0]) for x in (calls, puts) if k0 in x]
    if at_k0:
        chosen.append((k0, sum(at_k0) / len(at_k0)))
    chosen.sort()
    if len(chosen) < 3:
        return None
    total = 0.0
    for i, (k, q) in enumerate(chosen):
        lo = chosen[i - 1][0] if i > 0 else k
        hi = chosen[i + 1][0] if i < len(chosen) - 1 else k
        dk = (hi - lo) / 2 if 0 < i < len(chosen) - 1 else (hi - lo)
        total += dk / (k * k) * math.exp(r * t) * q
    var = 2 / t * total - (fwd / k0 - 1) ** 2 / t
    return {"variance": var, "forward": fwd, "k0": k0, "strikes": len(chosen)}


def interpolate_variance(v1: float, t1: float, v2: float, t2: float, target: float) -> float:
    """Cboe's interpolation of total variance between two expiries to a
    target horizon, returned as an annual variance."""
    w = (t2 - target) / (t2 - t1)
    return (t1 * v1 * w + t2 * v2 * (1 - w)) / target


async def variance_swap(symbol: str, days: int = 30) -> dict:
    ch, curve = await asyncio.gather(chain(symbol), rates.curve())
    today = datetime.now(timezone.utc).date()
    expiries = sorted({o["expiry"] for o in ch["options"] if days_to(o["expiry"], today) >= 7})
    near = [e for e in expiries if days_to(e, today) <= days]
    far = [e for e in expiries if days_to(e, today) > days]
    picks = ([near[-1]] if near else []) + ([far[0]] if far else [])
    legs = []
    for e in picks:
        t = (days_to(e, today) + 0.5) / 365
        r = options.rate_for(t, curve)
        v = expiry_variance([o for o in ch["options"] if o["expiry"] == e], t, r)
        if v:
            legs.append({"expiry": e, "days": days_to(e, today), "t": t, **v, "vol": math.sqrt(max(v["variance"], 0))})
    if not legs:
        raise options.NoOptions(f"Not enough quoted options to replicate a variance swap on {symbol}.")
    target = days / 365
    if len(legs) == 2:
        var = interpolate_variance(legs[0]["variance"], legs[0]["t"], legs[1]["variance"], legs[1]["t"], target)
    else:
        var = legs[0]["variance"]
    strike = math.sqrt(max(var, 0)) * 100
    bars = await returns.bars(yahoo_symbol(symbol), "1y")
    closes = [b["close"] for b in bars][-(days + 1):]
    rv = math.sqrt(sum(math.log(b / a) ** 2 for a, b in zip(closes, closes[1:])) / max(len(closes) - 1, 1) * 252) * 100
    return {"symbol": symbol, "days": days, "fair_vol_strike": strike, "variance_strike": strike ** 2,
            "realized_vol": rv, "cboe_iv30": ch.get("iv30"), "legs": legs,
            "vega_notional_per_variance_unit": 1 / (2 * strike) if strike else None}


# ── activity, search and covered calls ──────────────────────────────────────

def activity(ch: dict) -> dict:
    o = ch["options"]
    cv = sum(x["volume"] for x in o if x["kind"] == "C")
    pv = sum(x["volume"] for x in o if x["kind"] == "P")
    oi = sum(x["open_interest"] for x in o)
    return {"symbol": ch["symbol"], "price": ch.get("current_price"), "change_pct": ch.get("price_change_percent"),
            "iv30": ch.get("iv30"), "call_volume": cv, "put_volume": pv, "volume": cv + pv, "open_interest": oi,
            "volume_to_oi": (cv + pv) / oi if oi else None, "put_call": pv / cv if cv else None}


async def market_activity() -> dict:
    async def make():
        got = await asyncio.gather(*(chain(s) for s in UNIVERSE), return_exceptions=True)
        chains = [g for g in got if not isinstance(g, Exception)]
        names = sorted((activity(c) for c in chains), key=lambda a: -(a["volume_to_oi"] or 0))
        contracts = sorted(((c["symbol"], o) for c in chains for o in c["options"]), key=lambda x: -x[1]["volume"])[:60]
        top = [{"underlying": u, **{k: o[k] for k in ("symbol", "expiry", "kind", "strike", "volume", "open_interest", "iv", "delta", "bid", "ask", "last")}}
               for u, o in contracts]
        return {"names": names, "contracts": top, "universe": len(chains)}
    return await web.cached("optactivity", 600, make)


async def search(symbol: str, min_days: int, max_days: int, min_delta: float, max_delta: float, kind: str | None, min_volume: float) -> dict:
    ch = await chain(symbol)
    today = datetime.now(timezone.utc).date()
    rows = [o for o in ch["options"]
            if min_days <= days_to(o["expiry"], today) <= max_days and o["delta"] is not None
            and min_delta <= abs(o["delta"]) <= max_delta and (kind is None or o["kind"] == kind) and o["volume"] >= min_volume]
    rows.sort(key=lambda o: (o["expiry"], o["kind"], o["strike"]))
    return {"symbol": ch["symbol"], "price": ch.get("current_price"), "rows": rows[:300], "matched": len(rows)}


def covered_call(price: float, strike: float, premium: float, days: int) -> dict:
    """Returns of buying the shares and selling one call against them, held
    to expiry: unchanged price (static) and called away (if called)."""
    static = premium / price
    called = (strike - price + premium) / price
    year = 365 / max(days, 1)
    return {"static_pct": static * 100, "if_called_pct": called * 100, "static_annual_pct": static * year * 100,
            "if_called_annual_pct": called * year * 100, "breakeven": price - premium, "protection_pct": premium / price * 100}


async def covered_calls(symbol: str) -> dict:
    ch = await chain(symbol)
    today = datetime.now(timezone.utc).date()
    price = ch.get("current_price") or ch.get("close")
    rows = []
    for o in ch["options"]:
        d = days_to(o["expiry"], today)
        if o["kind"] != "C" or not (7 <= d <= 120) or o["bid"] <= 0 or not (price <= o["strike"] <= price * 1.15):
            continue
        rows.append({"expiry": o["expiry"], "days": d, "strike": o["strike"], "bid": o["bid"], "delta": o["delta"],
                     "open_interest": o["open_interest"], **covered_call(price, o["strike"], o["bid"], d)})
    rows.sort(key=lambda x: (x["expiry"], x["strike"]))
    return {"symbol": ch["symbol"], "price": price, "rows": rows}


# ── earnings moves and commodity volatility ──────────────────────────────────

async def implied_moves(symbols: list[str]) -> dict:
    async def one(sym):
        qs, ch = await asyncio.gather(yahoo.summary(sym), chain(sym))
        cal = (qs.get("calendarEvents") or {}).get("earnings") or {}
        dates = [d.get("fmt") for d in cal.get("earningsDate", []) if isinstance(d, dict)]
        if not dates:
            return {"symbol": sym, "error": "No earnings date."}
        day = dates[0]
        price = ch.get("current_price") or ch.get("close")
        after = sorted({o["expiry"] for o in ch["options"] if o["expiry"] > day})
        if not after or not price:
            return {"symbol": sym, "earnings": day, "error": "No expiry after the report."}
        e = after[0]
        legs = [o for o in ch["options"] if o["expiry"] == e]
        k = min({o["strike"] for o in legs}, key=lambda s: abs(s - price))
        c = next((mid(o) for o in legs if o["strike"] == k and o["kind"] == "C"), None)
        p = next((mid(o) for o in legs if o["strike"] == k and o["kind"] == "P"), None)
        if c is None or p is None:
            return {"symbol": sym, "earnings": day, "error": "No quotes at the money."}
        return {"symbol": sym, "earnings": day, "expiry": e, "strike": k, "straddle": c + p, "price": price,
                "implied_move_pct": (c + p) / price * 100, "iv30": ch.get("iv30")}
    got = await asyncio.gather(*(one(s) for s in symbols), return_exceptions=True)
    return {"rows": [g if not isinstance(g, Exception) else {"symbol": s, "error": str(g)} for s, g in zip(symbols, got)]}


async def commodity_vol() -> dict:
    async def make():
        async def one(fut, etf, name):
            bars = await returns.bars(fut, "1y")
            closes = [b["close"] for b in bars]
            r = [math.log(b / a) for a, b in zip(closes, closes[1:]) if a > 0 and b > 0]
            def hv(n):
                w = r[-n:]
                m = sum(w) / len(w)
                return math.sqrt(sum((x - m) ** 2 for x in w) / (len(w) - 1) * 252) * 100 if len(w) > 2 else None
            try:
                iv = (await chain(etf)).get("iv30")
            except Exception:
                iv = None
            return {"future": fut, "fund": etf, "name": name, "hv20": hv(20), "hv60": hv(60), "hv250": hv(250), "fund_iv30": iv}
        rows = await asyncio.gather(*(one(*c) for c in COMMODITIES), return_exceptions=True)
        return {"rows": [r for r in rows if not isinstance(r, Exception)]}
    return await web.cached("cdvm", 1800, make)


async def vol_monitor(watch: list[str]) -> dict:
    q = await quotes.quotes([s for s, _ in VIX_FAMILY])
    family = [{"symbol": s, "name": n, "level": q[s]["price"], "change_pct": q[s]["change_pct"]} for s, n in VIX_FAMILY if s in q]
    term = {r["symbol"]: r["level"] for r in family}
    got = await asyncio.gather(*(chain(s) for s in watch), return_exceptions=True)
    names = [{"symbol": c["symbol"], "iv30": c.get("iv30"), "iv30_change": c.get("iv30_change"), "price": c.get("current_price")}
             for c in got if not isinstance(c, Exception)]
    shape = None
    if "^VIX" in term and "^VIX3M" in term:
        shape = "contango (calm)" if term["^VIX3M"] > term["^VIX"] else "backwardation (stress)"
    return {"family": family, "curve_shape": shape, "names": names}
