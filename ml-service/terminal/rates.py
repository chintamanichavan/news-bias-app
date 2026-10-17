"""GC (yield curve), BTMM (Treasury and money markets) and WIRP (what fed
funds futures say about the next Fed meetings).

Sources, all official or exchange data and keyless:
- US Treasury daily par yield curve (CSV, one file per year)
- New York Fed reference rates: EFFR, OBFR, SOFR, BGCR, TGCR
- Federal Reserve FOMC calendar page, for meeting dates
- CBOT 30-day fed funds futures (ZQ) by contract month, through Yahoo
"""

import asyncio
import calendar
import csv
import io
import re
from datetime import date, datetime, timedelta

from . import web

TREASURY = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
            "daily-treasury-rates.csv/{year}/all")
NYFED = "https://markets.newyorkfed.org/api/rates/all/latest.json"
FOMC_PAGE = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

# Treasury column -> (label, years to maturity)
TENORS = {
    "1 Mo": ("1M", 1 / 12), "2 Mo": ("2M", 2 / 12), "3 Mo": ("3M", 0.25), "4 Mo": ("4M", 4 / 12),
    "6 Mo": ("6M", 0.5), "1 Yr": ("1Y", 1), "2 Yr": ("2Y", 2), "3 Yr": ("3Y", 3), "5 Yr": ("5Y", 5),
    "7 Yr": ("7Y", 7), "10 Yr": ("10Y", 10), "20 Yr": ("20Y", 20), "30 Yr": ("30Y", 30),
}

MONTH_CODES = "FGHJKMNQUVXZ"   # futures month letters, January first

MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


# ── Treasury curve ───────────────────────────────────────────────────────────

def parse_treasury_csv(text: str) -> list[dict]:
    """Rows of {date, yields: {label: pct}}, oldest first. Tenors missing on
    a day (new issues, holidays) are simply absent."""
    rows = []
    for rec in csv.DictReader(io.StringIO(text)):
        try:
            day = datetime.strptime(rec["Date"], "%m/%d/%Y").date()
        except (KeyError, ValueError):
            continue
        yields = {}
        for col, (label, _) in TENORS.items():
            v = (rec.get(col) or "").strip()
            if v:
                yields[label] = float(v)
        if yields:
            rows.append({"date": day, "yields": yields})
    rows.sort(key=lambda r: r["date"])
    return rows


def on_or_before(rows: list[dict], day: date) -> dict | None:
    """The last row on or before `day` (rows oldest first)."""
    best = None
    for r in rows:
        if r["date"] > day:
            break
        best = r
    return best


def curve_view(rows: list[dict]) -> dict:
    """Today's curve beside one week, one month and one year earlier, plus
    the spreads people watch."""
    if not rows:
        return {"tenors": [], "curves": [], "spreads": {}}
    latest = rows[-1]
    marks = [("Latest", latest)]
    for label, days in (("1 week ago", 7), ("1 month ago", 30), ("1 year ago", 365)):
        r = on_or_before(rows, latest["date"] - timedelta(days=days))
        if r:
            marks.append((label, r))
    y = latest["yields"]

    def spread(a: str, b: str) -> float | None:
        return round((y[b] - y[a]) * 100) if a in y and b in y else None

    return {
        "tenors": [{"label": label, "years": years} for label, years in TENORS.values()],
        "curves": [{"label": name, "date": r["date"].isoformat(), "yields": r["yields"]} for name, r in marks],
        "spreads": {"3M10Y_bp": spread("3M", "10Y"), "2Y10Y_bp": spread("2Y", "10Y"),
                    "5Y30Y_bp": spread("5Y", "30Y")},
    }


async def _treasury_year(c, year: int) -> list[dict]:
    r = await c.get(TREASURY.format(year=year), params={
        "type": "daily_treasury_yield_curve", "field_tdr_date_value": str(year),
        "page": "", "_format": "csv"})
    r.raise_for_status()
    return parse_treasury_csv(r.text)


async def curve() -> dict:
    async def make():
        year = date.today().year
        async with web.client() as c:
            this, last = await asyncio.gather(_treasury_year(c, year), _treasury_year(c, year - 1))
        return curve_view(last + this)
    return await web.cached("curve", 3600, make)


# ── New York Fed reference rates ─────────────────────────────────────────────

def parse_nyfed(payload: dict) -> dict:
    """{type: {rate, date, ...}} for the overnight rates, and the Fed's
    target range taken from the EFFR record."""
    rates, target = {}, None
    for r in payload.get("refRates", []):
        kind = r.get("type")
        if kind in ("EFFR", "OBFR", "SOFR", "BGCR", "TGCR") and r.get("percentRate") is not None:
            rates[kind] = {"rate": r["percentRate"], "date": r.get("effectiveDate"),
                           "volume_bn": r.get("volumeInBillions")}
            if kind == "EFFR" and r.get("targetRateFrom") is not None:
                target = {"low": r["targetRateFrom"], "high": r["targetRateTo"]}
    return {"rates": rates, "target": target}


async def _nyfed(c) -> dict:
    r = await c.get(NYFED)
    r.raise_for_status()
    return parse_nyfed(r.json())


# ── FOMC meeting dates ───────────────────────────────────────────────────────

_MEETING = re.compile(
    r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*"
    r"(?:/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)?\s+(\d{1,2})-(\d{1,2})")


def parse_fomc(text: str) -> list[date]:
    """Decision days (the second day of each two-day meeting) from the Fed's
    calendar page with tags stripped. A meeting that crosses into the next
    month ("April/May 30-1") ends in that next month. Dates in a year must
    rise; anything after a fall is text from another section."""
    out = []
    for year_s, block in re.findall(r"(\d{4}) FOMC Meetings(.*?)(?=\d{4} FOMC Meetings|$)", text):
        year, last = int(year_s), None
        for mon, d1, d2 in _MEETING.findall(block):
            month = MONTHS[mon] + (1 if int(d2) < int(d1) else 0)
            if month > 12:
                continue
            day = date(year, month, int(d2))
            if last and day <= last:
                break
            out.append(day)
            last = day
    return sorted(set(out))


async def _fomc(c) -> list[date]:
    async def make():
        r = await c.get(FOMC_PAGE)
        r.raise_for_status()
        return parse_fomc(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", r.text)))
    return await web.cached("fomc", 86400, make)


# ── Fed funds futures: the implied path ──────────────────────────────────────

def zq_symbol(year: int, month: int) -> str:
    return f"ZQ{MONTH_CODES[month - 1]}{year % 100:02d}.CBT"


def months_ahead(start: date, n: int) -> list[tuple[int, int]]:
    y, m = start.year, start.month
    out = []
    for _ in range(n):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def implied_path(today: date, effr: float, prices: dict[tuple[int, int], float],
                 meetings: list[date]) -> list[dict]:
    """What the futures imply the effective rate will be after each coming
    meeting, by the method CME publishes for FedWatch.

    A contract settles on the month's average effective rate: rate = 100 -
    price. In a month with a meeting on day d of N, the first d days are at
    the old rate and the rest at the new one, so new = (N*avg - d*old)/(N-d).
    When a meeting falls in the last week of its month (N-d < 7) that split
    is too thin to trust, and the next month's average is the new rate.
    A month without a meeting is a clean read of the rate going forward.
    The path stops at a late-month meeting with no clean month after it.
    """
    by_month = {(m.year, m.month): m for m in meetings if m >= today}
    rate = effr
    path = []
    months = sorted(prices)
    for i, ym in enumerate(months):
        avg = 100 - prices[ym]
        meeting = by_month.get(ym)
        if meeting is None:
            # this month's price mixes days already fixed (maybe around a
            # meeting just held) with days to come; the known rate is better
            rate = effr if ym == (today.year, today.month) else avg
            continue
        n = calendar.monthrange(*ym)[1]
        d = meeting.day
        nxt = months[i + 1] if i + 1 < len(months) else None
        if n - d < 7:
            if not nxt or nxt in by_month:
                break   # too few days left to read, and no clean month after
            after = 100 - prices[nxt]
        else:
            after = (n * avg - d * rate) / (n - d)
        path.append({
            "meeting": meeting.isoformat(),
            "rate_before": round(rate, 3),
            "rate_after": round(after, 3),
            "change_bp": round((after - rate) * 100, 1),
            "since_today_bp": round((after - effr) * 100, 1),
            # how many quarter-point moves the futures price by then
            "moves_priced": round((after - effr) / 0.25, 2),
        })
        rate = after
    return path


async def _zq_prices(c, months: list[tuple[int, int]]) -> dict[tuple[int, int], float]:
    async def one(ym):
        try:
            r = await c.get(CHART.format(symbol=zq_symbol(*ym)), params={"range": "5d", "interval": "1d"})
            r.raise_for_status()
            price = r.json()["chart"]["result"][0]["meta"].get("regularMarketPrice")
            return ym, float(price) if price else None
        except Exception:
            return ym, None
    pairs = await asyncio.gather(*(one(ym) for ym in months))
    return {ym: p for ym, p in pairs if p}


async def money() -> dict:
    """BTMM: overnight rates, the target range, bills and notes from the
    curve, and the front fed funds future."""
    async def make():
        async with web.client() as c:
            fed = await _nyfed(c)
            zq = await _zq_prices(c, months_ahead(date.today(), 3))
        cv = await curve()
        latest = cv["curves"][0] if cv["curves"] else {"yields": {}, "date": None}
        bills = {k: latest["yields"].get(k) for k in ("1M", "2M", "3M", "4M", "6M", "1Y")}
        notes = {k: latest["yields"].get(k) for k in ("2Y", "5Y", "10Y", "30Y")}
        futures = [{"contract": zq_symbol(*ym), "month": f"{ym[0]}-{ym[1]:02d}",
                    "price": p, "implied_rate": round(100 - p, 3)} for ym, p in sorted(zq.items())]
        return {**fed, "curve_date": latest["date"], "bills": bills, "notes": notes,
                "fed_funds_futures": futures, "spreads": cv["spreads"]}
    return await web.cached("money", 900, make)


async def wirp() -> dict:
    async def make():
        today = date.today()
        async with web.client() as c:
            fed = await _nyfed(c)
            meetings = await _fomc(c)
            prices = await _zq_prices(c, months_ahead(today, 13))
        effr = fed["rates"].get("EFFR", {}).get("rate")
        if effr is None:
            raise RuntimeError("no effective fed funds rate from the New York Fed")
        return {
            "effr": effr, "effr_date": fed["rates"]["EFFR"]["date"], "target": fed["target"],
            "path": implied_path(today, effr, prices, meetings),
            "contracts": len(prices),
        }
    return await web.cached("wirp", 600, make)
