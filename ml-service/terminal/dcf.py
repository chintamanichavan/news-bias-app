"""WACC, DCF and DDM: what a company is worth on stated assumptions.

Every input is shown with its source, and any of them can be overridden
from the command line, because a valuation is only as good as its inputs:

- risk-free rate: the 10-year Treasury yield (Treasury's daily curve)
- equity risk premium: Aswath Damodaran's implied premium for the S&P 500,
  published at the start of each month (NYU Stern)
- beta: two years of weekly returns on the S&P 500, Blume-adjusted, as HRA
- cost of debt: interest expense over total debt, from the annual accounts
- tax rate, free cash flow, debt, cash and shares: Yahoo's annual
  fundamentals, which follow the company's filings

The DCF discounts free cash flow to the firm (operating cash flow less
capital spending, plus after-tax interest) for five years of growth and a
perpetual tail. The DDM is a two-stage dividend discount model on the
trailing dividend.

Banks and insurers get no WACC or DCF: their debt is the raw material of
the business (deposits, policy reserves), so free cash flow and a cost of
debt mean nothing. They are valued on dividends only, as is usual.
"""

import asyncio
import math
import re
from datetime import date

from . import quotes, rates, returns, web, yahoo

TIMESERIES = "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}"
DAMODARAN = "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/home.htm"
FIELDS = ["FreeCashFlow", "OperatingCashFlow", "CapitalExpenditure", "InterestExpense", "TotalDebt",
          "TaxRateForCalcs", "DilutedAverageShares", "CashCashEquivalentsAndShortTermInvestments", "TotalRevenue"]
YEARS = 5
TERMINAL_GROWTH = 0.025       # long-run nominal growth, a little under long-run GDP
MAX_GROWTH = 0.15             # no company compounds faster than this for long


# ── the maths ────────────────────────────────────────────────────────────────

def cost_of_equity(rf: float, beta: float, erp: float) -> float:
    return rf + beta * erp


def wacc(equity: float, debt: float, ke: float, kd: float, tax: float) -> float:
    v = equity + debt
    return equity / v * ke + debt / v * kd * (1 - tax)


def gordon(next_payment: float, discount: float, growth: float) -> float | None:
    """Value of a payment growing forever: D1 / (r - g). None when g >= r."""
    return next_payment / (discount - growth) if discount > growth else None


def two_stage(base: float, discount: float, growth: float, years: int, terminal: float) -> dict | None:
    """Present value of `base` growing at `growth` for `years`, then at
    `terminal` forever. Returns the parts so the screen can show them."""
    if discount <= terminal:
        return None
    flows, pv = [], 0.0
    x = base
    for t in range(1, years + 1):
        x *= 1 + growth
        d = x / (1 + discount) ** t
        flows.append({"year": t, "flow": x, "present_value": d})
        pv += d
    tail = gordon(x * (1 + terminal), discount, terminal) / (1 + discount) ** years
    return {"flows": flows, "explicit": pv, "terminal": tail, "total": pv + tail}


def cagr(first: float, last: float, years: float) -> float | None:
    if first <= 0 or last <= 0 or years <= 0:
        return None
    return (last / first) ** (1 / years) - 1


def clamp_growth(g: float | None) -> float:
    return min(max(g if g is not None else 0.0, 0.0), MAX_GROWTH)


def parse_erp(text: str) -> tuple[float, str] | None:
    """'Implied ERP on October 1, 2026 = 4.20%' from Damodaran's home page,
    whose markup splits the number ('4. 20%')."""
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text))
    m = re.search(r"Implied ERP on ([A-Z][a-z]+ \d{1,2}, \d{4}) = ([\d.\s]+)%", t)
    if not m:
        return None
    return float(m.group(2).replace(" ", "")) / 100, m.group(1)


def weekly_beta(stock: list[dict], market: list[dict]) -> dict | None:
    """Raw and Blume-adjusted beta from two years of weekly closes."""
    def weekly(rows):
        out = {}
        for r in rows:
            d = date.fromisoformat(r["date"])
            out[d.isocalendar()[:2]] = (r["date"], r["close"])
        return out
    a, b = weekly(stock), weekly(market)
    weeks = sorted(set(a) & set(b))[-105:]
    xs, ys = [], []
    for w0, w1 in zip(weeks, weeks[1:]):
        xs.append(b[w1][1] / b[w0][1] - 1)
        ys.append(a[w1][1] / a[w0][1] - 1)
    n = len(xs)
    if n < 20:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    raw = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    return {"raw": raw, "adjusted": 2 / 3 * raw + 1 / 3, "weeks": n}


def latest(series: dict, field: str) -> float | None:
    rows = series.get(field) or []
    return rows[-1][1] if rows else None


def parse_timeseries(payload: dict) -> dict[str, list[tuple[str, float]]]:
    """{field: [(as-of date, value)], oldest first} from Yahoo's annual
    fundamentals, dropping years it has no value for."""
    out = {}
    for res in payload.get("timeseries", {}).get("result", []):
        kind = res["meta"]["type"][0]
        field = kind.removeprefix("annual")
        rows = [(v["asOfDate"], v["reportedValue"]["raw"]) for v in res.get(kind) or [] if v and v.get("reportedValue")]
        out[field] = sorted(rows)
    return out


# ── fetching ─────────────────────────────────────────────────────────────────

async def _erp() -> tuple[float, str] | None:
    async def make():
        async with web.client() as c:
            r = await c.get(DAMODARAN)
            r.raise_for_status()
            return parse_erp(r.text)
    try:
        return await web.cached("erp", 86400, make)
    except Exception:
        return None


async def _fundamentals(symbol: str) -> dict:
    async def make():
        async with web.client() as c:
            r = await c.get(TIMESERIES.format(symbol=symbol), params={
                "type": ",".join(f"annual{f}" for f in FIELDS), "period1": 1262304000,
                "period2": int(date.today().strftime("%s")) + 86400 * 366})
            r.raise_for_status()
            return parse_timeseries(r.json())
    return await web.cached(f"fund:{symbol}", 21600, make)


class NoInputs(Exception):
    pass


async def inputs(symbol: str) -> dict:
    """Everything the three models need, each with where it came from."""
    f, curve, erp, got, stock, market, divs, qs = await asyncio.gather(
        _fundamentals(symbol), rates.curve(), _erp(), quotes.quotes([symbol]),
        returns.bars(symbol, "2y"), returns.bars("^GSPC", "2y"), returns.dividends(symbol), yahoo.summary(symbol),
        return_exceptions=True)
    if isinstance(f, Exception) or not f:
        raise NoInputs(f"No annual accounts for {symbol}.")
    q = None if isinstance(got, Exception) else got.get(symbol)
    if not q:
        raise NoInputs(f"No quote for {symbol}.")
    rf = None
    if not isinstance(curve, Exception) and curve.get("curves"):
        ten = curve["curves"][0]["yields"].get("10Y")
        rf = ten / 100 if ten is not None else None
    beta = None if isinstance(stock, Exception) or isinstance(market, Exception) else weekly_beta(stock, market)
    shares = latest(f, "DilutedAverageShares")
    debt = latest(f, "TotalDebt") or 0.0
    interest = abs(latest(f, "InterestExpense") or 0.0)
    tax = latest(f, "TaxRateForCalcs")
    revenue = f.get("TotalRevenue") or []
    growth = None
    if len(revenue) >= 4:
        growth = cagr(revenue[-4][1], revenue[-1][1], 3)
    fcf = latest(f, "FreeCashFlow")
    div_summary = None if isinstance(divs, Exception) else divs.get("summary")
    sector = None if isinstance(qs, Exception) else (qs.get("assetProfile") or {}).get("sector")
    return {
        "symbol": symbol, "price": q["price"], "currency": q.get("currency"), "sector": sector,
        "financial": sector == "Financial Services",
        "shares": shares, "market_cap": q["price"] * shares if shares else None,
        "debt": debt, "cash": latest(f, "CashCashEquivalentsAndShortTermInvestments") or 0.0,
        "interest": interest, "tax": min(max(tax, 0.0), 0.5) if tax is not None else 0.21,
        "fcf": fcf, "fiscal_year_end": (f.get("FreeCashFlow") or [[None]])[-1][0],
        "revenue_growth_3y": growth,
        "rf": rf, "erp": erp[0] if erp else None, "erp_date": erp[1] if erp else None,
        "beta": beta,
        "dividend_ttm": div_summary.get("trailing_12m") if div_summary else None,
        "dividend_growth_5y": div_summary["growth_5y_pct"] / 100 if div_summary and div_summary.get("growth_5y_pct") is not None else None,
    }


def sensitivity(fcff: float, w: float, g: float, tg: float, i: dict) -> dict:
    """Value per share as the discount rate and terminal growth move by half
    points around the chosen ones."""
    ws = [w + d / 100 for d in (-1, -0.5, 0, 0.5, 1)]
    tgs = [tg + d / 100 for d in (-1, -0.5, 0, 0.5)]
    grid = []
    for wi in ws:
        row = []
        for ti in tgs:
            m = two_stage(fcff, wi, g, YEARS, ti)
            row.append((m["total"] - i["debt"] + i["cash"]) / i["shares"] if m else None)
        grid.append(row)
    return {"wacc": ws, "terminal_growth": tgs, "per_share": grid}


def apply(i: dict, o: dict) -> dict:
    """The model run on inputs `i` with the user's overrides `o` (rates as
    fractions): growth, terminal growth, beta, erp, rf, wacc, ke."""
    rf = o.get("rf", i["rf"])
    erp = o.get("erp", i["erp"])
    beta = o.get("beta", (i["beta"] or {}).get("adjusted"))
    missing = [k for k, v in (("risk-free rate", rf), ("equity risk premium", erp), ("beta", beta)) if v is None]
    if missing:
        return {"missing": missing}
    ke = o.get("ke", cost_of_equity(rf, beta, erp))
    kd = i["interest"] / i["debt"] if i["debt"] else rf
    kd = min(max(kd, rf * 0.5), 0.2)          # a stale or odd interest line never sets a silly rate
    equity = i["market_cap"] or 0.0
    w = None if i.get("financial") else o.get("wacc", wacc(equity, i["debt"], ke, kd, i["tax"]) if equity else None)
    out = {"rf": rf, "erp": erp, "beta": beta, "ke": ke, "kd": kd, "kd_after_tax": kd * (1 - i["tax"]),
           "equity_weight": equity / (equity + i["debt"]) if equity else None, "wacc": w}

    g = o.get("growth", clamp_growth(i["revenue_growth_3y"]))
    tg = o.get("terminal_growth", min(TERMINAL_GROWTH, rf))
    out.update(growth=g, terminal_growth=tg)
    if i["fcf"] is not None and i["fcf"] > 0 and w and i["shares"]:
        fcff = i["fcf"] + i["interest"] * (1 - i["tax"])
        model = two_stage(fcff, w, g, YEARS, tg)
        if model:
            equity_value = model["total"] - i["debt"] + i["cash"]
            per_share = equity_value / i["shares"]
            out["dcf"] = {**model, "base_fcff": fcff, "enterprise_value": model["total"], "equity_value": equity_value,
                          "per_share": per_share, "upside_pct": (per_share / i["price"] - 1) * 100,
                          "terminal_share": model["terminal"] / model["total"],
                          "sensitivity": sensitivity(fcff, w, g, tg, i)}
    d0 = i["dividend_ttm"]
    if d0:
        dg = o.get("dividend_growth", clamp_growth(i["dividend_growth_5y"]))
        model = two_stage(d0, ke, dg, YEARS, min(dg, tg))
        if model:
            out["ddm"] = {**model, "dividend": d0, "growth": dg, "terminal_growth": min(dg, tg),
                          "per_share": model["total"], "upside_pct": (model["total"] / i["price"] - 1) * 100}
    return out


async def valuation(symbol: str, overrides: dict) -> dict:
    i = await inputs(symbol)
    return {"inputs": i, "model": apply(i, overrides)}
