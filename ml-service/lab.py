"""
Research Lab — the deep-statistics dossier for any tradable security.

One symbol in (equity, FX pair, future, commodity, index, crypto — anything
Yahoo's chart API quotes), one quantitative dossier out:

- moments:        annualized return/vol, skewness, excess kurtosis
- risk-adjusted:  Sharpe, Sortino, max drawdown, Calmar
- tails:          historical VaR and CVaR at 95/99, best/worst days
- distribution:   Jarque-Bera normality test, histogram vs fitted normal
- dependence:     return autocorrelation (efficiency probe), |r| autocorr
                  (volatility clustering), Hurst exponent via rescaled range
- regime:         50/200-day trend state, distance from 52-week extremes,
                  rolling 30-day vol series
- relative:       beta and correlation vs a benchmark (SPY by default)
- platform join:  the engine's composite history and recent scored headlines
- derivatives:    nearest-expiry options read (ATM IV, put/call OI) where a
                  chain exists; degrades to null elsewhere

Everything is computed from daily closes — the honest resolution for a
research lab fed by free data.
"""

import math
from statistics import NormalDist

import httpx
from scipy import stats as sstats

import db
import simulation
import universe

YAHOO_HEADERS = simulation.YAHOO_HEADERS
TRADING_DAYS = 252
BENCHMARK = "SPY"

# quoteSummary and options need a session cookie + crumb; fetch once, reuse.
_crumb_cache: dict = {"crumb": None, "cookies": None, "at": 0.0}


async def _yahoo_session(client: httpx.AsyncClient) -> str | None:
    import time as _t
    if _crumb_cache["crumb"] and _t.time() - _crumb_cache["at"] < 1800:
        client.cookies.update(_crumb_cache["cookies"])
        return _crumb_cache["crumb"]
    try:
        await client.get("https://fc.yahoo.com", follow_redirects=True)
        r = await client.get("https://query1.finance.yahoo.com/v1/test/getcrumb")
        crumb = r.text.strip()
        if crumb and "<" not in crumb:
            _crumb_cache.update(crumb=crumb, cookies=dict(client.cookies), at=_t.time())
            return crumb
    except Exception:
        pass
    return None


def _returns(closes: list[float]) -> list[float]:
    return [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes)) if closes[i - 1]]


def _acf(xs: list[float], lag: int) -> float | None:
    n = len(xs)
    if n <= lag + 2:
        return None
    mean = sum(xs) / n
    var = sum((x - mean) ** 2 for x in xs)
    if var == 0:
        return None
    cov = sum((xs[i] - mean) * (xs[i + lag] - mean) for i in range(n - lag))
    return round(cov / var, 3)


def _hurst(closes: list[float]) -> float | None:
    """Rescaled-range Hurst estimate. ~0.5 random walk, >0.5 trending,
    <0.5 mean-reverting. Needs a few hundred points to mean much."""
    rets = _returns(closes)
    if len(rets) < 100:
        return None
    spans = [8, 16, 32, 64]
    log_rs, log_n = [], []
    for span in spans:
        rs_vals = []
        for start in range(0, len(rets) - span + 1, span):
            chunk = rets[start:start + span]
            mean = sum(chunk) / span
            dev = [c - mean for c in chunk]
            cum = []
            s = 0.0
            for d in dev:
                s += d
                cum.append(s)
            r = max(cum) - min(cum)
            sd = math.sqrt(sum(d * d for d in dev) / span)
            if sd > 0:
                rs_vals.append(r / sd)
        if rs_vals:
            log_rs.append(math.log(sum(rs_vals) / len(rs_vals)))
            log_n.append(math.log(span))
    if len(log_rs) < 3:
        return None
    slope, *_ = sstats.linregress(log_n, log_rs)
    return round(float(slope), 3)


def _drawdown(closes: list[float]) -> tuple[float, int]:
    peak, max_dd, dd_days, cur_days = closes[0], 0.0, 0, 0
    for c in closes:
        if c >= peak:
            peak, cur_days = c, 0
        else:
            cur_days += 1
            dd = c / peak - 1
            if dd < max_dd:
                max_dd, dd_days = dd, cur_days
    return max_dd, dd_days


async def _options_read(symbol: str) -> dict | None:
    """Nearest-expiry chain summary; None wherever no chain exists."""
    try:
        async with httpx.AsyncClient(timeout=12, headers=YAHOO_HEADERS) as client:
            crumb = await _yahoo_session(client)
            r = await client.get(
                f"https://query2.finance.yahoo.com/v7/finance/options/{symbol}",
                params={"crumb": crumb} if crumb else None,
            )
            r.raise_for_status()
            res = r.json()["optionChain"]["result"][0]
        chain = res.get("options", [{}])[0]
        calls, puts = chain.get("calls", []), chain.get("puts", [])
        if not calls and not puts:
            return None
        spot = res.get("quote", {}).get("regularMarketPrice")
        atm_iv = None
        if spot and calls:
            atm = min(calls, key=lambda c: abs(c.get("strike", 0) - spot))
            atm_iv = atm.get("impliedVolatility")
        call_oi = sum(c.get("openInterest") or 0 for c in calls)
        put_oi = sum(p.get("openInterest") or 0 for p in puts)
        return {
            "expiry": chain.get("expirationDate"),
            "atm_iv_pct": round(atm_iv * 100, 1) if atm_iv else None,
            "put_call_oi": round(put_oi / call_oi, 2) if call_oi else None,
            "contracts": len(calls) + len(puts),
        }
    except Exception:
        return None


_QS_MODULES = ("assetProfile,summaryDetail,defaultKeyStatistics,"
               "financialData,calendarEvents,price")


def _raw(node: dict | None, key: str):
    """Yahoo wraps numbers as {raw, fmt}; unwrap either shape."""
    v = (node or {}).get(key)
    if isinstance(v, dict):
        return v.get("raw")
    return v


async def _profile(symbol: str) -> dict | None:
    """Detailed instrument profile from Yahoo quoteSummary: identity,
    valuation, per-share, dividends, profitability, growth, balance sheet,
    analyst view, calendar, share stats. Endpoint sometimes requires a
    session crumb — degrade to None and let the dossier stand on the
    price-derived statistics."""
    try:
        async with httpx.AsyncClient(timeout=12, headers=YAHOO_HEADERS) as client:
            crumb = await _yahoo_session(client)
            params = {"modules": _QS_MODULES}
            if crumb:
                params["crumb"] = crumb
            r = await client.get(
                f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{symbol}",
                params=params,
            )
            r.raise_for_status()
            res = r.json()["quoteSummary"]["result"][0]
    except Exception:
        return None

    ap = res.get("assetProfile", {})
    sd = res.get("summaryDetail", {})
    ks = res.get("defaultKeyStatistics", {})
    fd = res.get("financialData", {})
    ce = res.get("calendarEvents", {})
    pr = res.get("price", {})

    earnings = None
    try:
        earnings = (ce.get("earnings", {}).get("earningsDate") or [{}])[0].get("fmt")
    except (AttributeError, IndexError):
        pass

    def pct(v):
        return round(v * 100, 2) if isinstance(v, (int, float)) else None

    return {
        "identity": {
            "long_name": _raw(pr, "longName") or _raw(pr, "shortName"),
            "exchange": _raw(pr, "exchangeName"),
            "currency": _raw(pr, "currency"),
            "quote_type": _raw(pr, "quoteType"),
            "sector": ap.get("sector"),
            "industry": ap.get("industry"),
            "country": ap.get("country"),
            "employees": ap.get("fullTimeEmployees"),
            "website": ap.get("website"),
            "summary": (ap.get("longBusinessSummary") or "")[:700] or None,
        },
        "valuation": {
            "market_cap": _raw(sd, "marketCap") or _raw(pr, "marketCap"),
            "enterprise_value": _raw(ks, "enterpriseValue"),
            "trailing_pe": _raw(sd, "trailingPE"),
            "forward_pe": _raw(sd, "forwardPE") or _raw(ks, "forwardPE"),
            "peg": _raw(ks, "pegRatio"),
            "price_to_book": _raw(ks, "priceToBook"),
            "price_to_sales": _raw(sd, "priceToSalesTrailing12Months"),
            "ev_to_ebitda": _raw(ks, "enterpriseToEbitda"),
        },
        "per_share": {
            "eps_ttm": _raw(ks, "trailingEps"),
            "eps_forward": _raw(ks, "forwardEps"),
            "book_value": _raw(ks, "bookValue"),
            "revenue_per_share": _raw(fd, "revenuePerShare"),
        },
        "dividends": {
            "yield_pct": pct(_raw(sd, "dividendYield")),
            "rate": _raw(sd, "dividendRate"),
            "payout_ratio_pct": pct(_raw(sd, "payoutRatio")),
            "ex_date": (sd.get("exDividendDate") or {}).get("fmt")
                if isinstance(sd.get("exDividendDate"), dict) else None,
        },
        "profitability": {
            "profit_margin_pct": pct(_raw(fd, "profitMargins")),
            "operating_margin_pct": pct(_raw(fd, "operatingMargins")),
            "gross_margin_pct": pct(_raw(fd, "grossMargins")),
            "roe_pct": pct(_raw(fd, "returnOnEquity")),
            "roa_pct": pct(_raw(fd, "returnOnAssets")),
        },
        "growth": {
            "revenue_growth_pct": pct(_raw(fd, "revenueGrowth")),
            "earnings_growth_pct": pct(_raw(fd, "earningsGrowth")),
        },
        "balance": {
            "total_cash": _raw(fd, "totalCash"),
            "total_debt": _raw(fd, "totalDebt"),
            "debt_to_equity": _raw(fd, "debtToEquity"),
            "current_ratio": _raw(fd, "currentRatio"),
            "free_cash_flow": _raw(fd, "freeCashflow"),
        },
        "analyst": {
            "recommendation": _raw(fd, "recommendationKey"),
            "target_mean": _raw(fd, "targetMeanPrice"),
            "target_high": _raw(fd, "targetHighPrice"),
            "target_low": _raw(fd, "targetLowPrice"),
            "analysts": _raw(fd, "numberOfAnalystOpinions"),
        },
        "shares": {
            "float": _raw(ks, "floatShares"),
            "short_pct_of_float": pct(_raw(ks, "shortPercentOfFloat")),
            "insiders_pct": pct(_raw(ks, "heldPercentInsiders")),
            "institutions_pct": pct(_raw(ks, "heldPercentInstitutions")),
        },
        "calendar": {"next_earnings": earnings},
        "trading": {
            "avg_volume_3m": _raw(sd, "averageVolume"),
            "beta_yahoo": _raw(sd, "beta") or _raw(ks, "beta"),
            "fifty_two_week_high": _raw(sd, "fiftyTwoWeekHigh"),
            "fifty_two_week_low": _raw(sd, "fiftyTwoWeekLow"),
        },
    }


def _news_context(symbol: str) -> list[dict]:
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT title, published, sentiment_score, source_id FROM articles
           WHERE datetime(published) > datetime('now', '-14 days')
             AND sentiment_score IS NOT NULL
           ORDER BY published DESC LIMIT 400""",
    ).fetchall()
    conn.close()
    out = []
    for r in rows:
        if symbol in universe.extract_symbols(r["title"] or ""):
            out.append({"title": r["title"], "published": r["published"],
                        "sentiment": r["sentiment_score"], "source": r["source_id"]})
        if len(out) >= 6:
            break
    return out


def search(q: str, limit: int = 12) -> list[dict]:
    conn = db.get_conn()
    like = f"%{q}%"
    rows = conn.execute(
        """SELECT symbol, name, asset_class, region FROM securities
           WHERE symbol LIKE ? COLLATE NOCASE OR name LIKE ? COLLATE NOCASE
           ORDER BY rowid LIMIT ?""",
        (like, like, limit),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


async def dossier(symbol: str, days: int = 500) -> dict:
    closes_pairs = await simulation._daily_closes(symbol, days)
    if len(closes_pairs) < 40:
        return {"error": f"not enough price history for {symbol}"}
    dates = [d for d, _ in closes_pairs]
    closes = [c for _, c in closes_pairs]
    rets = _returns(closes)
    n = len(rets)

    mean_d = sum(rets) / n
    var_d = sum((r - mean_d) ** 2 for r in rets) / (n - 1)
    sd_d = math.sqrt(var_d)
    ann_ret = (closes[-1] / closes[0]) ** (TRADING_DAYS / n) - 1
    ann_vol = sd_d * math.sqrt(TRADING_DAYS)
    downside = [r for r in rets if r < 0]
    dsd = math.sqrt(sum(r * r for r in downside) / len(downside)) * math.sqrt(TRADING_DAYS) if downside else None
    max_dd, dd_days = _drawdown(closes)

    sorted_r = sorted(rets)
    def var_at(p: float) -> float:
        return sorted_r[max(0, int(n * (1 - p)) - 1)]
    def cvar_at(p: float) -> float:
        k = max(1, int(n * (1 - p)))
        return sum(sorted_r[:k]) / k

    jb_stat, jb_p = sstats.jarque_bera(rets)

    # Histogram vs fitted normal, for the distribution chart
    lo, hi = sorted_r[0], sorted_r[-1]
    bins = 21
    width = (hi - lo) / bins or 1e-9
    hist = [0] * bins
    for r in rets:
        hist[min(bins - 1, int((r - lo) / width))] += 1
    nd = NormalDist(mean_d, sd_d)
    normal_curve = [round(n * (nd.cdf(lo + (i + 1) * width) - nd.cdf(lo + i * width)), 2)
                    for i in range(bins)]

    # Rolling 30-day annualized vol
    roll_vol = []
    for i in range(30, n + 1):
        w = rets[i - 30:i]
        m = sum(w) / 30
        roll_vol.append({"date": dates[i], "vol": round(math.sqrt(sum((x - m) ** 2 for x in w) / 29 * TRADING_DAYS) * 100, 1)})

    # Benchmark relation
    beta = corr = None
    if symbol != BENCHMARK:
        try:
            bpairs = dict(await simulation._daily_closes(BENCHMARK, days))
            common = [d for d in dates if d in bpairs]
            if len(common) > 60:
                a = _returns([dict(closes_pairs)[d] for d in common])
                b = _returns([bpairs[d] for d in common])
                m = min(len(a), len(b))
                if m > 60:
                    slope, _, r_val, *_ = sstats.linregress(b[:m], a[:m])
                    beta, corr = round(float(slope), 2), round(float(r_val), 2)
        except Exception:
            pass

    sma50 = sum(closes[-50:]) / min(50, len(closes))
    sma200 = sum(closes[-200:]) / min(200, len(closes))
    hi52 = max(closes[-TRADING_DAYS:])
    lo52 = min(closes[-TRADING_DAYS:])

    # Engine join
    conn = db.get_conn()
    snaps = [dict(r) for r in conn.execute(
        """SELECT taken_at, composite FROM signal_snapshots
           WHERE entity = ? ORDER BY taken_at DESC LIMIT 96""", (symbol,)).fetchall()]
    conn.close()

    info = universe.lookup(symbol)
    worst_i = rets.index(sorted_r[0])
    best_i = rets.index(sorted_r[-1])

    return {
        "symbol": symbol,
        "name": (info or {}).get("name"),
        "asset_class": (info or {}).get("asset_class"),
        "observations": n,
        "span": {"from": dates[0], "to": dates[-1]},
        "price": {"last": closes[-1],
                  "vs_52w_high_pct": round((closes[-1] / hi52 - 1) * 100, 1),
                  "vs_52w_low_pct": round((closes[-1] / lo52 - 1) * 100, 1),
                  "trend": "uptrend" if closes[-1] > sma50 > sma200 else
                           "downtrend" if closes[-1] < sma50 < sma200 else "mixed"},
        "moments": {"ann_return_pct": round(ann_ret * 100, 2),
                    "ann_vol_pct": round(ann_vol * 100, 2),
                    "skewness": round(float(sstats.skew(rets)), 3),
                    "excess_kurtosis": round(float(sstats.kurtosis(rets)), 2)},
        "risk_adjusted": {"sharpe": round(mean_d / sd_d * math.sqrt(TRADING_DAYS), 2) if sd_d else None,
                          "sortino": round(ann_ret / dsd, 2) if dsd else None,
                          "max_drawdown_pct": round(max_dd * 100, 2),
                          "drawdown_days": dd_days,
                          "calmar": round(ann_ret / abs(max_dd), 2) if max_dd else None},
        "tails": {"var_95_pct": round(var_at(0.95) * 100, 2),
                  "var_99_pct": round(var_at(0.99) * 100, 2),
                  "cvar_95_pct": round(cvar_at(0.95) * 100, 2),
                  "cvar_99_pct": round(cvar_at(0.99) * 100, 2),
                  "worst_day": {"date": dates[worst_i + 1], "ret_pct": round(sorted_r[0] * 100, 2)},
                  "best_day": {"date": dates[best_i + 1], "ret_pct": round(sorted_r[-1] * 100, 2)}},
        "distribution": {"jarque_bera": round(float(jb_stat), 1),
                         "jb_p_value": float(f"{jb_p:.2e}"),
                         "normal": bool(jb_p > 0.05),
                         "hist": hist, "normal_curve": normal_curve,
                         "bin_edges_pct": [round((lo + i * width) * 100, 2) for i in range(bins + 1)]},
        "dependence": {"acf_returns": {f"lag{k}": _acf(rets, k) for k in (1, 2, 3, 5, 10)},
                       "acf_abs_returns": {f"lag{k}": _acf([abs(r) for r in rets], k) for k in (1, 5, 10)},
                       "hurst": _hurst(closes)},
        "relative": {"benchmark": BENCHMARK, "beta": beta, "correlation": corr},
        "rolling_vol_30d": roll_vol[-160:],
        "profile": await _profile(symbol),
        "options": await _options_read(symbol),
        "engine": {"snapshots": list(reversed(snaps)),
                   "latest_composite": snaps[0]["composite"] if snaps else None},
        "recent_headlines": _news_context(symbol),
    }
