"""ECO (economic release calendar) and ECST (economic statistics).

Calendar sources: the Fed's FOMC page, BEA's release schedule and the
Census Bureau's economic indicator calendar. The Bureau of Labor Statistics
publishes CPI and jobs dates only on bls.gov, which refuses automated
requests, so those dates are missing; the screen says so.

Statistics come from the BLS public data API (no key). Without a key it
allows 25 requests a day, so the answer is kept on disk for 12 hours and a
restart does not spend another request.
"""

import json
import re
import time
from datetime import date, datetime
from pathlib import Path

from . import rates, web

BEA = "https://www.bea.gov/news/schedule"
CENSUS = "https://www.census.gov/economic-indicators/calendar-listview-{year}.html"
BLS = "https://api.bls.gov/publicAPI/v1/timeseries/data/"
BLS_CACHE = Path(__file__).resolve().parent.parent / "data" / "terminal_bls.json"
BLS_TTL = 12 * 3600

MONTH_NUMBER = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"], 1)}


def _text(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()


# ── calendar ─────────────────────────────────────────────────────────────────

def parse_bea(html: str) -> list[dict]:
    """BEA's schedule: a "Year YYYY" header over rows of "October 29",
    "8:30 AM" and a release title."""
    out = []
    for table in re.findall(r"<table.*?</table>", html, flags=re.S):
        year_m = re.search(r"Year (\d{4})", table)
        if not year_m:
            continue
        year = int(year_m.group(1))
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table, flags=re.S):
            day_m = re.search(r'class="release-date">\s*([A-Z][a-z]+) (\d{1,2})\s*<', row)
            title_m = re.search(r'class="release-title[^"]*"[^>]*>(.*?)</td>', row, flags=re.S)
            if not day_m or not title_m:
                continue
            time_m = re.search(r"(\d{1,2}:\d{2} [AP]M)", row)
            out.append({
                "date": date(year, MONTH_NUMBER[day_m.group(1)], int(day_m.group(2))).isoformat(),
                "time": time_m.group(1) if time_m else None,
                "release": _text(title_m.group(1)),
                "source": "BEA",
            })
    return out


def parse_census(html: str) -> list[dict]:
    """Census rows carry their exact moment as sorttable_customkey
    YYYYMMDDhhmm next to the indicator name and the period covered."""
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", html, flags=re.S):
        key = re.search(r'sorttable_customkey="(\d{12})"', row)
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, flags=re.S)
        if not key or len(cells) < 4:
            continue
        when = datetime.strptime(key.group(1), "%Y%m%d%H%M")
        out.append({
            "date": when.date().isoformat(),
            "time": f"{when.hour % 12 or 12}:{when.minute:02d} {'AM' if when.hour < 12 else 'PM'}",
            "release": f"{_text(cells[0])} ({_text(cells[3])})",
            "source": "Census",
        })
    return out


def fomc_events(meetings: list[date]) -> list[dict]:
    return [{"date": d.isoformat(), "time": "2:00 PM", "release": "FOMC rate decision", "source": "Fed"}
            for d in meetings]


def upcoming(events: list[dict], today: date, days: int) -> list[dict]:
    """Events from today through `days` ahead, in time order, with a
    release listed by two agencies kept once."""
    end = date.fromordinal(today.toordinal() + days)
    seen, out = set(), []
    for e in sorted(events, key=lambda e: (e["date"], _minutes(e["time"]), e["release"])):
        # a joint release is listed by both agencies with the period written
        # differently: "Trade ... (September 2026)" and "Trade ..., September 2026"
        key = (e["date"], re.sub(r"[(,].*$", "", e["release"]).strip().lower())
        if today.isoformat() <= e["date"] <= end.isoformat() and key not in seen:
            seen.add(key)
            out.append(e)
    return out


def _minutes(t: str | None) -> int:
    if not t:
        return 24 * 60
    clock = datetime.strptime(t, "%I:%M %p")
    return clock.hour * 60 + clock.minute


async def calendar(days: int = 45) -> dict:
    """Releases from today through `days` ahead. Every event the sources
    list is cached once; the window is applied per request."""
    async def make():
        today = date.today()
        events, failed = [], []
        async with web.client() as c:
            for name, url, parse in (
                ("BEA", BEA, parse_bea),
                ("Census", CENSUS.format(year=today.year), parse_census),
                ("Census", CENSUS.format(year=today.year + 1), parse_census),
            ):
                try:
                    r = await c.get(url)
                    r.raise_for_status()
                    events += parse(r.text)
                except Exception:
                    failed.append(name)
            try:
                events += fomc_events(await rates._fomc(c))
            except Exception:
                failed.append("Fed")
        return {"events": events,
                "unavailable": sorted(set(failed)) + ["BLS (CPI, jobs, PPI): bls.gov refuses automated requests"]}
    got = await web.cached("eco", 6 * 3600, make)
    return {"events": upcoming(got["events"], date.today(), days), "days": days,
            "unavailable": got["unavailable"]}


# ── statistics ───────────────────────────────────────────────────────────────

# series id -> (name, how to read it, unit)
#   "level": the latest value; "yoy": change from the same month a year
#   earlier; "mom": change from the month before; "diff": the month's change
STATS = {
    "CUUR0000SA0": ("Consumer prices (CPI)", "yoy", "% a year"),
    "CUUR0000SA0L1E": ("Core CPI, less food and energy", "yoy", "% a year"),
    "CUSR0000SA0": ("CPI, month on month", "mom", "% a month"),
    "WPUFD4": ("Producer prices, final demand", "yoy", "% a year"),
    "LNS14000000": ("Unemployment rate", "level", "%"),
    "CES0000000001": ("Nonfarm payrolls, change", "diff", "thousand jobs"),
    "CES0500000003": ("Average hourly earnings", "yoy", "% a year"),
    "LNS11300000": ("Labour force participation", "level", "%"),
    "JTS000000000000000JOL": ("Job openings (JOLTS)", "level", "thousand"),
}


def _monthly(series: dict) -> list[tuple[int, int, float]]:
    """(year, month, value) oldest first; annual averages (M13) dropped."""
    out = []
    for d in series.get("data", []):
        p = d.get("period", "")
        if p.startswith("M") and p != "M13":
            try:
                out.append((int(d["year"]), int(p[1:]), float(d["value"])))
            except ValueError:
                continue
    return sorted(out)


def _reading(points: list[tuple[int, int, float]], how: str, i: int) -> float | None:
    """The statistic as of points[i]."""
    if i < 0:
        return None
    y, m, v = points[i]
    if how == "level":
        return v
    if how in ("mom", "diff"):
        if i == 0:
            return None
        prev = points[i - 1][2]
        return (v / prev - 1) * 100 if how == "mom" else v - prev
    year_ago = next((p[2] for p in points if p[0] == y - 1 and p[1] == m), None)
    return (v / year_ago - 1) * 100 if year_ago else None


def stats_rows(payload: dict) -> list[dict]:
    by_id = {s["seriesID"]: s for s in payload.get("Results", {}).get("series", [])}
    rows = []
    for sid, (name, how, unit) in STATS.items():
        points = _monthly(by_id.get(sid, {}))
        if not points:
            continue
        y, m, _ = points[-1]
        latest, prior = _reading(points, how, len(points) - 1), _reading(points, how, len(points) - 2)
        rows.append({
            "series": sid, "name": name, "unit": unit, "period": f"{y}-{m:02d}",
            "latest": round(latest, 2) if latest is not None else None,
            "prior": round(prior, 2) if prior is not None else None,
        })
    return rows


async def _bls_payload() -> dict:
    try:
        saved = json.loads(BLS_CACHE.read_text())
        if time.time() - saved["fetched_at"] < BLS_TTL:
            return saved["payload"]
    except (OSError, ValueError, KeyError):
        saved = None
    async with web.client() as c:
        r = await c.post(BLS, json={"seriesid": list(STATS)},
                         headers={"User-Agent": "Artha Research research@artha.app"})
        r.raise_for_status()
        payload = r.json()
    if payload.get("status") != "REQUEST_SUCCEEDED":
        if saved:
            return saved["payload"]   # over the daily limit: keep the last answer
        raise RuntimeError("; ".join(payload.get("message") or ["BLS request failed"]))
    BLS_CACHE.parent.mkdir(parents=True, exist_ok=True)
    BLS_CACHE.write_text(json.dumps({"fetched_at": time.time(), "payload": payload}))
    return payload


async def statistics() -> dict:
    async def make():
        rows = stats_rows(await _bls_payload())
        market = []
        try:
            cv = await rates.curve()
            y = cv["curves"][0]["yields"] if cv["curves"] else {}
            for tenor in ("2Y", "10Y"):
                if tenor in y:
                    market.append({"series": f"UST{tenor}", "name": f"{tenor} Treasury yield", "unit": "%",
                                   "period": cv["curves"][0]["date"], "latest": y[tenor], "prior": None})
        except Exception:
            pass
        return {"rows": rows + market}
    return await web.cached("ecst", 3600, make)
