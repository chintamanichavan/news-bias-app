"""PRTU, MARS and ATTR: your holdings, their risk, and where their return
came from against the S&P 500.

Risk and attribution treat today's holdings as if held through the whole
window (a buy-and-hold assumption); the screens say so. Returns use
adjusted closes, so dividends count.
"""

import asyncio
import math
from datetime import date, timedelta

from . import quotes, returns, store, web, yahoo

BENCHMARK = "SPY"
TRADING_DAYS = 252

# past episodes replayed on today's holdings
SCENARIOS = [
    ("2018 Q4 sell-off", date(2018, 9, 20), date(2018, 12, 24)),
    ("Covid crash", date(2020, 2, 19), date(2020, 3, 23)),
    ("2022 rate shock", date(2022, 1, 3), date(2022, 10, 12)),
    ("August 2024 carry unwind", date(2024, 7, 16), date(2024, 8, 5)),
]

# Yahoo's sector names -> the SPDR fund that tracks that slice of the S&P 500,
# and the key Yahoo uses in SPY's sector weights
SECTORS = {
    "Technology": ("XLK", "technology"), "Financial Services": ("XLF", "financial_services"),
    "Healthcare": ("XLV", "healthcare"), "Consumer Cyclical": ("XLY", "consumer_cyclical"),
    "Consumer Defensive": ("XLP", "consumer_defensive"), "Communication Services": ("XLC", "communication_services"),
    "Industrials": ("XLI", "industrials"), "Energy": ("XLE", "energy"), "Basic Materials": ("XLB", "basic_materials"),
    "Real Estate": ("XLRE", "realestate"), "Utilities": ("XLU", "utilities"),
}
OTHER = "Other"

PERIODS = {"1m": 30, "3m": 91, "1y": 365}


# ── pure maths ───────────────────────────────────────────────────────────────

def positions(holdings: list[dict], prices: dict[str, float]) -> list[dict]:
    """Lots merged by symbol, valued at current prices, with weights by
    absolute value so shorts count as exposure."""
    merged: dict[str, dict] = {}
    for h in holdings:
        p = merged.setdefault(h["symbol"], {"symbol": h["symbol"], "quantity": 0.0, "cost_value": 0.0, "costed": True})
        p["quantity"] += h["quantity"]
        if h.get("cost") is None:
            p["costed"] = False
        else:
            p["cost_value"] += h["quantity"] * h["cost"]
    rows = []
    for p in merged.values():
        price = prices.get(p["symbol"])
        value = p["quantity"] * price if price is not None else None
        rows.append({**p, "price": price, "value": value,
                     "gain": value - p["cost_value"] if value is not None and p["costed"] else None})
    gross = sum(abs(r["value"]) for r in rows if r["value"] is not None)
    for r in rows:
        r["weight"] = r["value"] / gross if gross and r["value"] is not None else None
    return rows


def daily_returns(rows: list[tuple[date, float, float]]) -> dict[date, float]:
    """day -> total return (adjusted close) from the day before."""
    return {d: a / prev - 1 for (_, _, prev), (d, _, a) in zip(rows, rows[1:]) if prev}


def book_returns(weights: dict[str, float], series: dict[str, dict[date, float]]) -> list[tuple[date, float]]:
    """The weighted portfolio's daily return on every day all holdings traded."""
    held = [s for s in weights if s in series and series[s]]
    if not held:
        return []
    days = sorted(set.intersection(*(set(series[s]) for s in held)))
    total = sum(abs(weights[s]) for s in held)
    return [(d, sum(weights[s] * series[s][d] for s in held) / total) for d in days]


def volatility(rets: list[float]) -> float | None:
    if len(rets) < 20:
        return None
    m = sum(rets) / len(rets)
    return math.sqrt(sum((r - m) ** 2 for r in rets) / (len(rets) - 1) * TRADING_DAYS)


def beta(rets: list[tuple[date, float]], market: dict[date, float]) -> float | None:
    pairs = [(r, market[d]) for d, r in rets if d in market]
    if len(pairs) < 20:
        return None
    mx = sum(m for _, m in pairs) / len(pairs)
    my = sum(r for r, _ in pairs) / len(pairs)
    cov = sum((r - my) * (m - mx) for r, m in pairs)
    var = sum((m - mx) ** 2 for _, m in pairs)
    return cov / var if var else None


def value_at_risk(rets: list[float], level: float) -> tuple[float, float] | None:
    """Historical one-day loss not exceeded on `level` of days, and the
    average loss beyond it (expected shortfall), both as positive fractions."""
    if len(rets) < 50:
        return None
    s = sorted(rets)
    k = max(1, int(math.floor((1 - level) * len(s))))
    tail = s[:k]
    return -s[k - 1], -sum(tail) / len(tail)


def max_drawdown(rets: list[float]) -> float:
    peak = level = 1.0
    worst = 0.0
    for r in rets:
        level *= 1 + r
        peak = max(peak, level)
        worst = min(worst, level / peak - 1)
    return worst


def window_return(rows: list[tuple[date, float, float]], start: date, end: date) -> float | None:
    """Total return from the last close on or before `start` to the last on
    or before `end`; None when the history does not reach back to `start`."""
    a = b = None
    for d, _, adj in rows:
        if d <= start:
            a = adj
        if d <= end:
            b = adj
    return b / a - 1 if a and b else None


def brinson(port: dict[str, tuple[float, float]], bench: dict[str, tuple[float, float]]) -> list[dict]:
    """Brinson-Fachler by sector. Each side maps sector -> (weight, return).
    allocation  = (wp - wb)(Rb_s - Rb), selection = wb (Rp_s - Rb_s),
    interaction = (wp - wb)(Rp_s - Rb_s); they sum to Rp - Rb."""
    rb = sum(w * r for w, r in bench.values())
    out = []
    for s in sorted(set(port) | set(bench)):
        wp, rp = port.get(s, (0.0, 0.0))
        wb, rbs = bench.get(s, (0.0, rb))
        if s not in port:
            rp = rbs          # no holding there: no selection effect to measure
        out.append({
            "sector": s, "port_weight": wp, "bench_weight": wb, "port_return": rp if s in port else None,
            "bench_return": rbs, "allocation": (wp - wb) * (rbs - rb),
            "selection": wb * (rp - rbs), "interaction": (wp - wb) * (rp - rbs),
        })
    return out


# ── assembling the screens ───────────────────────────────────────────────────

async def _book() -> tuple[list[dict], dict[str, dict]]:
    held = store.holdings()
    got = await quotes.quotes([h["symbol"] for h in held])
    return positions(held, {s: q["price"] for s, q in got.items()}), got


async def holdings_view() -> dict:
    rows, got = await _book()
    for r in rows:
        r["name"] = got.get(r["symbol"], {}).get("name")
        r["change_pct"] = got.get(r["symbol"], {}).get("change_pct")
    return {"positions": rows, "lots": store.holdings(),
            "value": sum(r["value"] for r in rows if r["value"] is not None)}


async def risk() -> dict:
    rows, _ = await _book()
    weights = {r["symbol"]: r["weight"] for r in rows if r["weight"]}
    if not weights:
        return {"empty": True}

    async def ten_years(s):
        try:
            return s, (await returns.history(s, "10y", "1d"))["rows"]
        except Exception:
            return s, []
    hist = dict(await asyncio.gather(*(ten_years(s) for s in [*weights, BENCHMARK])))
    series = {s: daily_returns(h) for s, h in hist.items()}
    market = series[BENCHMARK]
    book = book_returns(weights, series)
    last_year = [r for d, r in book if d >= date.today() - timedelta(days=365)]
    value = sum(r["value"] for r in rows if r["value"] is not None)
    var95, var99 = value_at_risk(last_year, 0.95), value_at_risk(last_year, 0.99)
    b = beta([(d, r) for d, r in book if d >= date.today() - timedelta(days=365)], market)

    scenarios = []
    for name, start, end in SCENARIOS:
        per = {s: window_return(hist[s], start, end) for s in weights}
        covered = {s: w for s, w in weights.items() if per[s] is not None}
        share = sum(abs(w) for w in covered.values())
        port = sum(w * per[s] for s, w in covered.items()) / share if share else None
        scenarios.append({"name": name, "start": start.isoformat(), "end": end.isoformat(),
                          "portfolio": port, "benchmark": window_return(hist[BENCHMARK], start, end),
                          "covered_weight": share, "missing": [s for s in weights if per[s] is None]})
    stock_beta = {s: beta([(d, r) for d, r in series[s].items() if d >= date.today() - timedelta(days=365)], market)
                  for s in weights}
    return {
        "value": value, "volatility": volatility(last_year), "beta": b,
        "var_95": var95, "var_99": var99, "max_drawdown_1y": max_drawdown(last_year),
        "max_drawdown_5y": max_drawdown([r for d, r in book if d >= date.today() - timedelta(days=5 * 365)]),
        "days": len(last_year), "scenarios": scenarios,
        "shocks": [{"market": m, "portfolio": m * b if b is not None else None} for m in (-0.05, -0.10, -0.20)],
        "positions": [{**r, "beta": stock_beta.get(r["symbol"])} for r in rows],
    }


async def _sector(symbol: str) -> str:
    try:
        qs = await yahoo.summary(symbol)
    except Exception:
        return OTHER
    sector = (qs.get("assetProfile") or {}).get("sector")
    return sector if sector in SECTORS else OTHER


async def _spy_weights() -> dict[str, float]:
    async def make():
        async with web.client() as c:
            crumb = await yahoo._crumb(c)
            r = await c.get(yahoo.SUMMARY.format(symbol=BENCHMARK),
                            params={"modules": "topHoldings", **({"crumb": crumb} if crumb else {})})
            r.raise_for_status()
            raw = r.json()["quoteSummary"]["result"][0]["topHoldings"]["sectorWeightings"]
        by_key = {k: v["raw"] for item in raw for k, v in item.items()}
        weights = {name: by_key.get(key, 0.0) for name, (_, key) in SECTORS.items()}
        total = sum(weights.values())
        return {k: v / total for k, v in weights.items()} if total else weights
    return await web.cached("spy-sectors", 86400, make)


async def attribution() -> dict:
    rows, _ = await _book()
    weights = {r["symbol"]: r["weight"] for r in rows if r["weight"]}
    if not weights:
        return {"empty": True}
    funds = [etf for etf, _ in SECTORS.values()]
    symbols = [*weights, BENCHMARK, *funds]

    async def year(s):
        try:
            return s, (await returns.history(s, "2y", "1d"))["rows"]
        except Exception:
            return s, []
    hist = dict(await asyncio.gather(*(year(s) for s in symbols)))
    sectors = dict(zip(weights, await asyncio.gather(*(_sector(s) for s in weights))))
    bench_w = await _spy_weights()
    today = date.today()

    periods = {}
    windows = {k: today - timedelta(days=d) for k, d in PERIODS.items()}
    windows["ytd"] = date(today.year - 1, 12, 31)
    for key, start in windows.items():
        ret = {s: window_return(hist[s], start, today) for s in symbols}
        covered = {s: w for s, w in weights.items() if ret[s] is not None}
        share = sum(abs(w) for w in covered.values())
        if not share:
            periods[key] = None
            continue
        contributions = [{"symbol": s, "sector": sectors[s], "weight": w / share, "return": ret[s],
                          "contribution": w / share * ret[s]} for s, w in covered.items()]
        port_return = sum(c["contribution"] for c in contributions)
        by_sector: dict[str, list[dict]] = {}
        for c in contributions:
            by_sector.setdefault(c["sector"], []).append(c)
        port = {s: (sum(c["weight"] for c in cs),
                    sum(c["contribution"] for c in cs) / sum(c["weight"] for c in cs) if sum(c["weight"] for c in cs) else 0.0)
                for s, cs in by_sector.items()}
        bench = {name: (bench_w[name], ret[etf]) for name, (etf, _) in SECTORS.items() if ret[etf] is not None}
        effects = brinson(port, bench)
        periods[key] = {
            "portfolio": port_return, "benchmark": ret[BENCHMARK],
            "sector_benchmark": sum(w * r for w, r in bench.values()),
            "contributions": sorted(contributions, key=lambda c: -c["contribution"]),
            "sectors": effects,
            "missing": [s for s in weights if s not in covered],
        }
    return {"periods": periods}
