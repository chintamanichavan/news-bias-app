"""Company numbers straight from SEC XBRL filings (companyfacts), for ARD,
EV, CAST, GF, GRET, PEBD (fundamentals) and AZS, DLIS, DRSK, DRAM (credit).

Every value keeps the filing it came from. Quarterly flows are the
3-month values a company files; a fourth quarter, which only appears
inside the annual total, is the year less the three quarters before it.
Point-in-time series (P/E history) use each number only from the day it
was filed, so history is never seen with hindsight.
"""

import asyncio
import math
from datetime import date

from . import filings, quotes, rates, returns, web
from .filings import SEC_HEADERS

FACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"

REVENUE = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenuesNetOfInterestExpense"]
NET_INCOME = ["NetIncomeLoss", "ProfitLoss"]
OPERATING = ["OperatingIncomeLoss"]
EPS = ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"]
OCF = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]
CAPEX = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"]
SHARES = ["WeightedAverageNumberOfDilutedSharesOutstanding"]


class NoFacts(Exception):
    pass


async def load(symbol: str) -> dict:
    """The us-gaap facts and the share count cover facts (dei)."""
    async def make():
        cik = await filings.cik_for(symbol)
        if cik is None:
            raise NoFacts(f"{symbol} is not an SEC filer, so there are no XBRL facts.")
        async with web.client() as c:
            r = await c.get(FACTS.format(cik=cik), headers=SEC_HEADERS)
            if r.status_code == 404:
                raise NoFacts(f"{symbol} has filed no XBRL facts.")
            r.raise_for_status()
            d = r.json()
        return {"name": d.get("entityName"), "cik": cik, "gaap": d["facts"].get("us-gaap", {}), "dei": d["facts"].get("dei", {})}
    return await web.cached(f"facts:{symbol}", 12 * 3600, make)


def _entries(gaap: dict, tags: list[str], unit: str | None = None) -> list[dict]:
    """Entries of every listed tag, in the given unit (USD by default,
    USD/shares for per-share tags), each marked with its tag's place in the
    list. Companies change tags over the years (Apple's revenue moved from
    Revenues to RevenueFromContractWithCustomer... in 2018), so all are read
    and latest_by_end prefers the earlier tag where two cover one period."""
    out = []
    for prio, tag in enumerate(tags):
        node = gaap.get(tag)
        if not node:
            continue
        units = node.get("units", {})
        u = unit or ("USD" if "USD" in units else next(iter(units), None))
        out += [{**e, "tag": tag, "prio": prio} for e in units.get(u) or [] if e.get("val") is not None and e.get("end")]
    return out


def days(e: dict) -> int | None:
    if not e.get("start"):
        return None
    return (date.fromisoformat(e["end"]) - date.fromisoformat(e["start"])).days


def latest_by_end(entries: list[dict], original: bool = False) -> dict[str, dict]:
    """One value per period end, from the preferred tag: the most recently
    filed (restatements win), or with `original` the first filed, which is
    what was known at the time (a figure repeated a year later as a
    comparative carries that later filing date)."""
    out: dict[str, dict] = {}
    for e in entries:
        cur = out.get(e["end"])
        if cur is None or e.get("prio", 0) < cur.get("prio", 0):
            out[e["end"]] = e
        elif e.get("prio", 0) == cur.get("prio", 0) and (e["filed"] < cur["filed"] if original else e["filed"] > cur["filed"]):
            out[e["end"]] = e
    return out


def split_factor(splits: list[dict], filed: str) -> float:
    """How many of today's shares one share was when a figure was filed:
    the product of every split after the filing date. Per-share figures
    filed before a split are divided by it, share counts multiplied."""
    f = 1.0
    for sp in splits:
        if sp["date"] > filed:
            a, b = (float(x) for x in sp["ratio"].split(":"))
            f *= a / b
    return f


def instants(gaap: dict, tags: list[str]) -> list[dict]:
    """Balance-sheet values, one per period end, oldest first."""
    rows = [e for e in _entries(gaap, tags) if not e.get("start")]
    return sorted(latest_by_end(rows).values(), key=lambda e: e["end"])


def annual(gaap: dict, tags: list[str], unit: str | None = None) -> list[dict]:
    rows = [e for e in _entries(gaap, tags, unit) if (days(e) or 0) in range(350, 380)]
    return sorted(latest_by_end(rows).values(), key=lambda e: e["end"])


def quarterly(gaap: dict, tags: list[str], unit: str | None = None, original: bool = False) -> list[dict]:
    """3-month values, with each fourth quarter derived as the year less
    the three quarters inside it. A derived quarter carries the annual
    filing's date."""
    rows = _entries(gaap, tags, unit)
    q = latest_by_end([e for e in rows if (days(e) or 0) in range(80, 101)], original)
    for y in latest_by_end([e for e in rows if (days(e) or 0) in range(350, 380)], original).values():
        if y["end"] in q:
            continue
        start, end = date.fromisoformat(y["start"]), date.fromisoformat(y["end"])
        inside = [e for e in q.values() if start <= date.fromisoformat(e["start"]) and date.fromisoformat(e["end"]) < end]
        if len(inside) == 3:
            last = max(inside, key=lambda e: e["end"])
            q[y["end"]] = {**y, "start": last["end"], "val": y["val"] - sum(e["val"] for e in inside), "derived": True}
    return sorted(q.values(), key=lambda e: e["end"])


def ttm(quarters: list[dict]) -> list[dict]:
    """Trailing four quarters, each known from the latest of their filing dates."""
    out = []
    for i in range(3, len(quarters)):
        w = quarters[i - 3: i + 1]
        span = (date.fromisoformat(w[-1]["end"]) - date.fromisoformat(w[0]["end"])).days
        if span > 300:                                  # a quarter is missing in between
            continue
        out.append({"end": w[-1]["end"], "val": sum(e["val"] for e in w), "filed": max(e["filed"] for e in w)})
    return out


def as_of(series: list[dict], day: str) -> dict | None:
    """The latest value that had been filed by `day`."""
    known = [e for e in series if e["filed"] <= day]
    return max(known, key=lambda e: e["end"]) if known else None


def value(series: list[dict]) -> float | None:
    return series[-1]["val"] if series else None


# ── credit ───────────────────────────────────────────────────────────────────

def altman(ta, ca, cl, re, ebit, sales, tl, mve) -> dict | None:
    """Altman's (1968) Z for public manufacturers. Zones: above 2.99 safe,
    1.81 to 2.99 grey, below 1.81 distress."""
    if not ta or not tl or None in (ca, cl, re, ebit, sales, mve):
        return None
    parts = {"working_capital": 1.2 * (ca - cl) / ta, "retained_earnings": 1.4 * re / ta, "ebit": 3.3 * ebit / ta,
             "market_to_liabilities": 0.6 * mve / tl, "sales": 1.0 * sales / ta}
    z = sum(parts.values())
    return {"z": z, "parts": parts, "zone": "safe" if z > 2.99 else "grey" if z >= 1.81 else "distress"}


def _cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def merton(equity: float, sigma_e: float, debt: float, r: float, t: float = 1.0) -> dict | None:
    """Merton's model: equity is a call on the firm's assets struck at its
    debt. Solve the two equations E = V N(d1) - D e^{-rT} N(d2) and
    sigma_E E = N(d1) sigma_V V for V and sigma_V by fixed-point iteration,
    then distance to default and its normal default probability."""
    if equity <= 0 or sigma_e <= 0 or debt <= 0:
        return None
    v, sv = equity + debt, sigma_e * equity / (equity + debt)
    for _ in range(500):
        d1 = (math.log(v / debt) + (r + sv * sv / 2) * t) / (sv * math.sqrt(t))
        d2 = d1 - sv * math.sqrt(t)
        nd1 = _cdf(d1)
        v_new = (equity + debt * math.exp(-r * t) * _cdf(d2)) / nd1
        sv_new = sigma_e * equity / (nd1 * v_new)
        if abs(v_new - v) < 1e-9 * v and abs(sv_new - sv) < 1e-12:
            v, sv = v_new, sv_new
            break
        v, sv = v_new, sv_new
    dd = (math.log(v / debt) + (r - sv * sv / 2) * t) / (sv * math.sqrt(t))
    return {"assets": v, "asset_vol": sv, "distance_to_default": dd, "default_probability": _cdf(-dd)}


def annual_vol(closes: list[float]) -> float | None:
    r = [math.log(b / a) for a, b in zip(closes, closes[1:]) if a and b]
    if len(r) < 60:
        return None
    m = sum(r) / len(r)
    return math.sqrt(sum((x - m) ** 2 for x in r) / (len(r) - 1) * 252)


# ── fetch and assemble ───────────────────────────────────────────────────────

async def _market(symbol: str) -> dict:
    got = await quotes.quotes([symbol])
    return got.get(symbol) or {}


async def structure(symbol: str) -> dict:
    """CAST and EV: debt, leases, preferred and minority interest, cash, and
    the market value of equity, each with the filing it came from."""
    f, q = await asyncio.gather(load(symbol), _market(symbol))
    g = f["gaap"]

    def line(label, tags):
        s = instants(g, tags)
        return {"label": label, "value": s[-1]["val"] if s else None, "as_of": s[-1]["end"] if s else None,
                "form": s[-1].get("form") if s else None, "tag": s[-1]["tag"] if s else None}

    total_debt = line("Long-term debt (incl. current part)", ["LongTermDebt"])
    if total_debt["value"] is None:
        nc, cur = line("", ["LongTermDebtNoncurrent"]), line("", ["LongTermDebtCurrent", "DebtCurrent"])
        if nc["value"] is not None:
            total_debt = {**nc, "label": "Long-term debt (incl. current part)", "value": nc["value"] + (cur["value"] or 0)}
    lines = [
        total_debt,
        line("Commercial paper and short-term borrowings", ["CommercialPaper", "ShortTermBorrowings"]),
        line("Operating lease liabilities", ["OperatingLeaseLiability"]),
        line("Preferred stock", ["PreferredStockValue"]),
        line("Minority interest", ["MinorityInterest"]),
        line("Book equity", ["StockholdersEquity"]),
        line("Cash and equivalents", ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]),
        line("Short-term investments", ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"]),
    ]
    by = {l["label"]: l["value"] or 0.0 for l in lines}
    debt = by["Long-term debt (incl. current part)"] + by["Commercial paper and short-term borrowings"]
    cash = by["Cash and equivalents"] + by["Short-term investments"]
    mcap = q.get("market_cap")
    ev = (mcap + debt + by["Operating lease liabilities"] + by["Preferred stock"] + by["Minority interest"] - cash) if mcap else None
    return {"symbol": symbol, "name": f["name"], "price": q.get("price"), "market_cap": mcap, "lines": lines,
            "debt": debt, "cash": cash, "net_debt": debt - cash, "enterprise_value": ev,
            "debt_to_capital": debt / (debt + mcap) if mcap else None}


async def maturities(symbol: str) -> dict:
    g = (await load(symbol))["gaap"]
    steps = [("Within a year", "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths"),
             ("Year 2", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo"),
             ("Year 3", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree"),
             ("Year 4", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour"),
             ("Year 5", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive"),
             ("After year 5", "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive")]
    series = {label: instants(g, [tag]) for label, tag in steps}
    ends = sorted({e["end"] for s in series.values() for e in s})
    if not ends:
        return {"symbol": symbol, "as_of": None, "rows": []}
    end = ends[-1]
    rows = [{"bucket": label, "amount": next((e["val"] for e in series[label] if e["end"] == end), None)} for label, _ in steps]
    return {"symbol": symbol, "as_of": end, "rows": rows, "total": sum(r["amount"] or 0 for r in rows)}


async def zscores(symbol: str) -> dict:
    f, bars, divs = await asyncio.gather(load(symbol), returns.bars(symbol, "10y"), returns.dividends(symbol))
    g = f["gaap"]
    splits = divs.get("splits") or []
    ta, ca, cl = (latest_by_end(instants(g, t)) for t in (["Assets"], ["AssetsCurrent"], ["LiabilitiesCurrent"]))
    re_, tl, eq = (latest_by_end(instants(g, t)) for t in (["RetainedEarningsAccumulatedDeficit"], ["Liabilities"], ["StockholdersEquity"]))
    ebit, sales, shares = (latest_by_end(annual(g, t)) for t in (OPERATING, REVENUE, SHARES))
    closes = {b["date"]: b["close"] for b in bars}
    out = []
    for end in sorted(ebit):
        if end not in ta:
            continue
        price = next((closes[d] for d in sorted(closes, reverse=True) if d <= end), None)
        # prices are split-adjusted, so the share count must be too
        mve = price * shares[end]["val"] * split_factor(splits, shares[end]["filed"]) if price and end in shares else None
        liabilities = tl[end]["val"] if end in tl else (ta[end]["val"] - eq[end]["val"] if end in eq else None)
        z = altman(ta[end]["val"], ca.get(end, {}).get("val"), cl.get(end, {}).get("val"), re_.get(end, {}).get("val"),
                   ebit[end]["val"], sales.get(end, {}).get("val"), liabilities, mve)
        if z:
            out.append({"year_end": end, **z})
    return {"symbol": symbol, "name": f["name"], "years": out}


async def default_risk(symbol: str) -> dict:
    f, bars, curve, q = await asyncio.gather(load(symbol), returns.bars(symbol, "1y"), rates.curve(), _market(symbol))
    g = f["gaap"]
    cl = value(instants(g, ["LiabilitiesCurrent"]))
    ltd = value(instants(g, ["LongTermDebtNoncurrent", "LongTermDebt"]))
    if cl is None and ltd is None:
        return {"symbol": symbol, "name": f["name"], "error": "No liabilities in the filings (banks and insurers file differently)."}
    # KMV's default point: short-term liabilities plus half the long-term debt
    debt = (cl or 0) + 0.5 * (ltd or 0)
    one_year = curve["curves"][0]["yields"].get("1Y") if curve.get("curves") else None
    r = math.log(1 + one_year / 100) if one_year is not None else 0.04
    sigma = annual_vol([b["close"] for b in bars])
    mcap = q.get("market_cap")
    m = merton(mcap, sigma, debt, r) if mcap and sigma else None
    return {"symbol": symbol, "name": f["name"], "equity": mcap, "equity_vol": sigma, "default_point": debt,
            "current_liabilities": cl, "long_term_debt": ltd, "rate": r, **(m or {"error": "Not enough data."})}


async def default_risks(symbols: list[str]) -> dict:
    got = await asyncio.gather(*(default_risk(s) for s in symbols), return_exceptions=True)
    return {"rows": [g if not isinstance(g, Exception) else {"symbol": s, "error": str(g)} for s, g in zip(symbols, got)]}


FIELDS = {
    "revenue": ("Revenue", REVENUE, None), "operating_income": ("Operating income", OPERATING, None),
    "net_income": ("Net income", NET_INCOME, None), "eps": ("Diluted EPS", EPS, "USD/shares"),
    "operating_cash_flow": ("Operating cash flow", OCF, None), "capex": ("Capital spending", CAPEX, None),
}


async def fundamentals(symbol: str) -> dict:
    """GF: each field annually and quarterly, plus free cash flow and margins."""
    f = await load(symbol)
    g = f["gaap"]
    out = {}
    for key, (label, tags, unit) in FIELDS.items():
        out[key] = {"label": label, "annual": [{"end": e["end"], "val": e["val"]} for e in annual(g, tags, unit)],
                    "quarterly": [{"end": e["end"], "val": e["val"], "derived": e.get("derived", False)} for e in quarterly(g, tags, unit)]}
    for period in ("annual", "quarterly"):
        ocf = {e["end"]: e["val"] for e in out["operating_cash_flow"][period]}
        capex = {e["end"]: e["val"] for e in out["capex"][period]}
        rev = {e["end"]: e["val"] for e in out["revenue"][period]}
        out.setdefault("free_cash_flow", {"label": "Free cash flow", "annual": [], "quarterly": []})[period] = [
            {"end": d, "val": ocf[d] - capex[d]} for d in sorted(ocf) if d in capex]
        for key, label in (("operating_income", "Operating margin %"), ("net_income", "Net margin %")):
            src = {e["end"]: e["val"] for e in out[key][period]}
            out.setdefault(f"{key}_margin", {"label": label, "annual": [], "quarterly": []})[period] = [
                {"end": d, "val": src[d] / rev[d] * 100} for d in sorted(src) if rev.get(d)]
    return {"symbol": symbol, "name": f["name"], "fields": out}


async def pe_history(symbol: str) -> dict:
    """GRET and PEBD: daily price over trailing-twelve-month diluted EPS,
    each EPS used only from the day its last quarter was filed."""
    f, bars, divs = await asyncio.gather(load(symbol), returns.bars(symbol, "10y"), returns.dividends(symbol))
    splits = divs.get("splits") or []
    # prices are split-adjusted; EPS filed before a split is not
    q = [{**e, "val": e["val"] / split_factor(splits, e["filed"])} for e in quarterly(f["gaap"], EPS, "USD/shares", original=True)]
    eps = ttm(q)
    rows = []
    for b in bars:
        e = as_of(eps, b["date"])
        if e:
            rows.append({"date": b["date"], "close": b["close"], "eps_ttm": e["val"],
                         "pe": b["close"] / e["val"] if e["val"] > 0 else None})
    pes = sorted(r["pe"] for r in rows if r["pe"])
    pct = lambda p: pes[min(len(pes) - 1, int(p * len(pes)))] if pes else None  # noqa: E731
    return {"symbol": symbol, "name": f["name"], "rows": rows, "eps": eps,
            "stats": {"median": pct(0.5), "low_decile": pct(0.1), "high_decile": pct(0.9)}}


AS_REPORTED = [("Revenue", REVENUE, None, False), ("Operating income", OPERATING, None, False), ("Net income", NET_INCOME, None, False),
               ("Diluted EPS", EPS, "USD/shares", False), ("Total assets", ["Assets"], None, True),
               ("Total liabilities", ["Liabilities"], None, True), ("Shareholders' equity", ["StockholdersEquity"], None, True),
               ("Operating cash flow", OCF, None, False), ("Capital spending", CAPEX, None, False)]


async def as_reported(symbol: str) -> dict:
    """ARD: the annual figures exactly as filed, with every later filing
    that changed one (a restatement or reclassification)."""
    f = await load(symbol)
    g = f["gaap"]
    out = []
    for label, tags, unit, instant in AS_REPORTED:
        rows = _entries(g, tags, unit)
        rows = [e for e in rows if (not e.get("start")) == instant and (instant or (days(e) or 0) in range(350, 380))
                and e.get("form", "").startswith("10-K")]
        # only the preferred tag for each period (diluted EPS, not basic)
        best = {end: min(x.get("prio", 0) for x in rows if x["end"] == end) for end in {x["end"] for x in rows}}
        by_end: dict[str, list[dict]] = {}
        for e in sorted(rows, key=lambda e: e["filed"]):
            if e.get("prio", 0) == best[e["end"]]:
                by_end.setdefault(e["end"], []).append(e)
        years = []
        for end in sorted(by_end)[-6:]:
            vals = by_end[end]
            first, last = vals[0], vals[-1]
            years.append({"end": end, "first": first["val"], "first_filed": first["filed"], "latest": last["val"],
                          "latest_filed": last["filed"], "accession": last.get("accn"), "tag": last["tag"],
                          "changed": abs(last["val"] - first["val"]) > 1e-9 * max(1, abs(first["val"]))})
        out.append({"label": label, "years": years})
    return {"symbol": symbol, "name": f["name"], "cik": f["cik"], "lines": out}
