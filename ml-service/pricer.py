"""
The pricer — what today's price buys in a company's future, as a range.

A company is priced the way a desk prices a contract: simulate the things
that decide its cash, many times, and read off the return the price earns
in each future. Two things decide the cash of a business:

- sales growth, which starts where the company is and fades toward the
  economy's (Chan, Karceski & Lakonishok, "The Level and Persistence of
  Growth Rates", Journal of Finance 58, 2003: growth barely persists);
- return on capital, which fades toward its industry's median, slower for
  a wider moat (Fama & French, "Forecasting Profitability and Earnings",
  Journal of Business 73, 2000; the industry median as the target follows
  Gebhardt, Lee & Swaminathan, below).

Both are first-order autoregressions on the gap to the cross-section, with
the persistence for each moat grade estimated from the scorecard panel
(calibrate()), not assumed. The year-to-year noise is half the grade's and
half the company's own, so a steady business is not handed the swings of
the average one.

Each year the business earns ROIC on last year's capital, and grows its
capital with its sales, so free cash flow = capital x (ROIC - growth)
(the value-driver identity; Koller, Goedhart & Wessels, "Valuation",
practitioner). After year 10 the business is valued on the cash it then
makes (terminal()).

The return is the company's implied cost of capital (Gebhardt, Lee &
Swaminathan, "Toward an Implied Cost of Capital", Journal of Accounting
Research 39, 2001): the one rate that sets today's enterprise value
(market value + debt - cash) equal to the discounted cash of a future,
terminal value included. It assumes no change in the market's multiples —
each future is valued at its own rate. It is the return to the whole
business: leverage, which lifts both an owner's return and risk, is left
out. The market's figure is the value-weighted average of its members', so
the index and its members are priced the same way; a company's alpha is
its implied return less the market's.

Banks and insurers are not priced: their capital is their raw material, and
free cash flow means nothing for them.
"""

import json
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

import pit
import scorecard

CALIBRATION = scorecard.DATA / "calibration.json"
YEARS = 10
PATHS = 5000
SEED = 11
LONG_RUN_GROWTH = 0.04      # nominal: ~2% real growth + ~2% inflation
INDUSTRY_MIN = 5            # members needed for an industry's own median ROIC
CLIP_ROIC = (-0.5, 1.0)     # one-off write-downs and tiny capital bases, held in
CLIP_GROWTH = (-0.5, 1.0)
GRADES = ("wide", "narrow", "none")
# Set by backcheck.tune() on the 2014 start, judged on 2016 (backcheck.py).
OWN_WEIGHT = 0.5            # how much of the fade target is the company's own past ROIC
NOISE_SCALE = {"roic": 2.0, "growth": 2.0}   # yearly noise, widened to what ten years showed
OWN_MIN_YEARS = 3


# ── Calibration: how fast advantages fade, measured ─────────────────────────

def panel(as_of: str) -> pd.DataFrame:
    """Every collected company's fiscal years known on `as_of`, with ROIC,
    sales growth and the moat grade the record gave at that year."""
    info = scorecard.companies()
    tickers = [t for t, c in info.items() if not scorecard.is_financial(c["sic"])]
    y = scorecard.annual(pit.connect(), as_of, tickers).sort_values(["ticker", "year_end"])
    y["roic"] = scorecard.roic(y).clip(*CLIP_ROIC)
    y["growth"] = y.groupby("ticker")["revenue"].pct_change(fill_method=None).clip(*CLIP_GROWTH)
    y.loc[y.groupby("ticker")["year_end"].diff().dt.days.gt(400), "growth"] = np.nan
    y["grade"] = [scorecard.moat_grade(r.roic.iloc[max(0, i - scorecard.YEARS + 1):i + 1])
                  for _, r in y.groupby("ticker") for i in range(len(r))]
    y["year"] = y["year_end"].dt.year
    return y


def ar1(x: pd.Series, nxt: pd.Series) -> tuple[float, float, int]:
    """Persistence and residual spread of nxt = rho * x + noise. The spread
    is 1.4826 x the median absolute residual — the standard deviation if the
    noise were normal, but not set by a few write-down years."""
    ok = x.notna() & nxt.notna()
    x, nxt = x[ok].to_numpy(), nxt[ok].to_numpy()
    rho = float((x * nxt).sum() / (x * x).sum())
    resid = nxt - rho * x
    return rho, float(1.4826 * np.median(np.abs(resid - np.median(resid)))), int(ok.sum())


def calibrate(as_of: str, save: bool = True) -> dict:
    """Fit the fades by moat grade on the panel known on `as_of`; save it
    as the calibration today's pricing uses unless `save` is off."""
    y = panel(as_of)
    for col in ("roic", "growth"):
        y[f"{col}_gap"] = y[col] - y.groupby("year")[col].transform("median")
        y[f"{col}_next"] = y.groupby("ticker")[f"{col}_gap"].shift(-1)
    out = {"as_of": as_of, "companies": int(y["ticker"].nunique()),
           "roic_median": float(y[y["year"] == y["year"].max() - 1]["roic"].median()),
           "grades": {}}
    for g in GRADES:
        s = y[y["grade"] == g]
        rr, rs, rn = ar1(s["roic_gap"], s["roic_next"])
        gr, gs, gn = ar1(s["growth_gap"], s["growth_next"])
        out["grades"][g] = {"roic_persistence": rr, "roic_noise": rs, "roic_pairs": rn,
                            "growth_persistence": gr, "growth_noise": gs, "growth_pairs": gn}
    if save:
        CALIBRATION.parent.mkdir(parents=True, exist_ok=True)
        CALIBRATION.write_text(json.dumps(out, indent=1))
    return out


def calibration() -> dict:
    return json.loads(CALIBRATION.read_text())


# ── Simulation ──────────────────────────────────────────────────────────────

def terminal(nopat: np.ndarray, roic: np.ndarray, rate: np.ndarray) -> np.ndarray:
    """Value at year 10 of the cash from year 11 on (the value-driver
    formula). New capital earning more than the market's rate adds value as
    it grows; earning less, the business stops growing and is worth its
    profit at that rate; a business losing money is worth nothing."""
    g = LONG_RUN_GROWTH
    grows = nopat * (1 - g / np.maximum(roic, 1e-9)) / (rate - g)
    return np.where(nopat <= 0, 0.0, np.where(roic > rate, grows, nopat / rate))


def trajectories(roic0: float, growth0: float, fade: dict, roic_mean: float, rng,
                 paths: int = PATHS) -> tuple[np.ndarray, np.ndarray]:
    """Simulated futures of the two drivers: ROIC for years 1..YEARS+1 and
    sales growth for years 1..YEARS, one row per future."""
    rr, rs = fade["roic_persistence"], fade["roic_noise"]
    gr, gs = fade["growth_persistence"], fade["growth_noise"]
    r_gap = np.full(paths, np.clip(roic0, *CLIP_ROIC) - roic_mean)
    g_gap = np.full(paths, np.clip(growth0, *CLIP_GROWTH) - LONG_RUN_GROWTH)
    roic, growth = np.empty((paths, YEARS + 1)), np.empty((paths, YEARS))
    for t in range(YEARS + 1):
        r_gap = rr * r_gap + rs * rng.standard_normal(paths)
        g_gap = gr * g_gap + gs * rng.standard_normal(paths)    # drawn in year 11 too, unused
        roic[:, t] = np.clip(roic_mean + r_gap, *CLIP_ROIC)
        if t < YEARS:
            growth[:, t] = np.clip(LONG_RUN_GROWTH + g_gap, *CLIP_GROWTH)
    return roic, growth


def futures(capital: float, roic0: float, growth0: float, fade: dict,
            roic_mean: float, rng, paths: int = PATHS) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Simulated futures: each one's yearly cash, and the NOPAT and ROIC of
    year 11 that set its terminal value."""
    roic, growth = trajectories(roic0, growth0, fade, roic_mean, rng, paths)
    ic = np.full(paths, capital)
    cash = np.empty((paths, YEARS))
    for t in range(YEARS):
        cash[:, t] = ic * (roic[:, t] - growth[:, t])    # NOPAT less the capital growth needs
        ic = ic * (1 + growth[:, t])
    return cash, ic * roic[:, YEARS], roic[:, YEARS]


def simulate(capital: float, roic0: float, growth0: float, ev: float, fade: dict,
             roic_mean: float, rng, paths: int = PATHS) -> np.ndarray:
    """The implied return today's enterprise value earns, one per future."""
    return implied_return(*futures(capital, roic0, growth0, fade, roic_mean, rng, paths), ev)


def worth(cash: np.ndarray, nopat_after: np.ndarray, roic_after: np.ndarray,
          rate: np.ndarray | float) -> np.ndarray:
    """Each future's value today at `rate`, terminal value included."""
    rate = np.broadcast_to(np.asarray(rate, dtype=float), cash.shape[:1])
    t = np.arange(1, cash.shape[1] + 1)
    floor = np.maximum(rate, LONG_RUN_GROWTH + 0.01)    # the terminal needs rate > growth
    return (cash / (1 + rate[:, None]) ** t).sum(axis=1) + \
        terminal(nopat_after, roic_after, floor) / (1 + rate) ** cash.shape[1]


def per_share(cash: np.ndarray, nopat_after: np.ndarray, roic_after: np.ndarray,
              rate: float, net_debt: float, shares: float) -> np.ndarray:
    """What one share is worth in each future at `rate`: the business's
    value less net debt, over the shares. Owners can lose no more than the
    business, so a share is worth at least nothing — equity as a call on
    the business, struck at its debt (Merton, "On the Pricing of Corporate
    Debt", Journal of Finance 29, 1974)."""
    return np.maximum(worth(cash, nopat_after, roic_after, rate) - net_debt, 0.0) / shares


def implied_return(cash: np.ndarray, nopat_after: np.ndarray, roic_after: np.ndarray,
                   price: float, lo: float = -0.6, hi: float = 1.0) -> np.ndarray:
    """Per row, the rate at which the yearly cash plus the terminal value
    (valued at that same rate) is worth `price`, by bisection. Worth falls
    as the rate rises; a future worth less than `price` even at `lo` reads
    as `lo`."""
    lo_v = np.full(cash.shape[0], lo)
    hi_v = np.full(cash.shape[0], hi)
    for _ in range(60):
        mid = (lo_v + hi_v) / 2
        value = worth(cash, nopat_after, roic_after, mid)
        above = value > price            # still worth more: the rate can go higher
        lo_v = np.where(above, mid, lo_v)
        hi_v = np.where(above, hi_v, mid)
    return (lo_v + hi_v) / 2


# ── Market value on the day ─────────────────────────────────────────────────

def _store(conn, table: str) -> None:
    conn.execute(f"CREATE OR REPLACE VIEW {table} AS SELECT * FROM read_parquet("
                 f"'{pit.PIT_ROOT / table}/snapshot=*/*.parquet', union_by_name=true)")


def checked_shares(reported: float, same_period: pd.DataFrame) -> float:
    """Filers sometimes tag a share count at the wrong scale (712.3 for 712.3
    million). Net income over diluted EPS from the same period is a second
    reading; when the two disagree by more than a quarter, trust that one."""
    v = same_period.set_index("tag")["value"]
    ni, eps = v.get("NetIncomeLoss"), v.get("EarningsPerShareDiluted")
    if ni is None or eps is None or abs(eps) < 0.05:
        return float(reported)
    implied = ni / eps
    return float(reported) if 0.8 <= implied / reported <= 1.25 else float(implied)


def market_values(as_of: str, tickers: list[str]) -> dict[str, dict]:
    """ticker -> {price, date, shares, market_value} on the last trading day
    on or before `as_of` (within ten days). Prices are stored adjusted for
    every split since, so the share count is carried into those units by
    the splits after the filing that reported it."""
    conn = duckdb.connect()
    for table in ("prices_eod", "fundamentals", "corporate_actions"):
        _store(conn, table)
    marks = ",".join("?" * len(tickers))
    px = conn.execute(f"""
        SELECT symbol, date, close FROM (
          SELECT symbol, date, close, ROW_NUMBER() OVER (
            PARTITION BY symbol ORDER BY date DESC, ingested_at DESC) rn
          FROM prices_eod WHERE symbol IN ({marks})
            AND date <= CAST(? AS DATE) AND date > CAST(? AS DATE) - INTERVAL 10 DAY
        ) WHERE rn = 1""", [*tickers, as_of, as_of]).df()
    # The latest period's share count, with the net income and diluted EPS
    # the same filing gave for it.
    tags = [*scorecard.TAGS["shares"], "NetIncomeLoss", "EarningsPerShareDiluted"]
    rows = conn.execute(f"""
        SELECT symbol, tag, period_start, period_end, value, filed_at FROM (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY symbol, tag, period_start, period_end ORDER BY filed_at, value) rn
          FROM fundamentals WHERE symbol IN ({marks})
            AND tag IN ({','.join('?' * len(tags))})
            AND filed_at <= CAST(? AS TIMESTAMP)
            AND date_diff('day', period_start, period_end) BETWEEN 80 AND 380
        ) WHERE rn = 1""", [*tickers, *tags, as_of]).df()
    sh = {}
    for sym, r in rows.groupby("symbol"):
        counts = r[r["tag"].isin(scorecard.TAGS["shares"])]
        if counts.empty:
            continue
        # Ties (two tags, or a quarter and a year ending the same day, filed
        # together) came back in whatever order the database chose, so a
        # share count could flip between runs: break them by the tag's
        # preference, then the shorter, latest period.
        pref = counts["tag"].map(lambda t: -scorecard.TAGS["shares"].index(t))
        latest = counts.assign(pref=pref).sort_values(["period_end", "filed_at", "pref", "period_start"]).iloc[-1]
        same = r[(r["period_start"] == latest["period_start"]) & (r["period_end"] == latest["period_end"])]
        sh[sym] = {"value": checked_shares(latest["value"], same), "filed_at": latest["filed_at"]}
    splits = conn.execute(f"""
        SELECT DISTINCT symbol, date, value FROM corporate_actions
        WHERE kind = 'split' AND symbol IN ({marks})""", tickers).df()
    out = {}
    for _, p in px.iterrows():
        if p["symbol"] not in sh:
            continue
        s = sh[p["symbol"]]
        later = splits[(splits["symbol"] == p["symbol"]) & (splits["date"] > s["filed_at"])]
        units = float(np.prod(later["value"])) if len(later) else 1.0
        n = float(s["value"]) * units
        out[p["symbol"]] = {"price": float(p["close"]), "date": p["date"].date().isoformat(),
                            "shares": n, "market_value": float(p["close"]) * n}
    return out


# ── Pricing the S&P 500 ─────────────────────────────────────────────────────

def _state(y: pd.DataFrame) -> dict | None:
    """The latest fiscal year's capital, ROIC and sales growth."""
    y = y.sort_values("year_end")
    last = y.iloc[-1]
    capital = scorecard.invested_capital(y).iloc[-1]
    roic = scorecard.roic(y).iloc[-1]
    if len(y) < 2 or not capital > 0 or pd.isna(roic) or pd.isna(last["revenue"]):
        return None
    # Growth now: the median of the last three yearly rates, so one odd year
    # (an acquisition, a one-off) does not set the path.
    rev = y.set_index("year_end")["revenue"].tail(4)
    gaps = pd.Series(rev.index, index=rev.index).diff().dt.days
    rates = (rev / rev.shift(1) - 1)[gaps.between(300, 430) & (rev.shift(1) > 0)]
    if rates.empty:
        return None
    growth = float(rates.median())
    debt = scorecard.debt(y).iloc[-1]
    return {"capital": float(capital), "roic": float(roic), "growth": growth,
            "revenue": float(last["revenue"]),
            "net_debt": float(debt - (0 if pd.isna(last["cash"]) else last["cash"])),
            "fiscal_year_end": last["year_end"].date().isoformat()}


def own_noise(card: dict, grade: dict) -> float:
    """A company's own year-to-year ROIC noise: the robust spread of its
    yearly changes over sqrt(2). Under five changes on record, the grade's."""
    r = [v for v in card["return_by_year"] if v is not None]
    if len(r) < 6:
        return grade["roic_noise"]
    d = np.diff(np.clip(r, *CLIP_ROIC))
    return float(1.4826 * np.median(np.abs(d - np.median(d))) / np.sqrt(2))


def own_level(card: dict) -> float | None:
    """The company's own ROIC level: the median of its years on record."""
    r = [v for v in card["return_by_year"] if v is not None]
    return float(np.median(np.clip(r, *CLIP_ROIC))) if len(r) >= OWN_MIN_YEARS else None


def fade_for(card: dict, grade: dict, scale: dict | None = None) -> dict:
    """The grade's fades with the company's own ROIC noise blended in,
    both noises widened by `scale`."""
    scale = scale or NOISE_SCALE
    return {**grade, "roic_noise": scale["roic"] * (grade["roic_noise"] + own_noise(card, grade)) / 2,
            "growth_noise": scale["growth"] * grade["growth_noise"]}


def target_for(card: dict, industry: float, weight: float | None = None) -> float:
    """Where ROIC fades to: the industry's median, blended with the
    company's own level by `weight`."""
    weight = OWN_WEIGHT if weight is None else weight
    own = own_level(card)
    return industry if own is None else weight * own + (1 - weight) * industry


def industry_targets(members: dict[str, dict], cards: dict[str, dict]) -> dict[str, float]:
    """Each member's fade target: the median ROIC of members in its two-digit
    SIC industry, or of all members where the industry has too few."""
    every = float(np.median([m["roic"] for m in members.values()]))
    groups: dict[str, list[float]] = {}
    for t, m in members.items():
        groups.setdefault(cards[t]["sic"][:2], []).append(m["roic"])
    return {t: float(np.median(groups[cards[t]["sic"][:2]]))
            if len(groups[cards[t]["sic"][:2]]) >= INDUSTRY_MIN else every
            for t in members}


def price(as_of: str, cal: dict | None = None) -> dict:
    """Every non-financial S&P 500 member priced on the day; the market is
    their value-weighted average. `cal` defaults to the saved calibration;
    a replay of the past passes the one fitted on what was known then."""
    cal = cal or calibration()
    cards = {c["ticker"]: c for c in scorecard.cards(as_of)}
    tickers = [t for t, c in cards.items() if not c["financial"]]
    years = scorecard.annual(pit.connect(), as_of, tickers)
    states = {t: s for t, y in years.groupby("ticker") if (s := _state(y))}
    mv = market_values(as_of, list(states))
    cutoff = (pd.Timestamp(as_of) - pd.Timedelta(days=548)).date().isoformat()
    members = {}
    for t, s in states.items():
        if t in mv and s["fiscal_year_end"] >= cutoff:
            ev = mv[t]["market_value"] + s["net_debt"]
            if ev > 0:
                members[t] = {**s, "ev": ev}
    target = industry_targets(members, cards)

    priced, draws = [], {}
    for t, m in members.items():
        grade = cal["grades"][cards[t]["moat"] or "none"]
        fade = fade_for(cards[t], grade)
        r = simulate(m["capital"], m["roic"], m["growth"], m["ev"], fade,
                     target_for(cards[t], target[t]), np.random.default_rng(SEED))
        draws[t] = r
        priced.append({"ticker": t, "name": cards[t]["name"], "moat": cards[t]["moat"],
                       "industry": cards[t]["industry"],
                       "price": mv[t]["price"], "price_date": mv[t]["date"],
                       "market_value": mv[t]["market_value"], "enterprise_value": m["ev"],
                       "roic": m["roic"], "roic_target": target_for(cards[t], target[t]), "growth": m["growth"],
                       "fiscal_year_end": m["fiscal_year_end"],
                       "percentiles": {str(p): float(np.percentile(r, p)) for p in (5, 25, 50, 75, 95)},
                       "p_loss": float((r < 0).mean())})
    market = float(np.average([p["percentiles"]["50"] for p in priced],
                              weights=[p["enterprise_value"] for p in priced]))
    for p in priced:
        p["alpha"] = p["percentiles"]["50"] - market
        p["p_beat_market"] = float((draws[p["ticker"]] > market).mean())
        # The same futures again (same seed), each valued at the market's rate.
        t, m = p["ticker"], members[p["ticker"]]
        grade = cal["grades"][cards[t]["moat"] or "none"]
        fade = fade_for(cards[t], grade)
        v = per_share(*futures(m["capital"], m["roic"], m["growth"], fade, target_for(cards[t], target[t]),
                               np.random.default_rng(SEED)), market, m["net_debt"], mv[t]["shares"])
        p["value_per_share"] = {str(q): float(np.percentile(v, q)) for q in (5, 25, 50, 75, 95)}
        # The ten-year ranges the back-check judged (backcheck.py): sales as
        # a multiple of the last fiscal year's, and ROIC in year 10.
        roic, growth = trajectories(m["roic"], m["growth"], fade, target_for(cards[t], target[t]),
                                    np.random.default_rng(SEED))
        sales = np.prod(1 + growth, axis=1)
        p["sales_10y"] = {str(q): float(np.percentile(sales, q)) for q in (5, 50, 95)}
        p["roic_10y"] = {str(q): float(np.percentile(roic[:, YEARS - 1], q)) for q in (5, 50, 95)}
        p["p_worth_more"] = float((v > p["price"]).mean())
    return {"as_of": as_of, "market_return": market, "priced": len(priced),
            "long_run_growth": LONG_RUN_GROWTH, "calibration": cal,
            "companies": sorted(priced, key=lambda p: -p["alpha"])}
