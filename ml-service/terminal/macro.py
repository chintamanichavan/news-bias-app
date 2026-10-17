"""The world economy from three keyless official sources (the IMF's own
service refuses this server, so its figures come through these):

- World Bank indicators: GDP, growth, inflation, unemployment, current
  account, government debt, reserves (annual)
- OECD: composite leading indicators (monthly)
- BIS: central bank policy rates (daily, 49 banks) and residential
  property prices (quarterly)

Plus Aswath Damodaran's country risk premiums. Used by COUN, ECMX, GDP,
EMEC, WBGR, OECD, LEAD, CBRT, CENB, EMMR, WGO, WIRA, HOIN, CRP, EQRP and
the central bank pages.
"""

import asyncio
import csv
import io
import math
from datetime import date

import pandas as pd

from . import web

WB = "https://api.worldbank.org/v2/country/{countries}/indicator/{indicator}"
BIS = "https://stats.bis.org/api/v1/data/{flow}/{key}/all"
OECD_CLI = "https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_CLI,4.1/{areas}.M.LI...AA...H"
DAMODARAN = "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html"

# iso2, iso3, name, central bank, emerging, main equity index (Yahoo), currency per dollar (Yahoo)
COUNTRIES = [
    ("US", "USA", "United States", "Federal Reserve", False, "^GSPC", None),
    ("XM", "EMU", "Euro area", "European Central Bank", False, "^STOXX50E", "EURUSD=X"),
    ("GB", "GBR", "United Kingdom", "Bank of England", False, "^FTSE", "GBPUSD=X"),
    ("JP", "JPN", "Japan", "Bank of Japan", False, "^N225", "JPY=X"),
    ("CA", "CAN", "Canada", "Bank of Canada", False, "^GSPTSE", "CAD=X"),
    ("AU", "AUS", "Australia", "Reserve Bank of Australia", False, "^AXJO", "AUDUSD=X"),
    ("CH", "CHE", "Switzerland", "Swiss National Bank", False, "^SSMI", "CHF=X"),
    ("SE", "SWE", "Sweden", "Riksbank", False, "^OMX", "SEK=X"),
    ("NO", "NOR", "Norway", "Norges Bank", False, "OSEBX.OL", "NOK=X"),
    ("NZ", "NZL", "New Zealand", "Reserve Bank of New Zealand", False, "^NZ50", "NZDUSD=X"),
    ("DE", "DEU", "Germany", "European Central Bank", False, "^GDAXI", "EURUSD=X"),
    ("FR", "FRA", "France", "European Central Bank", False, "^FCHI", "EURUSD=X"),
    ("IT", "ITA", "Italy", "European Central Bank", False, "FTSEMIB.MI", "EURUSD=X"),
    ("ES", "ESP", "Spain", "European Central Bank", False, "^IBEX", "EURUSD=X"),
    ("KR", "KOR", "South Korea", "Bank of Korea", False, "^KS11", "KRW=X"),
    ("CN", "CHN", "China", "People's Bank of China", True, "000001.SS", "CNY=X"),
    ("IN", "IND", "India", "Reserve Bank of India", True, "^BSESN", "INR=X"),
    ("BR", "BRA", "Brazil", "Central Bank of Brazil", True, "^BVSP", "BRL=X"),
    ("MX", "MEX", "Mexico", "Bank of Mexico", True, "^MXX", "MXN=X"),
    ("ZA", "ZAF", "South Africa", "South African Reserve Bank", True, "^JN0U.JO", "ZAR=X"),
    ("RU", "RUS", "Russia", "Bank of Russia", True, "IMOEX.ME", "RUB=X"),
    ("TR", "TUR", "Turkey", "Central Bank of Turkey", True, "XU100.IS", "TRY=X"),
    ("ID", "IDN", "Indonesia", "Bank Indonesia", True, "^JKSE", "IDR=X"),
    ("SA", "SAU", "Saudi Arabia", "Saudi Central Bank", True, "^TASI.SR", "SAR=X"),
    ("PL", "POL", "Poland", "National Bank of Poland", True, "WIG20.WA", "PLN=X"),
    ("TH", "THA", "Thailand", "Bank of Thailand", True, "^SET.BK", "THB=X"),
    ("MY", "MYS", "Malaysia", "Bank Negara Malaysia", True, "^KLSE", "MYR=X"),
    ("PH", "PHL", "Philippines", "Bangko Sentral ng Pilipinas", True, "PSEI.PS", "PHP=X"),
    ("CL", "CHL", "Chile", "Central Bank of Chile", True, "^IPSA", "CLP=X"),
    ("CO", "COL", "Colombia", "Bank of the Republic", True, "^COLCAP", "COP=X"),
    ("AR", "ARG", "Argentina", "Central Bank of Argentina", True, "^MERV", "ARS=X"),
]
BY_ISO2 = {c[0]: c for c in COUNTRIES}

INDICATORS = {
    "NY.GDP.MKTP.CD": "GDP, US$", "NY.GDP.MKTP.KD.ZG": "GDP growth %", "NY.GDP.PCAP.CD": "GDP per person, US$",
    "FP.CPI.TOTL.ZG": "Inflation %", "SL.UEM.TOTL.ZS": "Unemployment %", "BN.CAB.XOKA.GD.ZS": "Current account, % of GDP",
    "GC.DOD.TOTL.GD.ZS": "Government debt, % of GDP", "NE.EXP.GNFS.ZS": "Exports, % of GDP", "SP.POP.TOTL": "Population",
    "FI.RES.TOTL.CD": "Reserves incl. gold, US$", "FI.RES.XGLD.CD": "Reserves excl. gold, US$", "FR.INR.RINR": "Real interest rate %",
    "NY.GDP.DEFL.KD.ZG": "GDP deflator %", "GC.BAL.CASH.GD.ZS": "Government balance, % of GDP",
}
MATRIX = ["NY.GDP.MKTP.CD", "NY.GDP.MKTP.KD.ZG", "NY.GDP.PCAP.CD", "FP.CPI.TOTL.ZG", "SL.UEM.TOTL.ZS", "BN.CAB.XOKA.GD.ZS", "GC.DOD.TOTL.GD.ZS"]


def _wb_iso3(iso2: str) -> str:
    return BY_ISO2[iso2][1] if iso2 in BY_ISO2 else iso2


async def wb(indicator: str, iso3s: list[str], mrv: int = 6) -> dict[str, list[dict]]:
    """{iso3: [{year, value}] oldest first} for one World Bank indicator."""
    key = f"wb:{indicator}:{','.join(sorted(iso3s))}:{mrv}"

    async def make():
        async with web.client() as c:
            r = await c.get(WB.format(countries=";".join(iso3s), indicator=indicator), params={"format": "json", "mrv": mrv, "per_page": 2000})
            r.raise_for_status()
            j = r.json()
        rows = j[1] if isinstance(j, list) and len(j) > 1 and j[1] else []
        out: dict[str, list[dict]] = {}
        for x in rows:
            if x.get("value") is not None:
                out.setdefault(x["countryiso3code"] or x["country"]["id"], []).append({"year": int(x["date"]), "value": x["value"]})
        return {k: sorted(v, key=lambda e: e["year"]) for k, v in out.items()}
    return await web.cached(key, 24 * 3600, make)


def latest(points: list[dict] | None) -> dict | None:
    return points[-1] if points else None


async def matrix(emerging: bool | None = None) -> dict:
    countries = [c for c in COUNTRIES if c[0] not in ("DE", "FR", "IT", "ES") or emerging is None]
    if emerging is not None:
        countries = [c for c in COUNTRIES if c[4] == emerging and c[0] != "XM"]
    iso3s = [c[1] for c in countries]
    got = await asyncio.gather(*(wb(ind, iso3s) for ind in MATRIX))
    policy = await policy_rates()
    rows = []
    for c in countries:
        row = {"iso2": c[0], "iso3": c[1], "country": c[2]}
        for ind, data in zip(MATRIX, got):
            p = latest(data.get(c[1]))
            row[ind] = p["value"] if p else None
            row[f"{ind}:year"] = p["year"] if p else None
        pr = policy["by_area"].get(c[0])
        row["policy_rate"] = pr["rate"] if pr else None
        rows.append(row)
    return {"indicators": {k: INDICATORS[k] for k in MATRIX}, "rows": rows}


def parse_bis(text: str) -> list[dict]:
    return [{"area": r["REF_AREA"], "date": r["TIME_PERIOD"], "value": float(r["OBS_VALUE"])}
            for r in csv.DictReader(io.StringIO(text)) if r.get("OBS_VALUE") not in (None, "", "NaN")]


def last_change(points: list[dict]) -> dict | None:
    """The latest rate and the date and size of the last move."""
    if not points:
        return None
    pts = sorted(points, key=lambda p: p["date"])
    now = pts[-1]["value"]
    for prev, cur in zip(reversed(pts[:-1]), reversed(pts)):
        if prev["value"] != cur["value"]:
            return {"rate": now, "as_of": pts[-1]["date"], "changed": cur["date"], "change_bp": round((cur["value"] - prev["value"]) * 100)}
    return {"rate": now, "as_of": pts[-1]["date"], "changed": None, "change_bp": None}


async def policy_history(areas: str = "", n: int = 800) -> dict[str, list[dict]]:
    async def make():
        async with web.client() as c:
            r = await c.get(BIS.format(flow="WS_CBPOL", key=f"D.{areas}" if areas else "D"), params={"lastNObservations": n, "format": "csv"})
            r.raise_for_status()
        out: dict[str, list[dict]] = {}
        for p in parse_bis(r.text):
            out.setdefault(p["area"], []).append(p)
        return out
    return await web.cached(f"bispol:{areas}:{n}", 6 * 3600, make)


async def policy_rates() -> dict:
    hist = await policy_history("", 800)
    by_area = {a: last_change(pts) for a, pts in hist.items()}
    rows = []
    for a, x in by_area.items():
        if not x:
            continue
        c = BY_ISO2.get(a)
        rows.append({"area": a, "country": c[2] if c else a, "bank": c[3] if c else None, "emerging": c[4] if c else None, **x})
    rows.sort(key=lambda r: -r["rate"])
    return {"rows": rows, "by_area": by_area}


async def oecd_cli(iso3s: list[str]) -> dict[str, list[dict]]:
    async def make():
        async with web.client() as c:
            r = await c.get(OECD_CLI.format(areas="+".join(iso3s)), params={"startPeriod": f"{date.today().year - 6}-01", "format": "csvfilewithlabels"})
            r.raise_for_status()
        out: dict[str, list[dict]] = {}
        for x in csv.DictReader(io.StringIO(r.text)):
            if x.get("OBS_VALUE"):
                out.setdefault(x["REF_AREA"], []).append({"t": x["TIME_PERIOD"], "v": float(x["OBS_VALUE"])})
        return {k: sorted(v, key=lambda p: p["t"]) for k, v in out.items()}
    return await web.cached(f"oecdcli:{','.join(iso3s)}", 24 * 3600, make)


def cli_reading(points: list[dict]) -> dict | None:
    """Level against 100 and direction over three months: the OECD's own
    four phases (expansion, downturn, slowdown, recovery)."""
    if len(points) < 4:
        return None
    now, before = points[-1]["v"], points[-4]["v"]
    rising = now > before
    phase = ("expansion" if rising else "downturn") if now >= 100 else ("recovery" if rising else "slowdown")
    return {"level": now, "three_month_change": now - before, "phase": phase, "as_of": points[-1]["t"]}


async def property_prices(iso2s: list[str]) -> dict[str, list[dict]]:
    async def make():
        async with web.client() as c:
            r = await c.get(BIS.format(flow="WS_SPP", key=f"Q.{'+'.join(iso2s)}.N.628"), params={"startPeriod": f"{date.today().year - 12}", "format": "csv"})
            r.raise_for_status()
        out: dict[str, list[dict]] = {}
        for p in parse_bis(r.text):
            out.setdefault(p["area"], []).append(p)
        for a, pts in out.items():
            pts.sort(key=lambda p: p["date"])
            for i, p in enumerate(pts):
                p["yoy"] = (p["value"] / pts[i - 4]["value"] - 1) * 100 if i >= 4 else None
        return out
    return await web.cached(f"bisspp:{','.join(iso2s)}", 24 * 3600, make)


async def reserves() -> dict:
    iso3s = [c[1] for c in COUNTRIES if c[0] not in ("XM",)]
    tot, ex = await asyncio.gather(wb("FI.RES.TOTL.CD", iso3s, 3), wb("FI.RES.XGLD.CD", iso3s, 3))
    rows = []
    for c in COUNTRIES:
        t, e = latest(tot.get(c[1])), latest(ex.get(c[1]))
        if t:
            gold = t["value"] - e["value"] if e and e["year"] == t["year"] else None
            rows.append({"country": c[2], "iso3": c[1], "year": t["year"], "reserves": t["value"], "gold": gold,
                         "gold_share": gold / t["value"] if gold is not None and t["value"] else None})
    rows.sort(key=lambda r: -r["reserves"])
    return {"rows": rows}


def parse_damodaran(html: str) -> list[dict]:
    tables = pd.read_html(io.StringIO(html))
    t = next(x for x in tables if x.shape[0] > 100)
    header = [str(v) for v in t.iloc[0]]
    rows = []
    for _, r in t.iloc[1:].iterrows():
        def pct(v):
            s = str(v).strip().rstrip("%")
            try:
                return float(s) / 100
            except ValueError:
                return None
        rows.append({"country": str(r[0]), "rating": None if pd.isna(r[1]) else str(r[1]), "default_spread": pct(r[2]),
                     "country_risk_premium": pct(r[3]), "equity_risk_premium": pct(r[4]), "tax_rate": pct(r[5])})
    return [r for r in rows if r["country"] and r["country"] != "nan"]


async def country_risk() -> dict:
    async def make():
        async with web.client() as c:
            r = await c.get(DAMODARAN)
            r.raise_for_status()
        return {"rows": parse_damodaran(r.text)}
    return await web.cached("ctryprem", 7 * 86400, make)


async def country(iso2: str) -> dict:
    """COUN: one country's markets and economy on one page."""
    from . import quotes, govts
    c = BY_ISO2[iso2]
    iso3 = c[1] if iso2 != "XM" else "EMU"
    inds = ["NY.GDP.MKTP.KD.ZG", "FP.CPI.TOTL.ZG", "SL.UEM.TOTL.ZS", "BN.CAB.XOKA.GD.ZS", "GC.DOD.TOTL.GD.ZS", "NY.GDP.MKTP.CD", "NY.GDP.PCAP.CD"]
    got = await asyncio.gather(*(wb(i, [iso3], 12) for i in inds))
    pol = await policy_history(iso2, 2000)
    q = await quotes.quotes([s for s in (c[5], c[6]) if s])
    bonds = await govts.world()
    ten = next((b for b in bonds["countries"] if b["country"].startswith(c[2].split()[0])), None)
    cli = await oecd_cli([iso3]) if iso2 not in ("XM",) else {}
    return {
        "iso2": iso2, "country": c[2], "bank": c[3],
        "index": {"symbol": c[5], **(q.get(c[5]) or {})} if c[5] else None,
        "currency": {"symbol": c[6], **(q.get(c[6]) or {})} if c[6] else None,
        "ten_year": ten["yields"].get("10Y") if ten else None,
        "policy": last_change(pol.get(iso2, [])),
        "policy_path": [{"t": p["date"], "v": p["value"]} for p in sorted(pol.get(iso2, []), key=lambda p: p["date"])],
        "economy": {INDICATORS[i]: data.get(iso3, []) for i, data in zip(inds, got)},
        "cli": cli_reading(cli.get(iso3, [])), "cli_path": cli.get(iso3, []),
    }
