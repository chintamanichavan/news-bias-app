"""WCRS (world currency rates against the dollar) and FXC (cross rates).

Every rate is fetched one way, as units of the currency per US dollar
(Yahoo's "EUR=X"), and turned into market convention only for display, so
the arithmetic never mixes the two directions.
"""

import asyncio
from datetime import date, datetime, timezone

from . import web

CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

CURRENCIES = {
    "EUR": "Euro", "JPY": "Japanese yen", "GBP": "British pound", "CHF": "Swiss franc",
    "CAD": "Canadian dollar", "AUD": "Australian dollar", "NZD": "New Zealand dollar",
    "SEK": "Swedish krona", "NOK": "Norwegian krone", "CNY": "Chinese yuan",
    "HKD": "Hong Kong dollar", "SGD": "Singapore dollar", "INR": "Indian rupee",
    "KRW": "South Korean won", "MXN": "Mexican peso", "BRL": "Brazilian real",
    "ZAR": "South African rand", "TRY": "Turkish lira",
}

# Quoted as dollars per unit (EURUSD); everything else as units per dollar (USDJPY).
USD_PER_UNIT = {"EUR", "GBP", "AUD", "NZD"}

G10 = ["USD", "EUR", "JPY", "GBP", "CHF", "CAD", "AUD", "NZD", "SEK", "NOK"]

LOOKBACK = {"1d": 1, "1w": 7, "1m": 30, "1y": 365}


def strength_change(old_per_usd: float, new_per_usd: float) -> float:
    """How much the currency gained against the dollar, in percent. Fewer
    units per dollar means a stronger currency."""
    return (old_per_usd / new_per_usd - 1) * 100


def convention(code: str, per_usd: float) -> tuple[str, float]:
    """The pair name and rate as a trader would quote it."""
    if code in USD_PER_UNIT:
        return f"{code}USD", 1 / per_usd
    return f"USD{code}", per_usd


def cross_matrix(per_usd: dict[str, float], codes: list[str]) -> list[list[float | None]]:
    """matrix[i][j] = units of codes[j] for one unit of codes[i]."""
    rates = {**per_usd, "USD": 1.0}
    return [[(rates[b] / rates[a]) if a in rates and b in rates else None for b in codes] for a in codes]


def close_on_or_before(series: list[tuple[date, float]], day: date) -> float | None:
    best = None
    for d, c in series:
        if d > day:
            break
        best = c
    return best


def currency_row(code: str, series: list[tuple[date, float]]) -> dict | None:
    """One WCRS line from a currency's daily units-per-dollar closes."""
    if len(series) < 2:
        return None
    last_day, last = series[-1]
    row = {"code": code, "name": CURRENCIES[code]}
    row["pair"], row["rate"] = convention(code, last)
    for key, days in LOOKBACK.items():
        if key == "1d":
            old = series[-2][1]
        else:
            old = close_on_or_before(series, date.fromordinal(last_day.toordinal() - days))
        row[f"ch_{key}"] = round(strength_change(old, last), 3) if old else None
    start = close_on_or_before(series, date(last_day.year - 1, 12, 31))
    row["ch_ytd"] = round(strength_change(start, last), 3) if start else None
    row["as_of"] = last_day.isoformat()
    return row


def parse_chart(payload: dict) -> list[tuple[date, float]]:
    res = payload["chart"]["result"][0]
    out = []
    for t, c in zip(res.get("timestamp") or [], res["indicators"]["quote"][0].get("close") or []):
        if c:
            out.append((datetime.fromtimestamp(t, tz=timezone.utc).date(), float(c)))
    return out


async def rates() -> dict:
    async def make():
        gate = asyncio.Semaphore(6)

        async def one(c, code):
            async with gate:
                try:
                    r = await c.get(CHART.format(symbol=f"{code}=X"), params={"range": "2y", "interval": "1d"})
                    r.raise_for_status()
                    return code, parse_chart(r.json())
                except Exception:
                    return code, []

        async with web.client() as c:
            got = dict(await asyncio.gather(*(one(c, code) for code in CURRENCIES)))
        rows = [row for code in CURRENCIES if (row := currency_row(code, got[code]))]
        per_usd = {code: s[-1][1] for code, s in got.items() if s}
        return {
            "currencies": rows,
            "cross": {"codes": G10, "matrix": cross_matrix(per_usd, G10)},
            "missing": [code for code in CURRENCIES if not got[code]],
        }
    return await web.cached("fx", 300, make)
