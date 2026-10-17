"""ACDR (earnings calendar), SURP (earnings surprises), EA (the season by
sector), CACT (dividend and split calendar) and CDR (US market holidays).

Earnings, dividends and splits come from Nasdaq's public calendars, one
request per day. Holidays follow the NYSE's published rules rather than a
downloaded list, so they reach any year.
"""

import asyncio
import statistics
from datetime import date, timedelta

from . import members, web
from .ipos import HEADERS

NASDAQ = "https://api.nasdaq.com/api/calendar/{kind}"


def money(text) -> float | None:
    """'$4.60' → 4.6, '($0.12)' → -0.12, '' or 'N/A' → None."""
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return float(text)
    t = text.strip().replace("$", "").replace(",", "")
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()")
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v


def parse_earnings(payload: dict, day: str) -> list[dict]:
    rows = ((payload.get("data") or {}).get("rows")) or []
    out = []
    for r in rows:
        eps, est = money(r.get("eps")), money(r.get("epsForecast"))
        out.append({"date": day, "symbol": r.get("symbol"), "name": r.get("name"), "time": {
            "time-pre-market": "before open", "time-after-hours": "after close"}.get(r.get("time"), ""),
            "quarter": r.get("fiscalQuarterEnding"), "eps": eps, "estimate": est, "estimates": int(r["noOfEsts"]) if (r.get("noOfEsts") or "").isdigit() else None,
            "surprise_pct": money(r.get("surprise")) if r.get("surprise") not in (None, "", "N/A") else None,
            "market_cap": money(r.get("marketCap"))})
    return out


def business_days(start: date, n: int, step: int = 1) -> list[date]:
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=step)
    return out


async def _day(kind: str, day: date) -> dict:
    async def make():
        async with web.client() as c:
            r = await c.get(NASDAQ.format(kind=kind), params={"date": day.isoformat()}, headers=HEADERS)
            r.raise_for_status()
            return r.json()
    # past days do not change; today and later can
    return await web.cached(f"nqcal:{kind}:{day}", 86400 if day < date.today() else 1800, make)


async def earnings_days(days: list[date]) -> list[dict]:
    got = await asyncio.gather(*(_day("earnings", d) for d in days), return_exceptions=True)
    rows = []
    for d, g in zip(days, got):
        if not isinstance(g, Exception):
            rows.extend(parse_earnings(g, d.isoformat()))
    return rows


async def upcoming(days: int = 10) -> dict:
    rows = await earnings_days(business_days(date.today(), days))
    rows.sort(key=lambda r: (r["date"], -(r["market_cap"] or 0)))
    return {"rows": rows}


async def surprises(days: int = 10) -> dict:
    rows = await earnings_days(business_days(date.today() - timedelta(days=1), days, step=-1))
    reported = [r for r in rows if r["eps"] is not None and r["estimate"] is not None]
    reported.sort(key=lambda r: (r["date"], r["market_cap"] or 0), reverse=True)
    return {"rows": reported}


def scorecard(rows: list[dict], sector_of: dict[str, str]) -> list[dict]:
    """Beats, misses and the median surprise by sector, for companies in the
    sector map that reported against an estimate."""
    by: dict[str, list[dict]] = {}
    for r in rows:
        s = sector_of.get((r["symbol"] or "").replace(".", "-"))
        if s and r["eps"] is not None and r["estimate"] is not None:
            by.setdefault(s, []).append(r)
    out = []
    for s, rs in by.items():
        surprises = [r["surprise_pct"] for r in rs if r["surprise_pct"] is not None]
        out.append({"sector": s, "reported": len(rs), "beat": sum(r["eps"] > r["estimate"] for r in rs),
                    "met": sum(r["eps"] == r["estimate"] for r in rs), "missed": sum(r["eps"] < r["estimate"] for r in rs),
                    "median_surprise_pct": statistics.median(surprises) if surprises else None})
    return sorted(out, key=lambda x: -x["reported"])


async def season(days: int = 30) -> dict:
    async def make():
        rows = await earnings_days(business_days(date.today() - timedelta(days=1), days, step=-1))
        sector_of = await members.sectors()
        card = scorecard(rows, sector_of)
        total = {k: sum(c[k] for c in card) for k in ("reported", "beat", "met", "missed")}
        return {"days": days, "sectors": card, "total": total}
    return await web.cached(f"season:{days}", 6 * 3600, make)


async def actions(days: int = 10) -> dict:
    dates = business_days(date.today(), days)
    divs = await asyncio.gather(*(_day("dividends", d) for d in dates), return_exceptions=True)
    rows = []
    for d, g in zip(dates, divs):
        if isinstance(g, Exception):
            continue
        for r in ((((g.get("data") or {}).get("calendar") or {}).get("rows")) or []):
            rows.append({"kind": "dividend", "date": d.isoformat(), "symbol": r.get("symbol"), "name": r.get("companyName"),
                         "amount": money(r.get("dividend_Rate")), "annual": money(r.get("indicated_Annual_Dividend")),
                         "pay_date": r.get("payment_Date"), "record_date": r.get("record_Date")})
    splits = await _day("splits", date.today())
    for r in (((splits.get("data") or {}).get("rows")) or []):
        m, d, y = (r.get("executionDate") or "1/1/1900").split("/")
        rows.append({"kind": "split", "date": f"{y}-{int(m):02d}-{int(d):02d}", "symbol": r.get("symbol"), "name": r.get("name"),
                     "ratio": r.get("ratio")})
    rows.sort(key=lambda r: (r["date"], r["kind"], r["symbol"] or ""))
    return {"rows": rows}


# ── US market holidays (NYSE rules) ──────────────────────────────────────────

def easter(y: int) -> date:
    """Gregorian Easter Sunday (the anonymous algorithm)."""
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    return date(y, month, (h + l - 7 * m + 114) % 31 + 1)


def nth_weekday(y: int, month: int, weekday: int, n: int) -> date:
    """n-th given weekday of a month (n = -1 for the last)."""
    if n > 0:
        d = date(y, month, 1)
        d += timedelta(days=(weekday - d.weekday()) % 7)
        return d + timedelta(weeks=n - 1)
    d = date(y + month // 12, month % 12 + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def observed(d: date) -> date | None:
    """Saturday holidays move to Friday, Sunday ones to Monday, except that
    a Saturday New Year's Day is not made up (the NYSE does not close on
    the last trading day of the year)."""
    if d.weekday() == 5:
        return None if (d.month, d.day) == (1, 1) else d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def holidays(y: int) -> list[dict]:
    named = [
        ("New Year's Day", date(y, 1, 1)), ("Martin Luther King Jr. Day", nth_weekday(y, 1, 0, 3)),
        ("Washington's Birthday", nth_weekday(y, 2, 0, 3)), ("Good Friday", easter(y) - timedelta(days=2)),
        ("Memorial Day", nth_weekday(y, 5, 0, -1)), ("Juneteenth", date(y, 6, 19)),
        ("Independence Day", date(y, 7, 4)), ("Labor Day", nth_weekday(y, 9, 0, 1)),
        ("Thanksgiving Day", nth_weekday(y, 11, 3, 4)), ("Christmas Day", date(y, 12, 25)),
    ]
    out = []
    for name, d in named:
        when = d if name == "Good Friday" else observed(d)
        if when and not (name == "Juneteenth" and y < 2022):
            out.append({"date": when.isoformat(), "name": name, "kind": "closed"})
    thanks = nth_weekday(y, 11, 3, 4)
    early = [("Day after Thanksgiving", thanks + timedelta(days=1)), ("Christmas Eve", date(y, 12, 24)),
             ("Day before Independence Day", date(y, 7, 3))]
    closed = {h["date"] for h in out}
    for name, d in early:
        if d.weekday() < 5 and d.isoformat() not in closed:
            out.append({"date": d.isoformat(), "name": name, "kind": "closes at 1pm"})
    return sorted(out, key=lambda h: h["date"])
