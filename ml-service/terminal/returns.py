"""DVD and CACS (dividends and splits) and TRA, COMP and G (returns), from
Yahoo's price history. Yahoo's adjusted close folds dividends back in, so
total return = adjusted close; price return = plain close. Both are
already split-adjusted."""

import asyncio
from datetime import date, datetime, timezone

from . import web

CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
YEAR = 365.25

PERIODS = {"1m": 30, "3m": 91, "1y": 365, "3y": 3 * 365, "5y": 5 * 365, "10y": 10 * 365}


def _day(t: int) -> date:
    return datetime.fromtimestamp(t, tz=timezone.utc).date()


def parse_history(payload: dict) -> dict:
    """Closes, adjusted closes, dividends and splits from one chart reply."""
    res = payload["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    adj = (res["indicators"].get("adjclose") or [{}])[0].get("adjclose") or q.get("close") or []
    rows = [(_day(t), c, a) for t, c, a in zip(res.get("timestamp") or [], q.get("close") or [], adj)
            if c and a]
    ev = res.get("events") or {}
    dividends = sorted((_day(int(d["date"])), float(d["amount"])) for d in (ev.get("dividends") or {}).values())
    splits = sorted((_day(int(s["date"])), float(s["numerator"]), float(s["denominator"]))
                    for s in (ev.get("splits") or {}).values())
    return {"rows": rows, "dividends": dividends, "splits": splits, "currency": res["meta"].get("currency")}


def _on_or_before(rows, day: date):
    best = None
    for r in rows:
        if r[0] > day:
            break
        best = r
    return best


def period_returns(rows: list[tuple[date, float, float]]) -> dict:
    """Price and total return over each period ending at the last row.
    Periods of a year or more are also given per year."""
    if len(rows) < 2:
        return {}
    end_day, end_close, end_adj = rows[-1]
    out = {}
    starts = {k: date.fromordinal(end_day.toordinal() - d) for k, d in PERIODS.items()}
    starts["ytd"] = date(end_day.year - 1, 12, 31)
    for key, start in starts.items():
        r = _on_or_before(rows, start)
        # no row that old, or history starts well inside the period
        if r is None or (key != "ytd" and (end_day - r[0]).days < PERIODS[key] - 10):
            out[key] = None
            continue
        price = end_close / r[1] - 1
        total = end_adj / r[2] - 1
        years = (end_day - r[0]).days / YEAR
        out[key] = {
            "price_pct": round(price * 100, 2), "total_pct": round(total * 100, 2),
            "income_pct": round((total - price) * 100, 2),
            "per_year_pct": round(((1 + total) ** (1 / years) - 1) * 100, 2) if years >= 0.99 else None,
        }
    return out


def dividend_summary(dividends: list[tuple[date, float]], last_close: float | None, today: date) -> dict:
    """Trailing yield, five-year growth and the run of years with a raise.

    Growth and the run use each complete year's closing rate (its last
    payment), not the year's total: a payment that slips across New Year
    puts 13 payments in one year and 11 in the next, and the totals would
    show a cut that never happened."""
    by_year: dict[int, float] = {}
    rate: dict[int, float] = {}
    for d, amount in dividends:
        by_year[d.year] = by_year.get(d.year, 0.0) + amount
        rate[d.year] = amount
    years = sorted(y for y in rate if y < today.year)
    trailing = sum(a for d, a in dividends if (today - d).days <= 365)
    growth = None
    if len(years) >= 6 and rate[years[-6]] > 0:
        growth = (rate[years[-1]] / rate[years[-6]]) ** (1 / 5) - 1
    streak = 0
    for a, b in zip(reversed(years[:-1]), reversed(years[1:])):
        if rate[b] > rate[a] * 1.0001:
            streak += 1
        else:
            break
    return {
        "trailing_12m": round(trailing, 4),
        "yield_pct": round(trailing / last_close * 100, 2) if last_close and trailing else None,
        "growth_5y_pct": round(growth * 100, 2) if growth is not None else None,
        "years_of_increases": streak,
        "by_year": [{"year": y, "total": round(by_year[y], 4), "rate": rate[y]} for y in sorted(by_year)],
    }


def dividend_changes(dividends: list[tuple[date, float]]) -> list[dict]:
    """Each payment that differs from the one before: raises and cuts."""
    out = []
    for (d0, a0), (d1, a1) in zip(dividends, dividends[1:]):
        if a0 > 0 and abs(a1 / a0 - 1) > 0.005:
            out.append({"date": d1.isoformat(), "from": a0, "to": a1, "change_pct": round((a1 / a0 - 1) * 100, 2)})
    return out


async def _history(c, symbol: str, span: str, interval: str) -> dict:
    r = await c.get(CHART.format(symbol=symbol),
                    params={"range": span, "interval": interval, "events": "div,split"})
    r.raise_for_status()
    return parse_history(r.json())


async def dividends(symbol: str) -> dict:
    """Yahoo's full-history reply drops most dividends (for KO: 169 events
    with a 20-year hole), while a 10-year reply has every one. So payments
    come from 10 years and splits, which the full reply keeps, from all."""
    async def make():
        async with web.client() as c:
            h, full = await asyncio.gather(_history(c, symbol, "10y", "1wk"), _history(c, symbol, "max", "3mo"))
        h["splits"] = full["splits"]
        last = h["rows"][-1][1] if h["rows"] else None
        today = date.today()
        return {
            "symbol": symbol, "currency": h["currency"], "years_covered": 10,
            "payments": [{"date": d.isoformat(), "amount": a} for d, a in reversed(h["dividends"][-40:])],
            "summary": dividend_summary(h["dividends"], last, today),
            "changes": list(reversed(dividend_changes(h["dividends"])))[:30],
            "splits": [{"date": d.isoformat(), "ratio": f"{n:g}:{m:g}"} for d, n, m in reversed(h["splits"])],
        }
    return await web.cached(f"dvd:{symbol}", 6 * 3600, make)


def growth_of_100(rows: list[tuple[date, float, float]], since: date, total: bool) -> list[dict]:
    """The path of 100 invested at `since`, weekly points."""
    kept = [r for r in rows if r[0] >= since]
    if not kept:
        return []
    base = kept[0][2] if total else kept[0][1]
    out, last_week = [], None
    for d, close, adj in kept:
        week = d.isocalendar()[:2]
        if week != last_week or d == kept[-1][0]:
            out.append({"t": d.isoformat(), "v": round((adj if total else close) / base * 100, 2)})
            last_week = week
    return out


SPANS = {"1y": 365, "3y": 3 * 365, "5y": 5 * 365, "10y": 10 * 365}


async def compare(symbols: list[str], span: str = "5y") -> dict:
    """Period returns for each symbol, and growth of 100 over `span`."""
    async def make():
        async with web.client() as c:
            got = await asyncio.gather(*(_history(c, s, "10y", "1d") for s in symbols), return_exceptions=True)
        today = date.today()
        since = date.fromordinal(today.toordinal() - SPANS[span])
        out = []
        for s, h in zip(symbols, got):
            if isinstance(h, Exception) or not h["rows"]:
                out.append({"symbol": s, "missing": True})
                continue
            start = max(since, h["rows"][0][0])
            out.append({
                "symbol": s, "currency": h["currency"], "periods": period_returns(h["rows"]),
                "total": growth_of_100(h["rows"], start, True), "price": growth_of_100(h["rows"], start, False),
            })
        return {"span": span, "series": out}
    return await web.cached(f"cmp:{','.join(symbols)}:{span}", 1800, make)
