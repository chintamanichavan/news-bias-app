"""Commodities and energy: CFTC (who holds the futures), CCRV (curve shape
and roll yield), CRR (ranked returns), GCIN (commodity indices), CPH and
CMDX (the World Bank's monthly prices), CRKS (regional crack spreads from
EIA spot prices), BOIL and BGAS (EIA spot oil, products and gas), NATG
(gas storage), CRUD (crude and inventories).

Sources, all public: the CFTC's Commitments of Traders, the EIA's spot
price files and weekly reports, the World Bank's Pink Sheet and Yahoo's
futures. LBMA, CME and Baker Hughes refuse requests from this server.
"""

import asyncio
import csv
import io
import math
import re
from datetime import date

import pandas as pd

from . import futures, returns, web

COT = "https://publicreporting.cftc.gov/resource/6dca-aqww.json"
EIA = "https://www.eia.gov/dnav/{area}/hist_xls/{code}d.xls"
STORAGE = "https://ir.eia.gov/ngs/wngsr.json"
WPSR = "https://ir.eia.gov/wpsr/table1.csv"
PINK_PAGE = "https://www.worldbank.org/en/research/commodity-markets"

COT_MARKETS = [  # CFTC contract code, name
    ("067651", "WTI crude oil"), ("023651", "Natural gas (Henry Hub)"), ("111659", "RBOB gasoline"), ("022651", "Heating oil (ULSD)"),
    ("088691", "Gold"), ("084691", "Silver"), ("085692", "Copper"), ("076651", "Platinum"),
    ("002602", "Corn"), ("001602", "Wheat (Chicago)"), ("005602", "Soybeans"), ("080732", "Sugar"), ("083731", "Coffee"), ("033661", "Cotton"),
    ("057642", "Live cattle"), ("054642", "Lean hogs"),
    ("13874A", "S&P 500 e-mini"), ("209742", "Nasdaq-100 e-mini"), ("043602", "10-year Treasury note"), ("020601", "Treasury bond"),
    ("099741", "Euro"), ("097741", "Japanese yen"), ("096742", "British pound"), ("1170E1", "VIX"), ("133741", "Bitcoin"),
]

SPOT = [  # EIA area, series, name, unit
    ("pet", "RWTC", "WTI, Cushing", "$/bbl"), ("pet", "RBRTE", "Brent, Europe", "$/bbl"),
    ("pet", "EER_EPMRU_PF4_Y35NY_DPG", "Gasoline, New York Harbor", "$/gal"), ("pet", "EER_EPMRU_PF4_RGC_DPG", "Gasoline, Gulf Coast", "$/gal"),
    ("pet", "EER_EPD2DXL0_PF4_Y35NY_DPG", "Diesel (ULSD), New York Harbor", "$/gal"), ("pet", "EER_EPD2DXL0_PF4_RGC_DPG", "Diesel (ULSD), Gulf Coast", "$/gal"),
    ("pet", "EER_EPD2DXL0_PF4_Y05LA_DPG", "Diesel (ULSD), Los Angeles", "$/gal"), ("pet", "EER_EPJK_PF4_RGC_DPG", "Jet fuel, Gulf Coast", "$/gal"),
    ("pet", "EER_EPLLPA_PF4_Y44MB_DPG", "Propane, Mont Belvieu", "$/gal"), ("ng", "RNGWHHD", "Natural gas, Henry Hub", "$/MMBtu"),
]

FUTURES = [("CL=F", "WTI crude"), ("BZ=F", "Brent crude"), ("NG=F", "Natural gas"), ("RB=F", "RBOB gasoline"), ("HO=F", "Heating oil"),
           ("GC=F", "Gold"), ("SI=F", "Silver"), ("HG=F", "Copper"), ("PL=F", "Platinum"), ("PA=F", "Palladium"),
           ("ZC=F", "Corn"), ("ZW=F", "Wheat"), ("ZS=F", "Soybeans"), ("ZM=F", "Soybean meal"), ("ZL=F", "Soybean oil"),
           ("KC=F", "Coffee"), ("SB=F", "Sugar"), ("CC=F", "Cocoa"), ("CT=F", "Cotton"), ("OJ=F", "Orange juice"),
           ("LE=F", "Live cattle"), ("HE=F", "Lean hogs"), ("LBS=F", "Lumber")]

INDICES = [("^SPGSCI", "S&P GSCI"), ("^DJCI", "Dow Jones Commodity Index"), ("DBC", "Invesco DB Commodity (fund)"), ("GSG", "iShares GSCI (fund)")]


async def _get(url: str, **kw):
    async with web.client() as c:
        r = await c.get(url, **kw)
        r.raise_for_status()
        return r


# ── CFTC ─────────────────────────────────────────────────────────────────────

def cot_row(x: dict) -> dict:
    f = lambda k: float(x.get(k) or 0)  # noqa: E731
    oi = f("open_interest_all")
    spec = f("noncomm_positions_long_all") - f("noncomm_positions_short_all")
    comm = f("comm_positions_long_all") - f("comm_positions_short_all")
    return {"date": x["report_date_as_yyyy_mm_dd"][:10], "open_interest": oi, "speculators_net": spec, "commercials_net": comm,
            "small_net": f("nonrept_positions_long_all") - f("nonrept_positions_short_all"),
            "speculators_net_pct_oi": spec / oi * 100 if oi else None,
            "speculators_change": f("change_in_noncomm_long_all") - f("change_in_noncomm_short_all")}


async def cot(code: str | None) -> dict:
    async def make():
        if code:
            r = await _get(COT, params={"$limit": 156, "$order": "report_date_as_yyyy_mm_dd DESC", "cftc_contract_market_code": code})
            rows = [cot_row(x) for x in r.json()][::-1]
            name = next((n for c, n in COT_MARKETS if c == code), code)
            return {"code": code, "name": name, "rows": rows}
        async def latest(c, n):
            r = await _get(COT, params={"$limit": 156, "$order": "report_date_as_yyyy_mm_dd DESC", "cftc_contract_market_code": c})
            rows = [cot_row(x) for x in r.json()]
            if not rows:
                return None
            spec = [x["speculators_net"] for x in rows]
            lo, hi = min(spec), max(spec)
            return {"code": c, "name": n, **rows[0], "three_year_rank": (rows[0]["speculators_net"] - lo) / (hi - lo) * 100 if hi > lo else None}
        got = await asyncio.gather(*(latest(c, n) for c, n in COT_MARKETS), return_exceptions=True)
        return {"rows": [g for g in got if g and not isinstance(g, Exception)]}
    return await web.cached(f"cot:{code}", 6 * 3600, make)


# ── EIA ──────────────────────────────────────────────────────────────────────

def parse_eia_xls(content: bytes) -> list[dict]:
    d = pd.read_excel(io.BytesIO(content), sheet_name="Data 1", header=None, skiprows=3)
    out = []
    for t, v in zip(d[0], d[1]):
        v = pd.to_numeric(v, errors="coerce")
        if pd.notna(v) and isinstance(t, (pd.Timestamp, date)):
            out.append({"date": pd.Timestamp(t).strftime("%Y-%m-%d"), "value": float(v)})
    return out


async def spot_series(area: str, code: str) -> list[dict]:
    async def make():
        r = await _get(EIA.format(area=area, code=code))
        return await asyncio.to_thread(parse_eia_xls, r.content)
    return await web.cached(f"eia:{code}", 12 * 3600, make)


def crack_321(crude: float, gasoline_gal: float, diesel_gal: float) -> float:
    """The 3-2-1 crack: two barrels of gasoline and one of diesel from three
    of crude, in dollars per barrel of crude (42 gallons a barrel)."""
    return (2 * gasoline_gal * 42 + diesel_gal * 42 - 3 * crude) / 3


async def spot_prices() -> dict:
    got = await asyncio.gather(*(spot_series(a, c) for a, c, _, _ in SPOT), return_exceptions=True)
    rows, series = [], {}
    for (a, c, name, unit), g in zip(SPOT, got):
        if isinstance(g, Exception) or not g:
            continue
        series[c] = {x["date"]: x["value"] for x in g}
        last, prev = g[-1], g[-2] if len(g) > 1 else None
        year = next((x for x in reversed(g) if x["date"] <= f"{int(last['date'][:4]) - 1}{last['date'][4:]}"), None)
        rows.append({"code": c, "name": name, "unit": unit, "date": last["date"], "price": last["value"],
                     "change_pct": (last["value"] / prev["value"] - 1) * 100 if prev else None,
                     "year_pct": (last["value"] / year["value"] - 1) * 100 if year else None})
    cracks = []
    wti, brent = series.get("RWTC", {}), series.get("RBRTE", {})
    for region, gas, dsl, crude, cname in (("New York Harbor", "EER_EPMRU_PF4_Y35NY_DPG", "EER_EPD2DXL0_PF4_Y35NY_DPG", brent, "Brent"),
                                           ("Gulf Coast", "EER_EPMRU_PF4_RGC_DPG", "EER_EPD2DXL0_PF4_RGC_DPG", wti, "WTI")):
        g, d = series.get(gas, {}), series.get(dsl, {})
        days = sorted(set(g) & set(d) & set(crude))
        path = [{"t": x, "v": crack_321(crude[x], g[x], d[x])} for x in days[-500:]]
        if path:
            cracks.append({"region": region, "crude": cname, "latest": path[-1], "path": path})
    return {"rows": rows, "cracks": cracks}


async def gas_storage() -> dict:
    async def make():
        d = (await _get(STORAGE)).json()
        rows = []
        for s in d.get("series", []):
            calc = s.get("calculated", {})
            rows.append({"region": s.get("name"), "stocks": (s.get("data") or [[None, None]])[0][1] if s.get("data") else None,
                         "net_change": calc.get("net_change"), "five_year_avg": calc.get("5yr-avg"), "year_ago": calc.get("yearago") or calc.get("year-ago"),
                         "data": s.get("data", [])[:60]})
        return {"week": d.get("current_week"), "released": d.get("release_date"), "rows": rows}
    return await web.cached("ngstorage", 6 * 3600, make)


def parse_wpsr(text: str) -> dict:
    rows = list(csv.reader(io.StringIO(text)))
    head = rows[0]
    out = []
    for r in rows[1:]:
        if len(r) < 4 or not r[0].strip():          # footnotes and blank lines
            continue
        def num(v):
            v = (v or "").replace(",", "").strip()
            try:
                return float(v)
            except ValueError:
                return None
        out.append({"item": r[0].strip(), "this_week": num(r[1]), "last_week": num(r[2]), "change": num(r[3]), "year_ago": num(r[5]) if len(r) > 5 else None})
    return {"weeks": head[1:3], "rows": out}


async def petroleum() -> dict:
    async def make():
        return parse_wpsr((await _get(WPSR)).text)
    return await web.cached("wpsr", 6 * 3600, make)


# ── futures: curves, returns, indices ────────────────────────────────────────

def roll_yield(contracts: list[dict]) -> dict | None:
    """Annualised roll yield from the first two contract months: positive in
    backwardation (holders earn it), negative in contango."""
    pts = [c for c in contracts if c.get("price")]
    if len(pts) < 2:
        return None
    a, b = pts[0], pts[1]
    months = 1.0
    try:
        da, db = pd.to_datetime(a["month"], format="%b %y"), pd.to_datetime(b["month"], format="%b %y")
        months = max((db.year - da.year) * 12 + db.month - da.month, 1)
    except (ValueError, TypeError):
        pass
    spread = (a["price"] - b["price"]) / b["price"]
    return {"front": a["month"], "next": b["month"], "spread_pct": spread * 100, "annual_pct": spread * 12 / months * 100,
            "shape": "backwardation" if a["price"] > b["price"] else "contango"}


async def curves() -> dict:
    t = await futures.tables()
    rows = []
    for g in t["groups"]:
        for r in g["roots"]:
            ry = roll_yield(r["contracts"])
            if ry:
                last = [c for c in r["contracts"] if c.get("price")]
                rows.append({"group": g["name"], "root": r["root"], "name": r["name"], **ry,
                             "full_curve_pct": (last[-1]["price"] / last[0]["price"] - 1) * 100 if len(last) > 1 else None,
                             "contracts": r["contracts"]})
    return {"rows": rows}


def period_returns(bars: list[dict]) -> dict:
    if not bars:
        return {}
    last = bars[-1]
    def back(days):
        cut = pd.Timestamp(last["date"]) - pd.Timedelta(days=days)
        prior = [b for b in bars if pd.Timestamp(b["date"]) <= cut]
        return (last["close"] / prior[-1]["close"] - 1) * 100 if prior else None
    ytd = [b for b in bars if b["date"][:4] < last["date"][:4]]
    return {"price": last["close"], "date": last["date"], "1d": back(1), "1w": back(7), "1m": back(30), "3m": back(91), "1y": back(365),
            "ytd": (last["close"] / ytd[-1]["close"] - 1) * 100 if ytd else None}


async def ranked(kind: str) -> dict:
    async def make():
        items = FUTURES if kind == "futures" else INDICES
        bars = await asyncio.gather(*(returns.bars(s, "2y") for s, _ in items), return_exceptions=True)
        rows = [{"symbol": s, "name": n, **period_returns(b)} for (s, n), b in zip(items, bars) if not isinstance(b, Exception) and b]
        return {"rows": rows}
    return await web.cached(f"comranked:{kind}", 1800, make)


# ── World Bank Pink Sheet ────────────────────────────────────────────────────

def parse_pink(content: bytes) -> dict:
    p = pd.read_excel(io.BytesIO(content), sheet_name="Monthly Prices", header=None)
    names, units = list(p.iloc[4]), list(p.iloc[5])
    rows = p.iloc[6:]
    months = [str(m) for m in rows[0]]
    out = []
    for i in range(1, len(names)):
        name = names[i]
        if not isinstance(name, str):
            continue
        vals = pd.to_numeric(rows[i], errors="coerce")
        pts = [{"month": f"{m[:4]}-{m[5:7]}", "value": float(v)} for m, v in zip(months, vals) if pd.notna(v) and re.match(r"^\d{4}M\d\d$", m)]
        if pts:
            out.append({"name": name.strip(), "unit": str(units[i]).strip(), "points": pts[-240:]})
    return {"series": out}


async def pink_sheet() -> dict:
    async def make():
        page = (await _get(PINK_PAGE)).text
        links = sorted(set(re.findall(r'href="([^"]+CMO-Historical-Data-Monthly[^"]*\.xlsx)"', page)))
        if not links:
            raise RuntimeError("The World Bank's Pink Sheet link was not found.")
        r = await _get(links[-1])
        return {**await asyncio.to_thread(parse_pink, r.content), "source": links[-1]}
    return await web.cached("pinksheet", 24 * 3600, make)
