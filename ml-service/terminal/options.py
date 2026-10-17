"""Options: Black-Scholes-Merton pricing, implied volatility and greeks,
and the chain behind OMON and OV.

Implied volatility is solved here from each contract's bid/ask midpoint
rather than taken from Yahoo, so every number on the screen comes from one
stated model: European exercise, continuous dividend yield, the Treasury
curve for the rate. US single-stock options are American, so for deep
in-the-money puts and around dividends the model is an approximation; the
screen says so.
"""

import asyncio
import math
from datetime import datetime, timezone

from . import rates, web, yahoo

CHAIN = "https://query2.finance.yahoo.com/v7/finance/options/{symbol}"
YEAR_SECONDS = 365 * 86400
# US listed options stop trading at 4pm New York time on expiry day; Yahoo
# gives midnight UTC of that day.
CLOSE_OFFSET_SECONDS = 20 * 3600
MIN_T = 1 / (365 * 24)


# ── the model ────────────────────────────────────────────────────────────────

def _cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def _d1_d2(s: float, k: float, t: float, r: float, q: float, vol: float) -> tuple[float, float]:
    d1 = (math.log(s / k) + (r - q + 0.5 * vol * vol) * t) / (vol * math.sqrt(t))
    return d1, d1 - vol * math.sqrt(t)


def price(kind: str, s: float, k: float, t: float, r: float, q: float, vol: float) -> float:
    """Black-Scholes-Merton value of a European call ('C') or put ('P')."""
    t = max(t, MIN_T)
    d1, d2 = _d1_d2(s, k, t, r, q, vol)
    if kind == "C":
        return s * math.exp(-q * t) * _cdf(d1) - k * math.exp(-r * t) * _cdf(d2)
    return k * math.exp(-r * t) * _cdf(-d2) - s * math.exp(-q * t) * _cdf(-d1)


def greeks(kind: str, s: float, k: float, t: float, r: float, q: float, vol: float) -> dict:
    """Delta, gamma, theta per calendar day, vega per volatility point."""
    t = max(t, MIN_T)
    d1, d2 = _d1_d2(s, k, t, r, q, vol)
    disc_q, disc_r = math.exp(-q * t), math.exp(-r * t)
    gamma = disc_q * _pdf(d1) / (s * vol * math.sqrt(t))
    vega = s * disc_q * _pdf(d1) * math.sqrt(t) / 100
    decay = -s * disc_q * _pdf(d1) * vol / (2 * math.sqrt(t))
    if kind == "C":
        delta = disc_q * _cdf(d1)
        theta = decay - r * k * disc_r * _cdf(d2) + q * s * disc_q * _cdf(d1)
    else:
        delta = -disc_q * _cdf(-d1)
        theta = decay + r * k * disc_r * _cdf(-d2) - q * s * disc_q * _cdf(-d1)
    return {"delta": delta, "gamma": gamma, "theta": theta / 365, "vega": vega}


def implied_vol(kind: str, market: float, s: float, k: float, t: float, r: float, q: float) -> float | None:
    """The volatility at which the model gives `market`, by bisection. None
    when the price sits outside what any volatility can produce."""
    t = max(t, MIN_T)
    lo, hi = 1e-4, 5.0
    if not (price(kind, s, k, t, r, q, lo) - 1e-9 <= market <= price(kind, s, k, t, r, q, hi)):
        return None
    for _ in range(100):
        mid = (lo + hi) / 2
        if price(kind, s, k, t, r, q, mid) < market:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def midpoint(bid: float | None, ask: float | None, last: float | None) -> float | None:
    """The bid/ask midpoint when both sides are quoted, else the last trade."""
    if bid and ask and ask >= bid > 0:
        return (bid + ask) / 2
    return last if last and last > 0 else None


def years_to(expiry_epoch: int, now: float) -> float:
    return max((expiry_epoch + CLOSE_OFFSET_SECONDS - now) / YEAR_SECONDS, MIN_T)


def rate_for(t: float, curve: dict | None) -> float:
    """Continuously compounded rate for t years from the Treasury curve,
    interpolated linearly between tenors."""
    if not curve or not curve.get("curves"):
        return 0.04
    yields = curve["curves"][0]["yields"]
    points = sorted((ten["years"], yields[ten["label"]] / 100) for ten in curve["tenors"] if ten["label"] in yields)
    if not points:
        return 0.04
    if t <= points[0][0]:
        y = points[0][1]
    elif t >= points[-1][0]:
        y = points[-1][1]
    else:
        for (t0, y0), (t1, y1) in zip(points, points[1:]):
            if t0 <= t <= t1:
                y = y0 + (y1 - y0) * (t - t0) / (t1 - t0)
                break
    return math.log(1 + y)


# ── the chain ────────────────────────────────────────────────────────────────

def contract(kind: str, c: dict, s: float, t: float, r: float, q: float) -> dict:
    mid = midpoint(c.get("bid"), c.get("ask"), c.get("lastPrice"))
    iv = implied_vol(kind, mid, s, c["strike"], t, r, q) if mid else None
    row = {
        "symbol": c.get("contractSymbol"), "bid": c.get("bid"), "ask": c.get("ask"),
        "last": c.get("lastPrice"), "mid": mid, "volume": c.get("volume"),
        "open_interest": c.get("openInterest"), "iv": iv, "yahoo_iv": c.get("impliedVolatility"),
        "in_the_money": c.get("inTheMoney"),
    }
    if iv:
        row.update({k: round(v, 5) for k, v in greeks(kind, s, c["strike"], t, r, q, iv).items()})
    return row


def build_chain(res: dict, now: float, curve: dict | None) -> dict:
    """One expiry of Yahoo's chain, joined by strike, with the model's
    numbers on every contract."""
    quote = res.get("quote") or {}
    s = quote.get("regularMarketPrice")
    q = quote.get("trailingAnnualDividendYield") or 0.0
    block = (res.get("options") or [{}])[0]
    expiry = block.get("expirationDate")
    if not s or not expiry:
        return {"spot": s, "expirations": res.get("expirationDates", []), "expiry": expiry, "rows": []}
    t = years_to(expiry, now)
    r = rate_for(t, curve)
    by_strike: dict[float, dict] = {}
    for kind, key in (("C", "calls"), ("P", "puts")):
        for c in block.get(key, []):
            by_strike.setdefault(c["strike"], {"strike": c["strike"]})[key[:-1]] = contract(kind, c, s, t, r, q)
    return {
        "spot": s, "currency": quote.get("currency"), "expirations": res.get("expirationDates", []),
        "expiry": expiry, "years": t, "rate": r, "dividend_yield": q,
        "rows": [by_strike[k] for k in sorted(by_strike)],
    }


class NoOptions(Exception):
    pass


async def fetch_expiry(symbol: str, expiry: int | None) -> dict:
    """Yahoo's raw chain for one expiry (the nearest when None)."""
    async def make():
        async with web.client() as c:
            crumb = await yahoo._crumb(c)
            params = {**({"crumb": crumb} if crumb else {}), **({"date": expiry} if expiry else {})}
            r = await c.get(CHAIN.format(symbol=symbol), params=params)
            r.raise_for_status()
            result = r.json()["optionChain"]["result"]
            if not result or not result[0].get("expirationDates"):
                raise NoOptions(f"{symbol} has no listed options.")
            return result[0]
    return await web.cached(f"opt:{symbol}:{expiry}", 300, make)


async def chain(symbol: str, expiry: int | None = None) -> dict:
    res, curve = await asyncio.gather(fetch_expiry(symbol, expiry), rates.curve())
    return {"symbol": symbol, **build_chain(res, datetime.now(timezone.utc).timestamp(), curve)}
