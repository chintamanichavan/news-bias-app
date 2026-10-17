"""Daily closes from Yahoo's chart API, and "how much has it moved since"."""

import asyncio
from datetime import date, datetime, timezone

from . import web

CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

# lookback name -> calendar days; "ytd" is handled on its own
LOOKBACKS = {"1w": 7, "1m": 30, "3m": 91, "1y": 365}


def parse_chart(payload: dict) -> list[tuple[date, float]]:
    """(day, close) pairs, oldest first, days without a close dropped."""
    res = payload["chart"]["result"][0]
    out = []
    for t, c in zip(res.get("timestamp") or [], res["indicators"]["quote"][0].get("close") or []):
        if c:
            out.append((datetime.fromtimestamp(t, tz=timezone.utc).date(), float(c)))
    return out


def close_on_or_before(series: list[tuple[date, float]], day: date) -> float | None:
    best = None
    for d, c in series:
        if d > day:
            break
        best = c
    return best


def moves(series: list[tuple[date, float]]) -> dict[str, float | None]:
    """Percent change of the last close since 1 day, 1 week, 1 month,
    3 months, the start of the year, and 1 year ago."""
    if len(series) < 2:
        return {}
    last_day, last = series[-1]
    out = {"1d": (last / series[-2][1] - 1) * 100}
    for key, days in LOOKBACKS.items():
        old = close_on_or_before(series, date.fromordinal(last_day.toordinal() - days))
        out[key] = (last / old - 1) * 100 if old else None
    start = close_on_or_before(series, date(last_day.year - 1, 12, 31))
    out["ytd"] = (last / start - 1) * 100 if start else None
    return {k: (round(v, 3) if v is not None else None) for k, v in out.items()}


async def fetch_many(symbols: list[str], span: str = "2y", parallel: int = 6) -> dict[str, list[tuple[date, float]]]:
    """Daily closes for each symbol; a symbol that fails maps to []."""
    gate = asyncio.Semaphore(parallel)

    async def one(c, s):
        async with gate:
            try:
                r = await c.get(CHART.format(symbol=s), params={"range": span, "interval": "1d"})
                r.raise_for_status()
                return s, parse_chart(r.json())
            except Exception:
                return s, []

    async with web.client() as c:
        return dict(await asyncio.gather(*(one(c, s) for s in symbols)))
