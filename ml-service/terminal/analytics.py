"""Portfolio analytics on the PRTU book: LRSK (how long to sell each
holding), PSD (the book's weighted fundamentals), PSH (a trade's effect
before it is made), HEFF (hedge effectiveness), UNCL (your own tags) and
FTST (Fama-French factors: their record, and a book's or security's
loadings on them).
"""

import asyncio
import io
import math
import zipfile
from datetime import date, timedelta

from . import book, quotes, returns, store, web

FRENCH = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/{name}"
FACTOR_FILES = {"five": "F-F_Research_Data_5_Factors_2x3_CSV.zip", "momentum": "F-F_Momentum_Factor_CSV.zip"}
FACTORS = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom"]
FACTOR_NAMES = {"Mkt-RF": "Market less cash", "SMB": "Small less big", "HML": "Value less growth", "RMW": "Profitable less unprofitable",
                "CMA": "Conservative less aggressive investment", "Mom": "Winners less losers (momentum)"}


# ── maths ────────────────────────────────────────────────────────────────────

def solve(a: list[list[float]], b: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(m[r][c]))
        m[c], m[p] = m[p], m[c]
        if abs(m[c][c]) < 1e-15:
            raise ValueError("singular")
        for r in range(c + 1, n):
            f = m[r][c] / m[c][c]
            for k in range(c, n + 1):
                m[r][k] -= f * m[c][k]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        x[r] = (m[r][n] - sum(m[r][k] * x[k] for k in range(r + 1, n))) / m[r][r]
    return x


def ols(y: list[float], X: list[list[float]]) -> dict:
    """Least squares with an intercept: coefficients, t-statistics, R²."""
    rows = [[1.0] + x for x in X]
    k, n = len(rows[0]), len(rows)
    xtx = [[sum(r[i] * r[j] for r in rows) for j in range(k)] for i in range(k)]
    xty = [sum(r[i] * yi for r, yi in zip(rows, y)) for i in range(k)]
    beta = solve(xtx, xty)
    fit = [sum(b * v for b, v in zip(beta, r)) for r in rows]
    resid = [a - f for a, f in zip(y, fit)]
    sse = sum(e * e for e in resid)
    my = sum(y) / n
    sst = sum((a - my) ** 2 for a in y)
    s2 = sse / (n - k) if n > k else float("nan")
    inv_diag = []
    for i in range(k):
        e = [1.0 if j == i else 0.0 for j in range(k)]
        inv_diag.append(solve(xtx, e)[i])
    se = [math.sqrt(max(s2 * d, 0)) for d in inv_diag]
    return {"coef": beta, "t": [b / s if s else None for b, s in zip(beta, se)], "r2": 1 - sse / sst if sst else None, "n": n}


def days_to_liquidate(quantity: float, avg_volume: float | None, participation: float) -> float | None:
    return abs(quantity) / (participation * avg_volume) if avg_volume else None


def dollar_offset(position: list[float], hedge: list[float]) -> float | None:
    """Cumulative change in the hedge over cumulative change in the hedged
    item; a hedge is usually called effective between -0.8 and -1.25."""
    dp, dh = sum(position), sum(hedge)
    return dh / dp if dp else None


# ── LRSK, PSD ────────────────────────────────────────────────────────────────

async def liquidity(participation: float = 0.2) -> dict:
    rows, got = await book._book()
    out = []
    for r in rows:
        q = got.get(r["symbol"], {})
        adv = q.get("avg_volume_3m")
        out.append({"symbol": r["symbol"], "name": q.get("name"), "quantity": r["quantity"], "value": r["value"], "weight": r["weight"],
                    "avg_volume": adv, "pct_of_adv": abs(r["quantity"]) / adv * 100 if adv else None,
                    "days": days_to_liquidate(r["quantity"], adv, participation)})
    out.sort(key=lambda x: -(x["days"] or 0))
    worst = max((x["days"] or 0 for x in out), default=0)
    within = lambda d: sum(abs(x["weight"] or 0) for x in out if (x["days"] or 0) <= d) * 100  # noqa: E731
    return {"participation": participation, "rows": out, "days_to_exit": worst,
            "liquid_1d_pct": within(1), "liquid_5d_pct": within(5)}


async def book_fundamentals() -> dict:
    rows, got = await book._book()
    held = [r for r in rows if r["weight"]]
    def weighted(key, invert=False):
        pairs = [(r["weight"], got.get(r["symbol"], {}).get(key)) for r in held]
        pairs = [(w, v) for w, v in pairs if v]
        tw = sum(abs(w) for w, _ in pairs)
        if not tw:
            return None, 0
        if invert:   # P/E is averaged through earnings yields, so one huge multiple cannot dominate
            ey = sum(w * (1 / v) for w, v in pairs) / tw
            return (1 / ey if ey > 0 else None), tw
        return sum(w * v for w, v in pairs) / tw, tw
    out = {}
    for key, label, inv in (("pe", "P/E, trailing", True), ("forward_pe", "P/E, forward", True), ("price_to_book", "Price to book", True),
                            ("dividend_yield", "Dividend yield %", False), ("change_52w_pct", "52-week return %", False)):
        v, cover = weighted(key, inv)
        out[key] = {"label": label, "value": v, "coverage": cover}
    caps = sorted((got.get(r["symbol"], {}).get("market_cap") or 0, abs(r["weight"])) for r in held)
    acc, median_cap = 0.0, None
    for cap, w in caps:
        acc += w
        if acc >= 0.5 * sum(x for _, x in caps):
            median_cap = cap
            break
    return {"measures": out, "weighted_median_cap": median_cap,
            "rows": [{"symbol": r["symbol"], "weight": r["weight"], **{k: got.get(r["symbol"], {}).get(k) for k in ("pe", "forward_pe", "price_to_book", "dividend_yield", "market_cap")}} for r in held]}


# ── PSH ──────────────────────────────────────────────────────────────────────

async def _stats(weights: dict[str, float]) -> dict:
    if not weights:
        return {}
    async def hist(s):
        try:
            return s, (await returns.history(s, "1y", "1d"))["rows"]
        except Exception:
            return s, []
    h = dict(await asyncio.gather(*(hist(s) for s in [*weights, book.BENCHMARK])))
    series = {s: book.daily_returns(rows) for s, rows in h.items()}
    rets = book.book_returns(weights, series)
    flat = [r for _, r in rets]
    return {"volatility": book.volatility(flat), "beta": book.beta(rets, series[book.BENCHMARK]),
            "var_95": book.value_at_risk(flat, 0.95), "max_drawdown": book.max_drawdown(flat)}


async def what_if(trades: list[dict]) -> dict:
    held = store.holdings()
    after = held + [{"symbol": t["symbol"].upper(), "quantity": t["quantity"], "cost": None} for t in trades]
    got = await quotes.quotes(list({h["symbol"] for h in after}))
    prices = {s: q["price"] for s, q in got.items()}
    before_rows, after_rows = book.positions(held, prices), book.positions(after, prices)
    wb = {r["symbol"]: r["weight"] for r in before_rows if r["weight"]}
    wa = {r["symbol"]: r["weight"] for r in after_rows if r["weight"]}
    sb, sa = await asyncio.gather(_stats(wb), _stats(wa))
    symbols = sorted(set(wb) | set(wa), key=lambda s: -abs(wa.get(s, 0)))
    return {"trades": trades, "before": {**sb, "value": sum(r["value"] or 0 for r in before_rows)},
            "after": {**sa, "value": sum(r["value"] or 0 for r in after_rows)},
            "weights": [{"symbol": s, "before": wb.get(s), "after": wa.get(s)} for s in symbols]}


# ── HEFF ─────────────────────────────────────────────────────────────────────

async def hedge(symbol: str, hedge_symbol: str, quantity: float, hedge_quantity: float | None) -> dict:
    a, b = await asyncio.gather(returns.bars(symbol, "1y"), returns.bars(hedge_symbol, "1y"))
    pa, pb = {x["date"]: x["close"] for x in a}, {x["date"]: x["close"] for x in b}
    days = sorted(set(pa) & set(pb))
    # dollar changes of a long position and of one unit of the hedge
    dp = [quantity * (pa[d1] - pa[d0]) for d0, d1 in zip(days, days[1:])]
    dh1 = [pb[d1] - pb[d0] for d0, d1 in zip(days, days[1:])]
    fit = ols(dp, [[x] for x in dh1])
    ratio = fit["coef"][1]                          # units of hedge per position, to short
    hq = hedge_quantity if hedge_quantity is not None else -ratio
    dh = [hq * x for x in dh1]
    resid = [p + h for p, h in zip(dp, dh)]
    sd = lambda xs: math.sqrt(sum((x - sum(xs) / len(xs)) ** 2 for x in xs) / (len(xs) - 1))  # noqa: E731
    reg = ols(dh, [[x] for x in dp])
    return {"symbol": symbol, "hedge": hedge_symbol, "quantity": quantity, "days": len(dp),
            "optimal_hedge_units": -ratio, "hedge_units": hq, "r2": fit["r2"],
            "slope": reg["coef"][1], "dollar_offset": dollar_offset(dp, dh),
            "risk_unhedged": sd(dp), "risk_hedged": sd(resid),
            "variance_reduction": 1 - (sd(resid) / sd(dp)) ** 2 if sd(dp) else None,
            "effective": (fit["r2"] or 0) >= 0.8 and -1.25 <= reg["coef"][1] <= -0.8}


# ── UNCL ─────────────────────────────────────────────────────────────────────

async def by_tag() -> dict:
    rows, _ = await book._book()
    tags = store.tags()
    groups: dict[str, dict] = {}
    for r in rows:
        for t in tags.get(r["symbol"], ["Untagged"]):
            g = groups.setdefault(t, {"tag": t, "weight": 0.0, "value": 0.0, "symbols": []})
            g["weight"] += r["weight"] or 0
            g["value"] += r["value"] or 0
            g["symbols"].append(r["symbol"])
    return {"groups": sorted(groups.values(), key=lambda g: -g["weight"]), "tags": tags}


# ── FTST ─────────────────────────────────────────────────────────────────────

def parse_french(text: str) -> dict[str, dict[str, float]]:
    """{YYYY-MM: {factor: monthly return as a fraction}} from the monthly
    block at the top of a French library CSV (annual figures follow and
    are left out)."""
    out: dict[str, dict[str, float]] = {}
    header = None
    for line in text.splitlines():
        cells = [c.strip() for c in line.split(",")]
        if header is None:
            if len(cells) > 1 and cells[0] == "" and cells[1]:
                header = cells[1:]
            continue
        if not cells[0]:
            if out:
                break
            continue
        if len(cells[0]) != 6 or not cells[0].isdigit():
            if out:
                break
            continue
        month = f"{cells[0][:4]}-{cells[0][4:]}"
        out[month] = {h: float(v) / 100 for h, v in zip(header, cells[1:]) if v not in ("", "-99.99", "-999")}
    return out


async def factors() -> dict[str, dict[str, float]]:
    async def make():
        merged: dict[str, dict[str, float]] = {}
        async with web.client() as c:
            for f in FACTOR_FILES.values():
                r = await c.get(FRENCH.format(name=f))
                r.raise_for_status()
                z = zipfile.ZipFile(io.BytesIO(r.content))
                for month, vals in parse_french(z.read(z.namelist()[0]).decode("latin-1")).items():
                    merged.setdefault(month, {}).update(vals)
        return merged
    return await web.cached("french", 7 * 86400, make)


def factor_record(f: dict[str, dict[str, float]], since: str) -> list[dict]:
    months = sorted(m for m in f if m >= since)
    out = []
    for k in FACTORS:
        xs = [f[m][k] for m in months if k in f[m]]
        if len(xs) < 12:
            continue
        mean, sd = sum(xs) / len(xs), math.sqrt(sum((x - sum(xs) / len(xs)) ** 2 for x in xs) / (len(xs) - 1))
        growth = 1.0
        path = []
        for m in months:
            if k in f[m]:
                growth *= 1 + f[m][k]
                path.append({"t": f"{m}-28", "v": growth * 100})
        out.append({"factor": k, "name": FACTOR_NAMES[k], "months": len(xs), "annual_mean": mean * 12, "annual_vol": sd * math.sqrt(12),
                    "sharpe": mean / sd * math.sqrt(12) if sd else None, "t": mean / (sd / math.sqrt(len(xs))) if sd else None,
                    "cumulative": growth - 1, "path": path})
    return out


async def factor_view(symbol: str | None, years: int) -> dict:
    f = await factors()
    since = f"{date.today().year - years}-{date.today().month:02d}"
    out = {"from": since, "to": max(f), "record": factor_record(f, since)}
    if symbol:
        bars = await returns.bars(symbol, "10y" if years > 5 else "5y")
        last: dict[str, float] = {}
        for b in bars:
            last[b["date"][:7]] = b.get("adj_close") or b["close"]
        ms = sorted(last)
        rets = {m: last[m] / last[p] - 1 for p, m in zip(ms, ms[1:])}
        months = [m for m in sorted(rets) if m in f and m >= since and all(k in f[m] for k in FACTORS)]
        if len(months) >= 24:
            y = [rets[m] - f[m]["RF"] for m in months]
            fit = ols(y, [[f[m][k] for k in FACTORS] for m in months])
            out["loadings"] = {"symbol": symbol, "months": len(months), "r2": fit["r2"],
                               "alpha_annual": fit["coef"][0] * 12, "alpha_t": fit["t"][0],
                               "factors": [{"factor": k, "name": FACTOR_NAMES[k], "loading": fit["coef"][i + 1], "t": fit["t"][i + 1]}
                                           for i, k in enumerate(FACTORS)]}
    return out
