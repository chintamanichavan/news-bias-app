"""Funds and ETFs: FREP (a fund's report), MIFA (its holdings and terms),
FPC (funds compared), FSTA (returns-based style analysis), WETF (bond
ETFs) and CETF (commodity ETFs). Fund terms, returns against the
category, risk figures and top holdings come from Yahoo; style analysis
is computed here from monthly total returns.
"""

import asyncio
import math
from datetime import date

from . import quotes, returns, web, yahoo

MODULES = "fundProfile,fundPerformance,topHoldings,summaryDetail,defaultKeyStatistics,price"

# Sharpe's style indices, as funds anyone can hold
STYLES = [("IWF", "US large growth"), ("IWD", "US large value"), ("IWO", "US small growth"), ("IWN", "US small value"),
          ("EFA", "Developed ex-US"), ("EEM", "Emerging markets"), ("AGG", "US bonds"), ("BIL", "Cash (T-bills)")]

BOND_ETFS = ["BIL", "SGOV", "SHY", "IEI", "IEF", "TLT", "TIP", "AGG", "BND", "BNDX", "LQD", "VCIT", "VCSH", "HYG", "JNK", "EMB", "MUB", "MBB"]
COMMODITY_ETFS = ["GLD", "IAU", "SLV", "PPLT", "PALL", "CPER", "USO", "BNO", "UNG", "UGA", "DBC", "PDBC", "GSG", "DBA", "CORN", "WEAT", "SOYB", "URA"]


def raw(x):
    return x.get("raw") if isinstance(x, dict) else x


async def summary(symbol: str) -> dict:
    async def make():
        async with web.client() as c:
            crumb = await yahoo._crumb(c)
            r = await c.get(yahoo.SUMMARY.format(symbol=symbol), params={"modules": MODULES, **({"crumb": crumb} if crumb else {})})
            r.raise_for_status()
            res = r.json()["quoteSummary"]["result"]
            if not res:
                raise yahoo.NotFound(f"Yahoo has no fund data for {symbol}.")
            return res[0]
    return await web.cached(f"fundqs:{symbol}", 6 * 3600, make)


PERIODS = [("ytd", "Year to date"), ("oneMonth", "1 month"), ("threeMonth", "3 months"), ("oneYear", "1 year"),
           ("threeYear", "3 years, a year"), ("fiveYear", "5 years, a year"), ("tenYear", "10 years, a year")]


def report(qs: dict) -> dict:
    fp, perf, th = qs.get("fundProfile") or {}, qs.get("fundPerformance") or {}, qs.get("topHoldings") or {}
    ks, sd, pr = qs.get("defaultKeyStatistics") or {}, qs.get("summaryDetail") or {}, qs.get("price") or {}
    fees = fp.get("feesExpensesInvestment") or {}
    tr, cat = perf.get("trailingReturns") or {}, perf.get("trailingReturnsCat") or {}
    risk = []
    for block in (perf.get("riskOverviewStatistics") or {}).get("riskStatistics", []):
        risk.append({"period": block.get("year"), **{k: raw(block.get(k)) for k in ("alpha", "beta", "meanAnnualReturn", "rSquared", "stdDev", "sharpeRatio", "treynorRatio")}})
    return {
        "name": pr.get("longName") or pr.get("shortName"), "category": fp.get("categoryName") or ks.get("category"),
        "family": fp.get("family"), "type": fp.get("legalType") or pr.get("quoteType"),
        "expense_ratio": raw(fees.get("annualReportExpenseRatio")) or raw(ks.get("annualReportExpenseRatio")),
        "turnover": raw(fees.get("annualHoldingsTurnover")), "assets": raw(ks.get("totalAssets")) or raw(sd.get("totalAssets")),
        "yield": raw(ks.get("yield")) or raw(sd.get("yield")), "beta_3y": raw(ks.get("beta3Year")),
        "trailing": [{"period": label, "fund": raw(tr.get(k)), "category": raw(cat.get(k))} for k, label in PERIODS],
        "annual": [{"year": a.get("year"), "fund": raw(a.get("annualValue"))} for a in (perf.get("annualTotalReturns") or {}).get("returns", [])][:10],
        "risk": risk,
        "holdings": [{"symbol": h.get("symbol"), "name": h.get("holdingName"), "weight": raw(h.get("holdingPercent"))} for h in th.get("holdings", [])],
        "sectors": sorted([{"sector": k, "weight": raw(v)} for s in th.get("sectorWeightings", []) for k, v in s.items() if raw(v)], key=lambda x: -x["weight"]),
        "ratings": [{"rating": k, "weight": raw(v)} for s in th.get("bondRatings", []) for k, v in s.items() if raw(v)],
        "asset_mix": {k: raw(th.get(k)) for k in ("stockPosition", "bondPosition", "cashPosition", "otherPosition", "preferredPosition", "convertiblePosition")},
    }


async def fund(symbol: str) -> dict:
    return {"symbol": symbol, **report(await summary(symbol))}


async def compare(symbols: list[str]) -> dict:
    got = await asyncio.gather(*(fund(s) for s in symbols), return_exceptions=True)
    return {"rows": [g if not isinstance(g, Exception) else {"symbol": s, "error": str(g)} for s, g in zip(symbols, got)]}


# ── returns-based style analysis ─────────────────────────────────────────────

def project_simplex(v: list[float]) -> list[float]:
    """Euclidean projection onto {w >= 0, sum w = 1} (Duchi et al., 2008)."""
    u = sorted(v, reverse=True)
    css, rho, theta = 0.0, -1, 0.0
    for i, x in enumerate(u):
        css += x
        t = (css - 1) / (i + 1)
        if x - t > 0:
            rho, theta = i, t
    return [max(x - theta, 0.0) for x in v]


def style_weights(y: list[float], X: list[list[float]], iters: int = 20000) -> list[float]:
    """Sharpe's style analysis: least squares of y on the columns of X with
    weights that are non-negative and sum to one, by projected gradient."""
    n, k = len(y), len(X[0])
    xtx = [[sum(X[t][i] * X[t][j] for t in range(n)) for j in range(k)] for i in range(k)]
    xty = [sum(X[t][i] * y[t] for t in range(n)) for i in range(k)]
    step = 1.0 / max(sum(abs(v) for v in row) for row in xtx)        # 1 / a bound on the largest eigenvalue
    w = [1.0 / k] * k
    for _ in range(iters):
        grad = [sum(xtx[i][j] * w[j] for j in range(k)) - xty[i] for i in range(k)]
        w_new = project_simplex([w[i] - step * grad[i] for i in range(k)])
        if max(abs(a - b) for a, b in zip(w, w_new)) < 1e-12:
            w = w_new
            break
        w = w_new
    return w


def empirical_duration(fund_bars: list[dict], yield_bars: list[dict]) -> float | None:
    """Rate sensitivity measured, not stated: minus the slope of the fund's
    daily total return on the daily change in the 10-year yield (in
    percentage points), times 100. Yahoo's own duration figures for these
    funds are wrong (TLT 3.6 years), so they are not used."""
    px = {b["date"]: b.get("adj_close") or b["close"] for b in fund_bars}
    yl = {b["date"]: b["close"] for b in yield_bars}
    days = sorted(set(px) & set(yl))
    xs, ys = [], []
    for a, b in zip(days, days[1:]):
        if px[a]:
            ys.append(px[b] / px[a] - 1)
            xs.append(yl[b] - yl[a])
    if len(xs) < 60:
        return None
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    if not sxx:
        return None
    return -sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx * 100


def monthly_returns(bars: list[dict]) -> dict[str, float]:
    last: dict[str, float] = {}
    for b in bars:
        last[b["date"][:7]] = b.get("adj_close") or b["close"]
    months = sorted(last)
    return {m: last[m] / last[p] - 1 for p, m in zip(months, months[1:])}


async def style(symbol: str) -> dict:
    async def make():
        names = [symbol] + [s for s, _ in STYLES]
        bars = await asyncio.gather(*(returns.bars(s, "5y") for s in names))
        rets = [monthly_returns(b) for b in bars]
        months = sorted(set.intersection(*(set(r) for r in rets)))[:-1]       # leave out the month in progress
        if len(months) < 24:
            raise yahoo.NotFound(f"Not enough history to analyse {symbol}'s style.")
        y = [rets[0][m] for m in months]
        X = [[r[m] for r in rets[1:]] for m in months]
        w = style_weights(y, X)
        fit = [sum(wi * xi for wi, xi in zip(w, row)) for row in X]
        resid = [a - b for a, b in zip(y, fit)]
        my = sum(y) / len(y)
        r2 = 1 - sum(e * e for e in resid) / sum((a - my) ** 2 for a in y)
        te = math.sqrt(sum(e * e for e in resid) / (len(resid) - 1) * 12)
        sel = sum(resid) / len(resid) * 12
        return {"symbol": symbol, "months": len(months), "from": months[0], "to": months[-1],
                "weights": [{"symbol": s, "style": n, "weight": wi} for (s, n), wi in zip(STYLES, w)],
                "r_squared": r2, "tracking_error": te, "selection_return": sel}
    return await web.cached(f"style:{symbol}", 6 * 3600, make)


async def etf_monitor(kind: str) -> dict:
    async def make():
        syms = BOND_ETFS if kind == "bond" else COMMODITY_ETFS
        q = await quotes.quotes(syms)
        extra = await asyncio.gather(*(summary(s) for s in syms), return_exceptions=True)
        durations = {}
        if kind == "bond":
            tnx = await returns.bars("^TNX", "1y")
            fb = await asyncio.gather(*(returns.bars(s, "1y") for s in syms), return_exceptions=True)
            durations = {s: empirical_duration(b, tnx) for s, b in zip(syms, fb) if not isinstance(b, Exception)}
        rows = []
        for s, e in zip(syms, extra):
            x = q.get(s)
            if not x:
                continue
            rep = report(e) if not isinstance(e, Exception) else {}
            rows.append({"symbol": s, "name": x["name"], "price": x["price"], "change_pct": x["change_pct"],
                         "change_52w_pct": x["change_52w_pct"], "yield": rep.get("yield"), "duration": durations.get(s),
                         "expense_ratio": rep.get("expense_ratio"), "assets": rep.get("assets"),
                         "category": rep.get("category"), "ytd": next((t["fund"] for t in rep.get("trailing", []) if t["period"] == "Year to date"), None)})
        return {"kind": kind, "rows": rows}
    return await web.cached(f"etfmon:{kind}", 1800, make)
