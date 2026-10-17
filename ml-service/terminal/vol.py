"""IVOL, HIVG, SKEW and OVDV: the volatility a stock's options imply.

Several expiries out to about a year are priced with options.build_chain,
then read three ways: the at-the-money level (term structure, and a
30-day figure), the smile across strikes (25-delta skew), and a grid of
moneyness by expiry (the surface). Only out-of-the-money contracts with a
real bid are used on the smile: puts below the forward, calls above.

Free sources keep no history of implied volatility, so HIVG records one
30-day reading per security per day from the first time it is asked, and
sets it beside realized volatility, which can be measured back a year.
"""

import asyncio
import json
import math
from datetime import date, datetime, timezone
from pathlib import Path

from . import options, rates, returns, web

TARGET_DAYS = [7, 14, 30, 60, 90, 180, 270, 365]
MONEYNESS = [0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20]
RV_WINDOWS = [10, 20, 30, 60, 90, 250]
TRADING_DAYS = 252
IV_LOG = Path(__file__).resolve().parent.parent / "data" / "terminal_iv.json"


def pick_expiries(expirations: list[int], now: float) -> list[int]:
    """One listed expiry nearest each target horizon, no repeats, in order."""
    chosen = []
    for days in TARGET_DAYS:
        future = [e for e in expirations if e > now + 86400]
        if not future:
            break
        best = min(future, key=lambda e: abs((e - now) / 86400 - days))
        if best not in chosen:
            chosen.append(best)
    return sorted(chosen)


def smile(chain: dict) -> list[dict]:
    """Out-of-the-money points with a real bid: (moneyness, iv, delta)."""
    s, t, r, q = chain["spot"], chain["years"], chain["rate"], chain["dividend_yield"]
    forward = s * math.exp((r - q) * t)
    points = []
    for row in chain["rows"]:
        side = row.get("put") if row["strike"] < forward else row.get("call")
        if side and side.get("iv") and side.get("bid") and side.get("delta") is not None:
            points.append({"moneyness": row["strike"] / s, "iv": side["iv"], "delta": side["delta"],
                           "strike": row["strike"]})
    return points


def at_the_money(chain: dict) -> float | None:
    """Average of call and put volatility at the strike nearest the forward."""
    s, t, r, q = chain["spot"], chain["years"], chain["rate"], chain["dividend_yield"]
    forward = s * math.exp((r - q) * t)
    rows = [row for row in chain["rows"] if (row.get("call") or {}).get("iv") or (row.get("put") or {}).get("iv")]
    if not rows:
        return None
    row = min(rows, key=lambda row: abs(row["strike"] - forward))
    vols = [side["iv"] for side in (row.get("call"), row.get("put")) if side and side.get("iv")]
    return sum(vols) / len(vols)


def interpolate(points: list[tuple[float, float]], x: float) -> float | None:
    """Linear interpolation on (x, y) points; None outside their range."""
    points = sorted(points)
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x0 <= x <= x1:
            return y0 if x1 == x0 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return None


def skew_25(points: list[dict], atm: float | None) -> dict:
    """25-delta risk reversal (call minus put volatility; negative when puts
    are dearer) and butterfly (wings over the middle)."""
    put = interpolate([(p["delta"], p["iv"]) for p in points if p["delta"] < 0], -0.25)
    call = interpolate([(p["delta"], p["iv"]) for p in points if p["delta"] > 0], 0.25)
    rr = call - put if put is not None and call is not None else None
    bf = (call + put) / 2 - atm if rr is not None and atm is not None else None
    return {"put_25d": put, "call_25d": call, "risk_reversal": rr, "butterfly": bf}


def iv_at_days(term: list[tuple[float, float]], days: float) -> float | None:
    """Volatility at a horizon, interpolating total variance (vol² × time)
    between the expiries either side, the usual way to keep it arbitrage-free."""
    var = interpolate([(d, v * v * d) for d, v in term], days)
    return math.sqrt(var / days) if var is not None and var > 0 else None


def realized(closes: list[float], window: int) -> float | None:
    """Annualized standard deviation of the last `window` daily log returns."""
    if len(closes) < window + 1:
        return None
    tail = closes[-(window + 1):]
    rets = [math.log(b / a) for a, b in zip(tail, tail[1:])]
    mean = sum(rets) / len(rets)
    var = sum((x - mean) ** 2 for x in rets) / (len(rets) - 1)
    return math.sqrt(var * TRADING_DAYS)


def rolling_realized(rows: list[tuple[date, float]], window: int = 30) -> list[dict]:
    closes = [c for _, c in rows]
    return [{"t": rows[i][0].isoformat(), "v": round(realized(closes[: i + 1], window) * 100, 2)}
            for i in range(window, len(rows))]


def record_iv(symbol: str, iv30: float, today: date, path: Path = IV_LOG) -> list[dict]:
    """Keep one 30-day reading per security per day; return its history."""
    try:
        log = json.loads(path.read_text())
    except (OSError, ValueError):
        log = {}
    history = log.setdefault(symbol, [])
    if not history or history[-1]["date"] != today.isoformat():
        history.append({"date": today.isoformat(), "iv30": round(iv30, 5)})
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(log))
    return history


async def surface(symbol: str) -> dict:
    async def make():
        now = datetime.now(timezone.utc).timestamp()
        first = await options.fetch_expiry(symbol, None)
        expiries = pick_expiries(first.get("expirationDates", []), now)
        curve = await rates.curve()
        raws = await asyncio.gather(*(options.fetch_expiry(symbol, e) for e in expiries))
        chains = [options.build_chain(raw, now, curve) for raw in raws]

        term, grid, skews = [], [], []
        put_volume = call_volume = put_oi = call_oi = 0
        for ch in chains:
            if not ch["rows"]:
                continue
            days = ch["years"] * 365
            atm = at_the_money(ch)
            points = smile(ch)
            if atm:
                term.append((days, atm))
            sk = skew_25(points, atm)
            skews.append({"expiry": ch["expiry"], "days": round(days, 1), "atm": atm, **sk,
                          "smile": [{"moneyness": round(p["moneyness"], 4), "iv": p["iv"], "strike": p["strike"]}
                                    for p in points]})
            curve_pts = [(p["moneyness"], p["iv"]) for p in points]
            grid.append({"expiry": ch["expiry"], "days": round(days, 1),
                         "iv": [interpolate(curve_pts, m) for m in MONEYNESS]})
            for row in ch["rows"]:
                call, put = row.get("call") or {}, row.get("put") or {}
                call_volume += call.get("volume") or 0
                put_volume += put.get("volume") or 0
                call_oi += call.get("open_interest") or 0
                put_oi += put.get("open_interest") or 0

        history = await returns.history(symbol)
        closes = [c for _, c, _ in history["rows"]]
        rv = {f"{w}d": realized(closes, w) for w in RV_WINDOWS}
        iv30 = iv_at_days(term, 30)
        today = date.today()
        recorded = record_iv(symbol, iv30, today) if iv30 else []
        return {
            "symbol": symbol, "spot": first.get("quote", {}).get("regularMarketPrice"),
            "iv30": iv30, "realized": rv,
            "term": [{"days": round(d, 1), "atm": v} for d, v in term],
            "skew": skews, "moneyness": MONEYNESS, "surface": grid,
            "put_call": {"volume": put_volume / call_volume if call_volume else None,
                         "open_interest": put_oi / call_oi if call_oi else None},
            "realized_30d": rolling_realized([(d, c) for d, c, _ in history["rows"]]),
            "iv_history": recorded,
        }
    return await web.cached(f"vol:{symbol}", 600, make)
