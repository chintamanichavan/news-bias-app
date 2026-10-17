"""Yahoo's per-company data (quoteSummary). The endpoint wants a session
cookie and a "crumb" token, fetched once and reused for half an hour."""

import time

from . import web

SUMMARY = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/{symbol}"
SESSION_SECONDS = 1800

MODULES = ",".join([
    "earningsTrend", "earningsHistory", "earnings", "calendarEvents", "recommendationTrend",
    "upgradeDowngradeHistory", "financialData", "institutionOwnership", "fundOwnership",
    "majorHoldersBreakdown", "insiderHolders", "insiderTransactions", "netSharePurchaseActivity",
    "assetProfile", "defaultKeyStatistics", "price",
])

_session: dict = {"crumb": None, "cookies": {}, "at": 0.0}


async def _crumb(c) -> str | None:
    if _session["crumb"] and time.time() - _session["at"] < SESSION_SECONDS:
        c.cookies.update(_session["cookies"])
        return _session["crumb"]
    await c.get("https://fc.yahoo.com")
    r = await c.get("https://query1.finance.yahoo.com/v1/test/getcrumb")
    crumb = r.text.strip()
    if not crumb or "<" in crumb:
        return None
    _session.update(crumb=crumb, cookies=dict(c.cookies), at=time.time())
    return crumb


class NotFound(Exception):
    pass


async def summary(symbol: str) -> dict:
    """Every module the company screens read, in one request."""
    async def make():
        async with web.client() as c:
            crumb = await _crumb(c)
            params = {"modules": MODULES, **({"crumb": crumb} if crumb else {})}
            r = await c.get(SUMMARY.format(symbol=symbol), params=params)
            if r.status_code == 404:
                raise NotFound(f"Yahoo has no company data for {symbol}.")
            r.raise_for_status()
            result = r.json()["quoteSummary"]["result"]
            if not result:
                raise NotFound(f"Yahoo has no company data for {symbol}.")
            return result[0]
    return await web.cached(f"qs:{symbol}", 1800, make)
