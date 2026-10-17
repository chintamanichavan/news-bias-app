"""WB: world government bond yields, each country from its own official
source, all keyless.

- United States: Treasury par yield curve (shared with GC)
- Germany: Deutsche Bundesbank, yields on federal securities
- Euro area: ECB yield curve for AAA-rated governments (Svensson spot rates)
- United Kingdom: Bank of England nominal par yields (5, 10, 20 years)
- Japan: Ministry of Finance JGB benchmark yields
- Canada: Bank of Canada benchmark bond yields

Each publishes after its own close, so dates differ by a day here and there;
the screen shows each country's date.
"""

import asyncio
import csv
import io
from datetime import date, datetime

from . import rates, web

TENORS = ["2Y", "5Y", "10Y", "30Y"]

BUBA = ("https://api.statistiken.bundesbank.de/rest/data/BBSIS/"
        "D.I.ZAR.ZI.EUR.S1311.B.A604.R{t}XX.R.A.A._Z._Z.A?lastNObservations=10&format=csv")
ECB = ("https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_{t}?"
       "lastNObservations=10&format=csvdata")
BOE = ("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes"
       "&Datefrom={start}&Dateto=now&SeriesCodes=IUDSNPY,IUDMNPY,IUDLNPY&CSVF=TN&UsingCodes=Y")
MOF = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv"
BOC = ("https://www.bankofcanada.ca/valet/observations/"
       "BD.CDN.2YR.DQ.YLD,BD.CDN.5YR.DQ.YLD,BD.CDN.10YR.DQ.YLD,BD.CDN.LONG.DQ.YLD/csv?recent=10")

# A country's history: {iso date: {tenor: yield %}}, oldest first.
History = dict[str, dict[str, float]]


def parse_buba(text: str) -> list[tuple[str, float]]:
    """Bundesbank CSV: German header lines, then 'YYYY-MM-DD;3,45;'."""
    out = []
    for line in text.splitlines():
        parts = line.split(";")
        if len(parts) >= 2 and len(parts[0]) == 10 and parts[0][4] == "-" and parts[1].strip() not in ("", "."):
            out.append((parts[0], float(parts[1].replace(",", "."))))
    return out


def parse_ecb(text: str) -> list[tuple[str, float]]:
    return [(r["TIME_PERIOD"], float(r["OBS_VALUE"])) for r in csv.DictReader(io.StringIO(text)) if r.get("OBS_VALUE")]


def parse_boe(text: str) -> History:
    """5-, 10- and 20-year par yields; the 20-year stands in for 30 (the
    Bank's daily par series stop at 20 years)."""
    names = {"IUDSNPY": "5Y", "IUDMNPY": "10Y", "IUDLNPY": "30Y"}
    out: History = {}
    for r in csv.DictReader(io.StringIO(text)):
        day = datetime.strptime(r["DATE"], "%d %b %Y").date().isoformat()
        out[day] = {names[k]: float(v) for k, v in r.items() if k in names and v}
    return out


def parse_mof(text: str) -> History:
    lines = [l for l in text.splitlines() if l and l[0].isdigit()]
    header = next(l for l in text.splitlines() if l.startswith("Date,")).split(",")
    out: History = {}
    for line in lines:
        cells = line.split(",")
        day = datetime.strptime(cells[0], "%Y/%m/%d").date().isoformat()
        out[day] = {t: float(v) for t, v in zip(header[1:], cells[1:]) if t in TENORS and v not in ("", "-")}
    return out


def parse_boc(text: str) -> History:
    names = {"BD.CDN.2YR.DQ.YLD": "2Y", "BD.CDN.5YR.DQ.YLD": "5Y", "BD.CDN.10YR.DQ.YLD": "10Y",
             "BD.CDN.LONG.DQ.YLD": "30Y"}
    # the file opens with terms, series notes and then the observations table
    start = text.find('"date"')
    out: History = {}
    for r in csv.DictReader(io.StringIO(text[start:] if start >= 0 else "")):
        vals = {names[k]: float(v) for k, v in r.items() if k in names and v and v.strip()}
        if vals:
            out[r["date"]] = vals
    return out


def merge(series: dict[str, list[tuple[str, float]]]) -> History:
    out: History = {}
    for tenor, rows in series.items():
        for day, v in rows:
            out.setdefault(day, {})[tenor] = v
    return out


def summary(country: str, source: str, hist: History, note: str | None = None) -> dict:
    """The latest day with a 10-year yield, and the change from the day before."""
    days = sorted(d for d, v in hist.items() if "10Y" in v)
    if not days:
        return {"country": country, "source": source, "date": None, "yields": {}, "change_10y_bp": None, "note": note}
    last = hist[days[-1]]
    prev = hist[days[-2]] if len(days) > 1 else None
    return {"country": country, "source": source, "date": days[-1], "yields": {t: last.get(t) for t in TENORS},
            "change_10y_bp": round((last["10Y"] - prev["10Y"]) * 100, 1) if prev else None, "note": note}


async def _us(c) -> History:
    rows = await rates._treasury_year(c, date.today().year)
    return {r["date"].isoformat(): {t: r["yields"][t] for t in TENORS if t in r["yields"]} for r in rows[-10:]}


async def _germany(c) -> History:
    got = await asyncio.gather(*(c.get(BUBA.format(t=t[:-1].zfill(2))) for t in TENORS))
    return merge({t: parse_buba(r.text) for t, r in zip(TENORS, got) if r.status_code == 200})


async def _euro(c) -> History:
    got = await asyncio.gather(*(c.get(ECB.format(t=t)) for t in TENORS))
    return merge({t: parse_ecb(r.text) for t, r in zip(TENORS, got) if r.status_code == 200})


async def _uk(c) -> History:
    start = date.fromordinal(date.today().toordinal() - 20).strftime("%d/%b/%Y")
    r = await c.get(BOE.format(start=start))
    r.raise_for_status()
    return parse_boe(r.text)


async def _japan(c) -> History:
    r = await c.get(MOF)
    r.raise_for_status()
    return parse_mof(r.text)


async def _canada(c) -> History:
    r = await c.get(BOC)
    r.raise_for_status()
    return parse_boc(r.text)


COUNTRIES = [
    ("United States", "US Treasury", _us, None),
    ("Germany", "Deutsche Bundesbank", _germany, None),
    ("Euro area AAA", "European Central Bank", _euro, "Spot rates from the ECB's fitted curve for AAA-rated governments."),
    ("United Kingdom", "Bank of England", _uk, "The long column is the 20-year: the Bank's daily par yields stop there."),
    ("Japan", "Ministry of Finance", _japan, None),
    ("Canada", "Bank of Canada", _canada, "The long column is the Bank's long-term benchmark (over 10 years)."),
]


async def world() -> dict:
    async def make():
        async with web.client() as c:
            async def one(name, source, fetch, note):
                try:
                    return summary(name, source, await fetch(c), note)
                except Exception as e:                  # one country down never hides the rest
                    return {"country": name, "source": source, "date": None, "yields": {}, "change_10y_bp": None,
                            "note": f"Unavailable just now ({type(e).__name__})."}
            rows = await asyncio.gather(*(one(*x) for x in COUNTRIES))
        us10 = rows[0]["yields"].get("10Y")
        for r in rows:
            ten = r["yields"].get("10Y")
            r["spread_to_us_bp"] = round((ten - us10) * 100) if ten is not None and us10 is not None else None
            two = r["yields"].get("2Y")
            r["slope_2s10s_bp"] = round((ten - two) * 100) if ten is not None and two is not None else None
        return {"tenors": TENORS, "countries": rows}
    return await web.cached("wb", 1800, make)
