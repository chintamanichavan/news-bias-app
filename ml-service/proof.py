"""
The proof — would the pricer have picked winners, using only what it could
have known?

Each 30 June from FIRST_YEAR, the fades are re-measured on the filings known
that day (pricer.calibrate) and every S&P 500 member of the day is priced
(pricer.price). Portfolios formed from the prices are then held for twelve
months, equal-weighted and rebalanced monthly, dividends included:

- moat_top: the TOP wide-moat companies with the highest implied return —
  the strategy itself;
- moat_all: every wide-moat company — does the moat alone pay?
- top_fifth / bottom_fifth: the best and worst fifth of all priced
  companies by implied return — does the price sort winners from losers?
- universe: every priced company — the control.

The pricer forecasts a ten-year return, so the long-horizon test is the one
that matters (long_horizon): for every company priced on a date, did the
implied return come true over the next HORIZONS years? Judged as the
research judges implied costs of capital — the slope of realised on implied
return, 1 if the forecast is right on average, 0 if it carries nothing
(Easton & Monahan, "An Evaluation of Accounting-Based Measures of Expected
Returns", The Accounting Review 80, 2005; Lee, So & Wang, "Evaluating
Firm-Level Expected-Return Proxies", Review of Financial Studies 34, 2021).
Windows that start a year apart overlap, so the dates are not independent
tests; the per-date figures are shown for that reason.

Two variants of the strategy were added after the first replay showed its
picks were shrinking franchises bought cheap (IBM, Western Union, Biogen):
value traps. Both are the literature's standard guards, fixed before they
were run, and each counts as a further trial:

- moat_top_momentum: only wide-moat companies whose price rose over the
  twelve months before the date, skipping the last (Jegadeesh & Titman,
  "Returns to Buying Winners and Selling Losers", Journal of Finance 48,
  1993; Asness, Moskowitz & Pedersen, "Value and Momentum Everywhere",
  Journal of Finance 68, 2013);
- moat_top_growing: only wide-moat companies whose sales are growing (the
  pricer's growth state above zero; in the spirit of Piotroski, "Value
  Investing: The Use of Historical Financial Statement Information",
  Journal of Accounting Research 38, 2000).

Two yardsticks. SPY is the market an index fund buys. The universe is the
fairer one: it holds only companies that still trade today, so it carries
the same survivor bias as every portfolio drawn from it (Shumway, "The
Delisting Bias in CRSP Data", Journal of Finance 52, 1997). How far the
universe beats SPY is an estimate of that bias.

The rank correlation of implied return with the next year's return is the
information coefficient (Grinold & Kahn, "Active Portfolio Management",
practitioner). Every portfolio tried counts as a trial against the
deflated Sharpe ratio (validation.deflated_sharpe).
"""

import json
import time

import duckdb
import numpy as np
import pandas as pd
from scipy import stats as sstats

import monitor
import pit
import pricer
import scorecard
import validation

FIRST_YEAR = 2014   # five fiscal years on record first exist here (XBRL from 2009)
REBALANCE = "06-30"
TOP = 20
RESULT = scorecard.DATA / "proof.json"
REPLAY = scorecard.DATA / "replay"         # each date's pricing, kept for reuse
HORIZONS = (3, 5)                          # years
PORTFOLIOS = ("moat_top", "moat_all", "top_fifth", "bottom_fifth",
              "moat_top_momentum", "moat_top_growing", "universe")


def rebalance_dates(last_price: str) -> list[str]:
    """Every 30 June whose twelve months of holding have fully happened."""
    last = pd.Timestamp(last_price)
    return [f"{y}-{REBALANCE}" for y in range(FIRST_YEAR, last.year + 1)
            if pd.Timestamp(f"{y + 1}-{REBALANCE}") <= last]


def monthly_returns(tickers: list[str]) -> pd.DataFrame:
    """Month x ticker total returns: month-end close plus the month's
    dividends over last month-end's close. Prices and dividends are both
    in today's share units."""
    conn = duckdb.connect()
    for table in ("prices_eod", "corporate_actions"):
        pricer._store(conn, table)
    marks = ",".join("?" * len(tickers))
    # One close per day, from the latest download: the source re-adjusts a
    # whole history after a split or spin-off, and mixing two downloads mixes
    # two sets of units (Corteva's 2026 history differs by a factor of ~6.7).
    closes = conn.execute(f"""
        SELECT symbol, date_trunc('month', date) AS month, arg_max(close, date) AS close FROM (
          SELECT symbol, date, close, ROW_NUMBER() OVER (
            PARTITION BY symbol, date ORDER BY ingested_at DESC) AS rn
          FROM prices_eod WHERE symbol IN ({marks}))
        WHERE rn = 1
        GROUP BY 1, 2""", tickers).df()
    divs = conn.execute(f"""
        SELECT symbol, date_trunc('month', date) AS month, sum(value) AS dividend FROM (
          SELECT symbol, date, value, ROW_NUMBER() OVER (
            PARTITION BY symbol, date ORDER BY ingested_at DESC) AS rn
          FROM corporate_actions WHERE kind = 'dividend' AND symbol IN ({marks}))
        WHERE rn = 1
        GROUP BY 1, 2""", tickers).df()
    close = closes.pivot(index="month", columns="symbol", values="close").sort_index()
    div = divs.pivot(index="month", columns="symbol", values="dividend").reindex_like(close).fillna(0)
    return (close + div) / close.shift(1) - 1


def momentum(rets: pd.DataFrame, day: str) -> dict[str, float]:
    """Each name's return over the twelve months before `day`, skipping the
    last month (eleven monthly returns); names with fewer than ten left out."""
    end = pd.Timestamp(day) - pd.DateOffset(months=1)
    window = rets.loc[(rets.index > end - pd.DateOffset(months=11)) & (rets.index <= end)]
    return {t: float(np.prod(1 + window[t].dropna()) - 1)
            for t in window.columns if window[t].notna().sum() >= 10}


def holdings(priced: dict, mom: dict[str, float] | None = None) -> dict[str, list[str]]:
    """The portfolios formed from one day's prices."""
    cs = priced["companies"]                   # sorted by alpha, best first
    wide = [c for c in cs if c["moat"] == "wide"]
    mom = mom or {}
    fifth = max(1, len(cs) // 5)
    return {"moat_top": [c["ticker"] for c in wide[:TOP]],
            "moat_all": [c["ticker"] for c in wide],
            "moat_top_momentum": [c["ticker"] for c in wide if mom.get(c["ticker"], -1) > 0][:TOP],
            "moat_top_growing": [c["ticker"] for c in wide if c["growth"] > 0][:TOP],
            "top_fifth": [c["ticker"] for c in cs[:fifth]],
            "bottom_fifth": [c["ticker"] for c in cs[-fifth:]],
            "universe": [c["ticker"] for c in cs]}


def hold(rets: pd.DataFrame, names: list[str], start: str) -> pd.Series:
    """Twelve monthly returns of an equal-weighted portfolio formed on
    `start`; a name with no return in a month sits that month out."""
    months = rets.loc[(rets.index > pd.Timestamp(start)) &
                      (rets.index <= pd.Timestamp(start) + pd.DateOffset(months=12))]
    cols = [n for n in names if n in months.columns]
    return months[cols].mean(axis=1, skipna=True) if cols else pd.Series(np.nan, index=months.index)


def ic(alpha: dict[str, float], forward: dict[str, float]) -> float | None:
    both = [t for t in alpha if t in forward and np.isfinite(forward[t])]
    if len(both) < 30:
        return None
    return float(sstats.spearmanr([alpha[t] for t in both], [forward[t] for t in both])[0])


def realised(rets: pd.DataFrame, day: str, years: int) -> dict[str, float]:
    """Each name's yearly total return over `years` from `day`; a name
    missing more than a tenth of the months is left out."""
    months = rets.loc[(rets.index > pd.Timestamp(day)) &
                      (rets.index <= pd.Timestamp(day) + pd.DateOffset(years=years))]
    need = int(0.9 * 12 * years)
    return {t: float(np.prod(1 + months[t].dropna()) ** (1 / years) - 1)
            for t in months.columns if months[t].notna().sum() >= need}


def long_horizon(years_: list[dict], rets: pd.DataFrame, last_month: pd.Timestamp) -> dict:
    """For each horizon, how the implied return on a date compared with the
    yearly return each company went on to deliver."""
    out = {}
    for h in HORIZONS:
        dates, pooled = [], []
        for y in years_:
            if pd.Timestamp(y["date"]) + pd.DateOffset(years=h) > last_month:
                continue
            real = realised(rets, y["date"], h)
            spy = realised(rets, y["date"], h).get("SPY")
            rows = [(c["percentiles"]["50"], real[c["ticker"]], c["moat"], c["ticker"])
                    for c in y["priced"]["companies"] if c["ticker"] in real]
            if len(rows) < 30:
                continue
            implied, actual = np.array([r[0] for r in rows]), np.array([r[1] for r in rows])
            slope, intercept = np.polyfit(implied, actual, 1)
            top = set(y["held"]["moat_top"])
            dates.append({"date": y["date"], "companies": len(rows), "spy": spy,
                          "rank_corr": float(sstats.spearmanr(implied, actual)[0]),
                          "slope": float(slope), "intercept": float(intercept),
                          "implied_mean": float(implied.mean()), "realised_mean": float(actual.mean()),
                          "moat_top": float(np.mean([r[1] for r in rows if r[3] in top]))
                          if any(r[3] in top for r in rows) else None})
            pooled += [(y["date"], *r) for r in rows]
        if not dates:
            continue
        df = pd.DataFrame(pooled, columns=["date", "implied", "realised", "moat", "ticker"])
        # Fifths of implied return within each date, then averaged over dates.
        df["fifth"] = df.groupby("date")["implied"].transform(
            lambda x: pd.qcut(x.rank(method="first"), 5, labels=False))
        by_fifth = df.groupby(["date", "fifth"])[["implied", "realised"]].mean().groupby("fifth").mean()
        corrs = [d["rank_corr"] for d in dates]
        slope, intercept = np.polyfit(df["implied"], df["realised"], 1)
        out[str(h)] = {
            "dates": dates,
            "rank_corr_mean": float(np.mean(corrs)),
            "rank_corr_positive": int(sum(c > 0 for c in corrs)),
            "slope": float(slope), "intercept": float(intercept),
            "fifths": [{"fifth": int(f) + 1, "implied": float(r.implied), "realised": float(r.realised)}
                       for f, r in by_fifth.iterrows()],
            "wide_vs_rest": {
                "wide": float(df[df["moat"] == "wide"]["realised"].mean()),
                "rest": float(df[df["moat"] != "wide"]["realised"].mean())},
        }
    return out


def summarise(excess: pd.Series, periods_a_year: int, trials: int) -> dict:
    """Mean a year, t-statistic and deflated Sharpe of an excess-return series."""
    x = excess.dropna()
    if len(x) < 2:
        return {"n": len(x)}
    t = float(x.mean() / (x.std(ddof=1) / np.sqrt(len(x)))) if x.std(ddof=1) > 0 else None
    out = {"n": len(x), "mean_a_year": float(x.mean() * periods_a_year), "t": t,
           "hit_rate": float((x > 0).mean())}
    if periods_a_year == 12:
        # The trials' Sharpe spread under no skill: the estimator's variance.
        d = validation.deflated_sharpe(list(x), n_trials=trials, var_sharpe=1 / (len(x) - 1))
        out["sharpe_a_year"] = float(x.mean() / x.std(ddof=1) * np.sqrt(12)) if x.std(ddof=1) > 0 else None
        out["deflated_sharpe"] = d.get("dsr")
    return out


def run(last_price: str | None = None, reuse: bool = True) -> dict:
    """Replay every year, measure, save the result, record the trials.
    Each date's pricing is saved and reused unless `reuse` is off."""
    started = time.time()
    conn = duckdb.connect()
    pricer._store(conn, "prices_eod")
    last_price = last_price or str(conn.execute(
        "SELECT max(date) FROM prices_eod WHERE symbol = 'SPY'").fetchone()[0])[:10]
    dates = rebalance_dates(last_price)

    years = []
    for day in dates:
        saved = REPLAY / f"{day}.json"
        if reuse and saved.exists():
            y = json.loads(saved.read_text())
        else:
            cal = pricer.calibrate(day, save=False)
            priced = pricer.price(day, cal=cal)
            members = scorecard.members(day)
            cards = {c["ticker"]: c for c in scorecard.cards(day)}
            non_financial = [t for t in members if not (t in cards and cards[t]["financial"])]
            y = {"date": day, "priced": priced, "members": len(members),
                 "non_financial": len(non_financial)}
            REPLAY.mkdir(parents=True, exist_ok=True)
            saved.write_text(json.dumps(y, default=float))
        years.append(y)
        print(f"[proof] {day}: priced {y['priced']['priced']} of {y['non_financial']} "
              "non-financial members", flush=True)

    every = sorted({c["ticker"] for y in years for c in y["priced"]["companies"]} | {"SPY"})
    rets = monthly_returns(every)
    for y in years:
        y["held"] = holdings(y["priced"], momentum(rets, y["date"]))

    monthly = {p: [] for p in PORTFOLIOS}
    spy, rows = [], []
    for y in years:
        spy_m = hold(rets, ["SPY"], y["date"])
        spy.append(spy_m)
        row = {"date": y["date"], "members": y["members"], "non_financial": y["non_financial"],
               "priced": y["priced"]["priced"], "market_implied": y["priced"]["market_return"],
               "wide": len(y["held"]["moat_all"]), "spy": float(np.prod(1 + spy_m) - 1)}
        for p in PORTFOLIOS:
            m = hold(rets, y["held"][p], y["date"])
            monthly[p].append(m)
            row[p] = float(np.prod(1 + m.fillna(0)) - 1)
        months = rets.loc[(rets.index > pd.Timestamp(y["date"])) &
                          (rets.index <= pd.Timestamp(y["date"]) + pd.DateOffset(months=12))]
        forward = {t: float(np.prod(1 + months[t].dropna()) - 1)
                   for t in y["held"]["universe"] if t in months and months[t].notna().sum() >= 11}
        row["ic"] = ic({c["ticker"]: c["alpha"] for c in y["priced"]["companies"]}, forward)
        row["moat_top_names"] = y["held"]["moat_top"]
        rows.append(row)

    spy_all = pd.concat(spy)
    series = {p: pd.concat(monthly[p]) for p in PORTFOLIOS}
    trials = len(PORTFOLIOS) - 1          # every portfolio but the control
    yearly = pd.DataFrame(rows).set_index("date")
    results = {}
    for p in PORTFOLIOS:
        results[p] = {
            "vs_spy_monthly": summarise(series[p] - spy_all, 12, trials),
            "vs_universe_monthly": summarise(series[p] - series["universe"], 12, trials)
            if p != "universe" else None,
            "vs_spy_yearly": summarise(yearly[p] - yearly["spy"], 1, trials),
            "growth_a_year": float(np.prod(1 + series[p].fillna(0)) ** (12 / len(series[p])) - 1),
        }
    for p in PORTFOLIOS:
        ex = yearly[p] - yearly["universe"]
        results[p]["vs_universe_by_year"] = {
            "years_ahead": int((ex > 0).sum()), "years": int(ex.notna().sum()),
            "median": float(ex.median()),
            # the year from June 2020 held the post-crash rebound; one year
            # should not carry a result
            "mean_without_best_year": float(ex.drop(ex.idxmax()).mean())}
    spread = series["top_fifth"] - series["bottom_fifth"]
    ics = [r["ic"] for r in rows if r["ic"] is not None]
    out = {
        "run_at": time.strftime("%Y-%m-%d %H:%M"), "seconds": round(time.time() - started),
        "long_horizon": long_horizon(years, rets, rets.index.max()),
        "dates": dates, "top": TOP, "trials": trials,
        "hurdle_t": validation.significance_hurdle(trials),
        "spy_growth_a_year": float(np.prod(1 + spy_all) ** (12 / len(spy_all)) - 1),
        "portfolios": results,
        "spread_top_minus_bottom": summarise(spread, 12, trials),
        "ic": {"mean": float(np.mean(ics)) if ics else None,
               "t": float(np.mean(ics) / (np.std(ics, ddof=1) / np.sqrt(len(ics))))
               if len(ics) > 1 and np.std(ics, ddof=1) > 0 else None,
               "years": len(ics)},
        "survivor_bias_estimate": results["universe"]["vs_spy_monthly"].get("mean_a_year"),
        "years": rows,
        "caveat": validation.SURVIVORSHIP_CAVEAT,
    }
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(out, indent=1, default=float))
    monitor.log_experiment("proof:moat_pricer", {"dates": dates, "top": TOP, "portfolios": list(PORTFOLIOS)},
                           {"moat_top_vs_universe": results["moat_top"]["vs_universe_monthly"],
                            "ic": out["ic"]})
    return out


def result() -> dict | None:
    return json.loads(RESULT.read_text()) if RESULT.exists() else None


if __name__ == "__main__":
    print(json.dumps({k: v for k, v in run().items() if k != "years"}, indent=1, default=float))
