"""IPO: Nasdaq's calendar of priced, coming, filed and withdrawn offerings
for this month and next."""

import asyncio
from datetime import date

from . import web

CALENDAR = "https://api.nasdaq.com/api/ipo/calendar"
HEADERS = {"Accept": "application/json"}


def _rows(section: dict | None) -> list[dict]:
    if not section:
        return []
    return section.get("rows") or (section.get("upcomingTable") or {}).get("rows") or []


def _money(text: str | None) -> float | None:
    if not text:
        return None
    try:
        return float(text.replace("$", "").replace(",", ""))
    except ValueError:
        return None


def parse_calendar(payload: dict) -> dict[str, list[dict]]:
    data = payload.get("data") or {}
    out = {}
    for kind in ("priced", "upcoming", "filed", "withdrawn"):
        rows = []
        for r in _rows(data.get(kind)):
            rows.append({
                "symbol": r.get("proposedTickerSymbol") or None,
                "company": r.get("companyName"),
                "exchange": r.get("proposedExchange") or None,
                "price": r.get("proposedSharePrice") or None,
                "shares": r.get("sharesOffered") or None,
                "date": r.get("pricedDate") or r.get("expectedPriceDate") or r.get("filedDate") or r.get("withdrawDate"),
                "amount": _money(r.get("dollarValueOfSharesOffered")),
            })
        out[kind] = rows
    return out


def _months(today: date) -> list[str]:
    nxt = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
    return [f"{today.year}-{today.month:02d}", f"{nxt[0]}-{nxt[1]:02d}"]


async def calendar() -> dict:
    async def make():
        months = _months(date.today())
        async with web.client() as c:
            replies = await asyncio.gather(*(c.get(CALENDAR, params={"date": m}, headers=HEADERS) for m in months))
        merged: dict[str, list[dict]] = {"priced": [], "upcoming": [], "filed": [], "withdrawn": []}
        for r in replies:
            r.raise_for_status()
            for kind, rows in parse_calendar(r.json()).items():
                merged[kind] += rows
        return {"months": months, **merged}
    return await web.cached("ipo", 3600, make)
