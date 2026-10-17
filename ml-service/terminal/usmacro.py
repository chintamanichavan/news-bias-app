"""The US economy and the Fed: FED (the Fed at a glance), DOTS (the dot
plot), FOMC (statements and minutes), FCON (Chicago Fed financial
conditions), BUDG (the federal budget and debt), DEBT (foreign holders of
Treasuries), TAYL (the Taylor rule, on the Fed's own long-run estimates),
IFMO (inflation and market breakevens), HSST (housing) and OUTL (the
OECD's projections). All official and keyless.
"""

import asyncio
import csv
import io
import re
from datetime import date

import pandas as pd

from . import econ, rates, web

FED = "https://www.federalreserve.gov"
NFCI = "https://www.chicagofed.org/-/media/publications/nfci/nfci-data-series-csv.csv"
FISCAL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
TIC = "https://ticdata.treasury.gov/resource-center/data-chart-center/tic/Documents/slt_table5.txt"
TREASURY = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{year}/all")
OECD_EO = "https://sdmx.oecd.org/public/rest/data/OECD.ECO.MAD,DSD_EO@DF_EO,1.2/{areas}.{measures}.A"
CENSUS_STARTS = "https://www.census.gov/construction/nrc/xls/newresconst.xlsx"
CENSUS_SALES = "https://www.census.gov/construction/nrs/xls/newressales.xlsx"
FHFA = "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv"


def _text(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).replace("&nbsp;", " ").replace("&#xa0;", " ")


async def _get(url: str, **kw):
    async with web.client() as c:
        r = await c.get(url, **kw)
        r.raise_for_status()
        return r


# ── the Fed ──────────────────────────────────────────────────────────────────

async def _calendar_links() -> dict:
    async def make():
        html = (await _get(f"{FED}/monetarypolicy/fomccalendars.htm")).text
        def newest(pattern):
            found = sorted(set(re.findall(pattern, html)), key=lambda x: x[1])
            return [{"url": FED + u, "date": f"{d[:4]}-{d[4:6]}-{d[6:]}"} for u, d in found]
        return {"projections": newest(r'href="(/monetarypolicy/fomcprojtabl(\d{8})\.htm)"'),
                "statements": newest(r'href="(/newsevents/pressreleases/monetary(\d{8})a\.htm)"'),
                "minutes": newest(r'href="(/monetarypolicy/fomcminutes(\d{8})\.htm)"')}
    return await web.cached("fomclinks", 6 * 3600, make)


def parse_sep(html: str) -> dict:
    """The medians table (table 1) and the dot plot (figure 2) of a Summary
    of Economic Projections."""
    tabs = pd.read_html(io.StringIO(html))
    t = tabs[0]
    years = [str(c[1]) for c in t.columns if c[0].startswith("Median")]
    medians = {}
    for _, row in t.iterrows():
        # labels carry footnote digits ("Core PCE inflation4"); the rows named
        # "June projection" repeat the previous meeting's figures and are skipped
        name = re.sub(r"\d+$", "", str(row.iloc[0])).strip()
        vals = [row[c] for c in t.columns if c[0].startswith("Median")]
        if name and name != "nan" and not name.startswith("Memo") and "projection" not in name.lower():
            medians[name] = {y: (float(v) if str(v).replace(".", "", 1).isdigit() else None) for y, v in zip(years, vals)}
    dots_t = next(x for x in tabs if str(x.columns[0]).startswith("Midpoint"))
    dot_years = [str(c) for c in dots_t.columns[1:]]
    dots = []
    for _, row in dots_t.iterrows():
        level = float(row.iloc[0])
        for y, v in zip(dot_years, row.iloc[1:]):
            if pd.notna(v) and float(v) > 0:
                dots.append({"year": y, "rate": level, "count": int(v)})
    return {"years": years, "medians": medians, "dots": dots, "dot_years": dot_years}


async def projections() -> dict:
    async def make():
        links = await _calendar_links()
        latest = links["projections"][-1]
        sep = parse_sep((await _get(latest["url"])).text)
        return {"meeting": latest["date"], "url": latest["url"], **sep}
    return await web.cached("sep", 6 * 3600, make)


def parse_h41(html: str) -> dict:
    """Weekly balance sheet figures (millions of dollars) from H.4.1."""
    t = _text(html)
    def first_number(label):
        i = t.find(label)
        if i < 0:
            return None
        m = re.search(r"([\d,]{5,})", t[i + len(label): i + len(label) + 120])
        return float(m.group(1).replace(",", "")) if m else None
    week = re.search(r"Week ended\s+([A-Z][a-z]+ \d{1,2}, \d{4})", t) or re.search(r"([A-Z][a-z]+ \d{1,2}, \d{4})", t)
    return {"week": week.group(1) if week else None,
            "total_factors_supplying": first_number("Total factors supplying reserve funds"),
            "securities_held": first_number("Securities held outright"),
            "treasuries": first_number("U.S. Treasury securities"),
            "mbs": first_number("Mortgage-backed securities"),
            "reserve_balances": first_number("Reserve balances with Federal Reserve Banks")}


async def fed() -> dict:
    async def make():
        h41_html = (await _get(f"{FED}/releases/h41/current/h41.htm")).text
        links, money, sep = await asyncio.gather(_calendar_links(), rates.money(), projections())
        meetings = []
        async with web.client() as c:
            meetings = await rates._fomc(c)
        today = date.today()
        nxt = next((m for m in meetings if m >= today), None)
        return {"h41": parse_h41(h41_html), "rates": money.get("rates"), "target": money.get("target"),
                "next_meeting": nxt.isoformat() if nxt else None, "statement": links["statements"][-1] if links["statements"] else None,
                "minutes": links["minutes"][-1] if links["minutes"] else None,
                "projection_meeting": sep["meeting"], "funds_median": sep["medians"].get("Federal funds rate")}
    return await web.cached("fedpage", 3600, make)


async def fomc_documents() -> dict:
    links = await _calendar_links()
    rows = [{"date": s["date"], "kind": "Statement", "url": s["url"]} for s in links["statements"]]
    rows += [{"date": m["date"], "kind": "Minutes", "url": m["url"]} for m in links["minutes"]]
    rows += [{"date": p["date"], "kind": "Projections", "url": p["url"]} for p in links["projections"]]
    return {"rows": sorted(rows, key=lambda r: (r["date"], r["kind"]), reverse=True)}


# ── conditions, budget, holders ──────────────────────────────────────────────

def parse_nfci(text: str) -> list[dict]:
    out = []
    for r in csv.DictReader(io.StringIO(text)):
        m, d, y = r["Friday_of_Week"].split("/")
        out.append({"date": f"{y}-{m}-{d}", **{k: float(r[k]) for k in ("NFCI", "ANFCI", "Risk", "Credit", "Leverage") if r.get(k) not in (None, "")}})
    return out


async def conditions() -> dict:
    async def make():
        rows = parse_nfci((await _get(NFCI)).text)
        return {"latest": rows[-1], "rows": rows[-520:]}
    return await web.cached("nfci", 6 * 3600, make)


async def budget() -> dict:
    async def make():
        mts, debt = await asyncio.gather(
            _get(f"{FISCAL}/v1/accounting/mts/mts_table_1", params={"sort": "-record_date", "page[size]": 100}),
            _get(f"{FISCAL}/v2/accounting/od/debt_to_penny", params={"sort": "-record_date", "page[size]": 260}))
        months = []
        for r in mts.json()["data"]:
            desc = r.get("classification_desc") or ""
            if re.match(r"^[A-Z][a-z]+$", desc) or desc.startswith("Year-to-Date"):
                def amt(k):
                    v = r.get(k)
                    return float(v) if v not in (None, "", "null") else None
                months.append({"record_date": r["record_date"], "period": desc, "receipts": amt("current_month_gross_rcpt_amt"),
                               "outlays": amt("current_month_gross_outly_amt"), "deficit": amt("current_month_dfct_sur_amt")})
        d = debt.json()["data"]
        return {"months": months[:30], "debt": [{"date": x["record_date"], "total": float(x["tot_pub_debt_out_amt"]),
                                                  "public": float(x["debt_held_public_amt"]), "intragov": float(x["intragov_hold_amt"])} for x in d]}
    return await web.cached("budget", 6 * 3600, make)


def parse_tic(text: str) -> dict:
    lines = [l.rstrip("\t") for l in text.splitlines()]
    head = next(i for i, l in enumerate(lines) if l.startswith("Country"))
    months = lines[head].split("\t")[1:]
    rows = []
    for l in lines[head + 1:]:
        cells = l.split("\t")
        if len(cells) < 3 or not cells[0].strip():
            continue
        vals = [float(v) if re.match(r"^-?[\d.]+$", v.strip()) else None for v in cells[1:]]
        rows.append({"country": cells[0].strip(), "values": dict(zip(months, vals))})
    return {"months": [m.strip() for m in months], "rows": rows}


async def foreign_holders() -> dict:
    async def make():
        return parse_tic((await _get(TIC)).text)
    return await web.cached("tic5", 24 * 3600, make)


# ── Taylor rule ──────────────────────────────────────────────────────────────

def taylor(inflation: float, unemployment: float, u_star: float, r_star: float, target: float = 2.0, gap_weight: float = 0.5) -> float:
    """Taylor (1993): r* + inflation + 0.5 (inflation - target) + weight x
    output gap, the gap from unemployment by Okun's law (2 x shortfall)."""
    gap = -2.0 * (unemployment - u_star)
    return r_star + inflation + 0.5 * (inflation - target) + gap_weight * gap


async def taylor_rule() -> dict:
    stats, sep, money = await asyncio.gather(econ.statistics(), projections(), rates.money())
    by = {r["series"]: r for r in stats["rows"]}
    core = by.get("CUUR0000SA0L1E", {}).get("latest")
    headline = by.get("CUUR0000SA0", {}).get("latest")
    unemp = by.get("LNS14000000", {}).get("latest")
    u_star = (sep["medians"].get("Unemployment rate") or {}).get("Longer run")
    funds_lr = (sep["medians"].get("Federal funds rate") or {}).get("Longer run")
    r_star = funds_lr - 2.0 if funds_lr is not None else None
    effr = (money.get("rates") or {}).get("EFFR", {}).get("rate")
    if None in (core, unemp, u_star, r_star):
        return {"error": "Missing an input", "inputs": {"core": core, "unemployment": unemp, "u_star": u_star, "r_star": r_star}}
    return {
        "inputs": {"core_inflation": core, "headline_inflation": headline, "unemployment": unemp, "u_star": u_star, "r_star": r_star,
                   "period": by.get("LNS14000000", {}).get("period"), "sep_meeting": sep["meeting"]},
        "effr": effr,
        "rules": [{"rule": "Taylor (1993), core inflation", "rate": taylor(core, unemp, u_star, r_star)},
                  {"rule": "Balanced approach (gap weight 1)", "rate": taylor(core, unemp, u_star, r_star, gap_weight=1.0)},
                  {"rule": "Taylor (1993), headline inflation", "rate": taylor(headline, unemp, u_star, r_star) if headline is not None else None}],
    }


# ── inflation, housing, outlook ──────────────────────────────────────────────

async def breakevens() -> dict:
    async def make():
        y = date.today().year
        async with web.client() as c:
            nom, real = await asyncio.gather(
                c.get(TREASURY.format(year=y), params={"type": "daily_treasury_yield_curve", "field_tdr_date_value": str(y), "_format": "csv"}),
                c.get(TREASURY.format(year=y), params={"type": "daily_treasury_real_yield_curve", "field_tdr_date_value": str(y), "_format": "csv"}))
        n = {r["Date"]: r for r in csv.DictReader(io.StringIO(nom.text))}
        out = []
        for r in csv.DictReader(io.StringIO(real.text)):
            d = r["Date"]
            if d not in n:
                continue
            row = {"date": datetime_iso(d)}
            for t in ("5 YR", "10 YR", "30 YR"):
                a, b = n[d].get(t.replace("YR", "Yr")), r.get(t)
                row[t.replace(" YR", "Y")] = float(a) - float(b) if a and b else None
            out.append(row)
        return sorted(out, key=lambda x: x["date"])
    return await web.cached("breakevens", 6 * 3600, make)


def datetime_iso(mdy: str) -> str:
    m, d, y = mdy.split("/")
    return f"{y}-{m}-{d}"


async def outlook() -> dict:
    async def make():
        areas = "USA+CHN+DEU+JPN+GBR+FRA+ITA+CAN+IND+BRA+KOR+AUS+MEX+EA17+OECD+W"
        r = await _get(OECD_EO.format(areas=areas, measures="GDPV_ANNPCT+CPI_YTYPCT"),
                       params={"startPeriod": str(date.today().year - 2), "format": "csvfilewithlabels"})
        out: dict[str, dict] = {}
        for x in csv.DictReader(io.StringIO(r.text)):
            if not x.get("OBS_VALUE"):
                continue
            row = out.setdefault(x["REF_AREA"], {"area": x["REF_AREA"], "name": x.get("Reference area"), "gdp": {}, "cpi": {}})
            (row["gdp"] if x["MEASURE"] == "GDPV_ANNPCT" else row["cpi"])[x["TIME_PERIOD"]] = float(x["OBS_VALUE"])
        return {"rows": list(out.values())}
    return await web.cached("oecdeo", 24 * 3600, make)


MONTHS = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August",
                                      "September", "October", "November", "December"], 1)}


def census_block(sheet: pd.DataFrame) -> dict:
    """The first table of a Census construction sheet: a year on its own
    row, then month rows ('August . . . .') with the US total in column 1.
    Returns the block's title (its units) and the points, oldest first."""
    title, year, points = None, None, []
    for _, r in sheet.iterrows():
        first = str(r.iloc[0]).strip()
        if title is None and first.startswith("Table") and "a" in first.split(" - ")[0][-2:]:
            title = first
        if first.isdigit() and len(first) == 4:
            year = int(first)
            continue
        name = first.split(" .")[0].strip().rstrip("(rp)").strip()
        if name in MONTHS and year:
            v = pd.to_numeric(r.iloc[1], errors="coerce")
            if pd.notna(v):
                points.append({"t": f"{year}-{MONTHS[name]:02d}-01", "v": float(v)})
            continue
        if points and first.startswith("Table"):
            break                         # the next table on the sheet
    return {"title": title, "points": points}


def _sheet(content: bytes, hint: str) -> pd.DataFrame:
    book = pd.read_excel(io.BytesIO(content), sheet_name=None, header=None)
    return next((v for k, v in book.items() if hint.lower() in k.lower()), next(iter(book.values())))


async def housing() -> dict:
    async def make():
        async with web.client() as c:
            starts, sales, hpi = await asyncio.gather(c.get(CENSUS_STARTS), c.get(CENSUS_SALES), c.get(FHFA))
        hpi_rows = [r for r in csv.DictReader(io.StringIO(hpi.text)) if r.get("level") == "USA or Census Division"
                    and r.get("place_name") == "United States" and r.get("hpi_flavor") == "purchase-only" and r.get("frequency") == "monthly"]
        hpi_pts = sorted(({"t": f"{r['yr']}-{int(r['period']):02d}-01", "v": float(r.get("index_sa") or r["index_nsa"])} for r in hpi_rows), key=lambda p: p["t"])
        st, sa = census_block(_sheet(starts.content, "Starts")), census_block(_sheet(sales.content, "Sold"))
        return {"starts": st, "sales": sa, "hpi": hpi_pts[-240:]}
    return await web.cached("housing", 12 * 3600, make)
