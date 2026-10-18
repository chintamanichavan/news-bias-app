"""
The winners — which companies went on to earn 40% a year, what they looked
like beforehand, and whether that look picks them in years not yet seen.

On each 30 June every collected non-financial company worth at least
MIN_VALUE gets its traits from its filings as first filed, its size and its
past year's return. A winner is a company whose total return over the next
H years averaged GOAL a year or more.

The model is a logistic regression of winning on the traits' ranks within
the day (rank - 1/2; a missing trait sits at 0), with a light ridge penalty
(Gu, Kelly & Xiu, "Empirical Asset Pricing via Machine Learning", Review of
Financial Studies 33, 2020, for ranks). The forecast on a date uses only
start dates whose TRAIN_H years had ended by then, so no outcome it is judged
on was known when it was fitted (purging: López de Prado, "Advances in
Financial Machine Learning", 2018).

It is judged by the hit rate of its TOP picks against the base rate, by the
picks' realised returns against every company in the universe and SPY, and
by AUC (the chance a winner is ranked above a non-winner).

The bias to keep in view: the collected companies are those that file
today, so every company that died is missing. Small, unprofitable,
share-issuing and beaten-down companies die most often, so survivors flatter
exactly those traits (Shumway, "The Delisting Bias in CRSP Data", Journal of
Finance 52, 1997). survivor_gap() measures how much the universe itself beats
the survivor-free market of Ken French's library over the same months.
"""

import json
import time

import numpy as np
import pandas as pd

import filers
import monitor
import odds
import pricer
import proof
import scorecard
import validation

FIRST, LAST = 2010, 2021        # start years with prices and filings
LAST_ALL = 2022                 # the filers' value points reach mid-2025
GOAL = 0.40                     # a year
HORIZONS = (3, 5)
TRAIN_H = 3                     # the label the model learns from
MIN_VALUE = 50e6
TOP = (10, 50)
RIDGE = 1.0
TRAITS = ("log_size", "momentum", "sales_growth_5y", "return_median", "return_latest",
          "gross_margin", "gross_margin_swing", "reinvestment", "altman_z",
          "share_change_yearly", "debt_to_operating_income", "moat_years")
PANEL = scorecard.DATA / "winners_panel.parquet"
PANEL_ALL = scorecard.DATA / "winners_panel_all.parquet"
RESULT = scorecard.DATA / "winners.json"

# Every filer, dead or alive (filers.py). Without monthly prices for the
# dead, momentum is left out — its absence alone would mark them — and size
# is the public float for everyone, so both are measured alike.
TRAITS_ALL = tuple(t for t in TRAITS if t != "momentum")
NEAR = pd.Timedelta(days=183)   # a value point counts for a date this close
DIVIDENDS = 0.016               # a year: the price proxy's measured shortfall
# What a company that stopped filing is assumed to earn from its last value
# point to its exit. Bought: a typical takeover premium, most of it after the
# last point (Betton, Eckbo & Thorburn, "Corporate Takeovers", Handbook of
# Corporate Finance, 2008). Gone (delisted, deregistered or silent): Shumway
# (1997) measures -30% from the last trade; the last point here is up to a
# year and a half earlier, through the slide, so twice that is the centre.
EXIT_BOUGHT = 0.25
EXIT_GONE = -0.50


def days(last: int = LAST) -> list[str]:
    return [f"{y}-06-30" for y in range(FIRST, last + 1)]


def panel(rebuild: bool = False) -> pd.DataFrame:
    """One row per company per 30 June: traits as known that day and the
    yearly return that followed over each horizon (NaN while unfinished)."""
    if PANEL.exists() and not rebuild:
        return pd.read_parquet(PANEL)
    every = [t for t, c in scorecard.companies().items() if not scorecard.is_financial(c["sic"])]
    rets = proof.monthly_returns(every + ["SPY"])
    rows = []
    for day in days():
        cards = scorecard.cards(day, every)
        mv = pricer.market_values(day, [c["ticker"] for c in cards])
        mom = proof.momentum(rets, day)
        later = {h: proof.realised(rets, day, h) for h in HORIZONS}
        for c in cards:
            t = c["ticker"]
            if t not in mv or mv[t]["market_value"] < MIN_VALUE:
                continue
            years = [r for r in c["return_by_year"] if r is not None]
            rows.append({"date": day, "ticker": t,
                         "log_size": np.log(mv[t]["market_value"]), "momentum": mom.get(t),
                         "moat_years": float(np.mean([r >= 0.15 for r in years])) if years else None,
                         **{k: c.get(k) for k in TRAITS if k in c},
                         **{f"r{h}": later[h].get(t) for h in HORIZONS},
                         **{f"spy{h}": later[h].get("SPY") for h in HORIZONS}})
        print(f"[winners] {day}: {sum(r['date'] == day for r in rows)} companies", flush=True)
    df = pd.DataFrame(rows)
    df.to_parquet(PANEL)
    return df


def filers_context() -> tuple:
    """What filers_on() reads: non-financial filers, value points, facts."""
    info = filers.info()
    info = info[info["sic"].str.isdigit() & ~info["sic"].map(scorecard.is_financial)].set_index("symbol")
    return info, filers.value_points(), filers.connect()


def filers_on(day: str, info: pd.DataFrame, pts: pd.DataFrame, conn) -> list[dict]:
    """Every filer worth MIN_VALUE or more on `day` by its last public float
    filed by then, with a 10-K for a fiscal year ended in the 18 months
    before, and its traits as known that day."""
    t = pd.Timestamp(day)
    known = pts[(pts["filed_at"] <= t) & (pts["float_date"] >= t - pd.Timedelta(days=548))]
    last = known.sort_values("float_date").groupby("symbol").tail(1)
    last = last[last["symbol"].isin(info.index) & (last["float"] >= MIN_VALUE)].set_index("symbol")
    syms = last.index.tolist()
    years = scorecard.annual(conn, day, syms)
    shares = scorecard.share_changes(conn, day, syms)
    cutoff = (t - pd.Timedelta(days=548)).date().isoformat()
    rows = []
    for sym, y in years.groupby("ticker"):
        y = y[y["revenue"].notna() | y["net_income"].notna()]
        if y.empty:
            continue
        c = scorecard.card(sym, y, info.at[sym, "sic"], shares.get(sym))
        if c["fiscal_year_end"] < cutoff:
            continue
        moat = [r for r in c["return_by_year"] if r is not None]
        rows.append({"date": day, "symbol": sym, "name": info.at[sym, "name"],
                     "log_size": np.log(last.at[sym, "float"]),
                     "moat_years": float(np.mean([r >= 0.15 for r in moat])) if moat else None,
                     **{k: c.get(k) for k in TRAITS_ALL if k in c and k != "log_size"}})
    return rows


def panel_all(rebuild: bool = False) -> pd.DataFrame:
    """One row per filer per 30 June, dead or alive: traits from its filings
    as known that day and its size from the last public float filed by then.
    Outcomes are added by outcomes(), which is cheap and carries the exit
    assumptions."""
    if PANEL_ALL.exists() and not rebuild:
        return pd.read_parquet(PANEL_ALL)
    info, pts, conn = filers_context()
    rows = []
    for day in days(LAST_ALL):
        got = filers_on(day, info, pts, conn)
        rows += got
        print(f"[winners] {day}: {len(got)} filers", flush=True)
    df = pd.DataFrame(rows)
    df.to_parquet(PANEL_ALL)
    return df


def outcomes(df: pd.DataFrame, exit_bought: float = EXIT_BOUGHT, exit_gone: float = EXIT_GONE,
             horizons: tuple = HORIZONS) -> pd.DataFrame:
    """Each row's yearly return over each horizon. Companies Yahoo still
    prices get their real total return; the rest, the price proxy chained
    from the public float nearest the start to the one nearest the end
    (filers.links: split-proof), plus DIVIDENDS. A
    company that stopped filing before the end is valued at its last point
    and leaves with its exit return; its money then sits in cash. Windows
    ending after the last value point anyone could have filed stay NaN."""
    df = df.copy()
    pts = filers.value_points().sort_values(["symbol", "float_date"])
    pts["link"] = filers.links(pts)
    by = {s: (g["float_date"].to_numpy(), g["link"].to_numpy()) for s, g in pts.groupby("symbol")}

    def change(link, i, k):
        """Price multiple from point i to point k; NaN if a link is missing."""
        return float(np.prod(link[i + 1:k + 1])) if k > i else 1.0
    f = filers.forms()
    last_10k = f[f["form"] == "10-K"].groupby("cik")["date"].max()
    bought = f[f["form"].isin(filers.BOUGHT)].groupby("cik")["date"].apply(list)
    co = scorecard.companies()
    ticker = {filers.symbol(c["cik"]): t for t, c in co.items() if c.get("cik")}
    rets = proof.monthly_returns(sorted(set(ticker.values())) + ["SPY"])
    horizon_end = pts["float_date"][pts["filed_at"] <= pts["filed_at"].max()].max() - NEAR

    def nearest(dates, when):
        i = np.argmin(np.abs(dates - np.datetime64(when)))
        return i if abs(dates[i] - np.datetime64(when)) <= NEAR.to_timedelta64() else None

    for h in horizons:
        out, how = [], []
        real = {d: proof.realised(rets, d, h) for d in df["date"].unique()}
        for d, sym in zip(df["date"], df["symbol"]):
            start, end = pd.Timestamp(d), pd.Timestamp(d) + pd.DateOffset(years=h)
            if end > horizon_end:
                out.append(np.nan); how.append(None); continue
            t = ticker.get(sym)
            if t and t in real[d]:
                out.append(real[d][t]); how.append("prices"); continue
            if sym not in by:
                out.append(np.nan); how.append(None); continue
            dates, link = by[sym]
            i = nearest(dates, start)
            if i is None:
                out.append(np.nan); how.append(None); continue
            j = nearest(dates, end)
            if j is not None and j > i:
                yrs = (dates[j] - dates[i]) / np.timedelta64(1, "D") / 365.25
                m = change(link, i, j)
                out.append(float(m ** (1 / yrs) - 1 + DIVIDENDS) if np.isfinite(m) else np.nan)
                how.append("proxy" if np.isfinite(m) else None); continue
            cik = int(sym[3:])
            if last_10k.get(cik, "9999") >= end.date().isoformat():
                out.append(np.nan); how.append(None); continue
            k = int(np.max(np.nonzero(dates <= np.datetime64(end))[0]))
            yrs = max((dates[k] - dates[i]) / np.timedelta64(1, "D") / 365.25, 0.0)
            was_bought = any(start.date().isoformat() <= x for x in bought.get(cik, []))
            exit_r = exit_bought if was_bought else exit_gone
            multiple = change(link, i, k) * (1 + DIVIDENDS) ** yrs * (1 + exit_r)
            if not np.isfinite(multiple):
                out.append(np.nan); how.append(None); continue
            out.append(float(max(multiple, 0.0) ** (1 / h) - 1)); how.append("bought" if was_bought else "gone")
        df[f"r{h}"], df[f"how{h}"] = out, how
        df[f"spy{h}"] = df["date"].map(lambda d: real[d].get("SPY"))
    return df


def ranks(day: pd.DataFrame, traits: tuple = TRAITS) -> np.ndarray:
    """The day's traits as ranks, -0.5 to +0.5, missing at 0."""
    cols = []
    for k in traits:
        x = pd.to_numeric(day[k], errors="coerce")
        cols.append((x.rank(pct=True) - 0.5).fillna(0.0).to_numpy() if x.notna().sum() > 1
                    else np.zeros(len(day)))
    return np.column_stack(cols)


def fit_logistic(X: np.ndarray, y: np.ndarray, ridge: float = RIDGE, iters: int = 50) -> np.ndarray:
    """Intercept then one weight per column, by Newton's method with an L2
    penalty on the weights (not the intercept)."""
    A = np.column_stack([np.ones(len(X)), X])
    w = np.zeros(A.shape[1])
    w[0] = np.log(max(y.mean(), 1e-4) / max(1 - y.mean(), 1e-4))
    pen = np.full(A.shape[1], ridge)
    pen[0] = 0.0
    for _ in range(iters):
        p = 1 / (1 + np.exp(-A @ w))
        grad = A.T @ (p - y) + pen * w
        hess = (A * (p * (1 - p))[:, None]).T @ A + np.diag(pen)
        step = np.linalg.solve(hess, grad)
        w -= step
        if np.abs(step).max() < 1e-8:
            break
    return w


def predict(w: np.ndarray, X: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-(w[0] + X @ w[1:])))


def auc(score: np.ndarray, y: np.ndarray) -> float | None:
    """The chance a random winner is scored above a random non-winner."""
    pos, neg = score[y], score[~y]
    if not len(pos) or not len(neg):
        return None
    r = pd.Series(np.concatenate([pos, neg])).rank().to_numpy()
    return float((r[:len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def survivor_gap(df: pd.DataFrame, h: int) -> dict | None:
    """How much the survivor-only universe's equal-weighted yearly return
    beats the survivor-free market's equal-weighted return (the average of
    French's ten size deciles, equal-weighted) over the same windows."""
    deciles = odds.french("Portfolios_Formed_on_ME", 1)
    cols = ["Lo 10"] + [f"{i}-Dec" for i in range(2, 10)] + ["Hi 10"]
    ew = pd.Series({m: np.mean([v[c] for c in cols if c in v]) for m, v in deciles.items()}).sort_index()
    gaps = []
    for day, g in df.groupby("date"):
        r = g[f"r{h}"].dropna()
        start = pd.Timestamp(day)
        months = [m for m in ew.index
                  if start < pd.Timestamp(f"{m[:4]}-{m[4:]}-28") <= start + pd.DateOffset(years=h)]
        if len(r) < 50 or len(months) < 12 * h - 1:
            continue
        market = float(np.prod(1 + ew[months]) ** (1 / h) - 1)
        gaps.append({"date": day, "universe": float(r.mean()), "survivor_free": market,
                     "gap": float(r.mean()) - market})
    if not gaps:
        return None
    return {"gap_a_year": float(np.mean([g["gap"] for g in gaps])), "by_date": gaps}


def evaluate(df: pd.DataFrame, traits: tuple, key: str) -> tuple[list[dict], list[np.ndarray]]:
    """Fit on the start dates whose TRAIN_H years had ended, rank the next
    date, and score the ranking on every horizon. Picks are also set against
    companies of their own size (tenths of the day's sizes), as size alone
    carries most of the survivor bias."""
    df = df.copy()
    for h in HORIZONS:
        df[f"win{h}"] = df[f"r{h}"] >= GOAL
    df["size_tenth"] = df.groupby("date")["log_size"].rank(pct=True).mul(10).apply(np.ceil).clip(1, 10)
    dates = sorted(df["date"].unique())
    X = {d: ranks(df[df["date"] == d], traits) for d in dates}
    rows, weights = [], []
    for d in dates:
        known = [p for p in dates if pd.Timestamp(p) + pd.DateOffset(years=TRAIN_H) <= pd.Timestamp(d)]
        train = df[df["date"].isin(known) & df[f"r{TRAIN_H}"].notna()]
        if train[f"win{TRAIN_H}"].sum() < 10:
            continue
        Xt = np.vstack([X[p][(df[df["date"] == p][f"r{TRAIN_H}"].notna()).to_numpy()] for p in known])
        w = fit_logistic(Xt, train[f"win{TRAIN_H}"].to_numpy().astype(float))
        weights.append(w)
        day = df[df["date"] == d].copy()
        day["p"] = predict(w, X[d])
        day = day.sort_values("p", ascending=False)
        row = {"date": d, "companies": len(day), "top_names": day[key].head(10).tolist()}
        for h in HORIZONS:
            done = day[day[f"r{h}"].notna()]
            if len(done) < 50:
                continue
            row[f"base_rate_{h}y"] = float(done[f"win{h}"].mean())
            row[f"auc_{h}y"] = auc(done["p"].to_numpy(), done[f"win{h}"].to_numpy())
            row[f"universe_{h}y"] = float(done[f"r{h}"].mean())
            row[f"spy_{h}y"] = float(done[f"spy{h}"].iloc[0])
            for n in TOP:
                top, rest = done.head(n), done.iloc[n:]
                same_size = top["size_tenth"].map(rest.groupby("size_tenth")[f"r{h}"].mean())
                row[f"top{n}_hit_{h}y"] = float(top[f"win{h}"].mean())
                row[f"top{n}_return_{h}y"] = float(top[f"r{h}"].mean())
                row[f"top{n}_vs_size_{h}y"] = float((top[f"r{h}"] - same_size).mean())
                row[f"top{n}_median_{h}y"] = float(top[f"r{h}"].median())
            row[f"universe_median_{h}y"] = float(done[f"r{h}"].median())
        rows.append(row)
    return rows, weights


def pooled(rows: list[dict], h: int) -> dict | None:
    r = [x for x in rows if f"auc_{h}y" in x]
    if not r:
        return None
    out = {"dates": len(r), "base_rate": float(np.mean([x[f"base_rate_{h}y"] for x in r])),
           "auc": float(np.mean([x[f"auc_{h}y"] for x in r if x[f"auc_{h}y"] is not None])),
           "universe_return": float(np.mean([x[f"universe_{h}y"] for x in r])),
           "spy_return": float(np.mean([x[f"spy_{h}y"] for x in r]))}
    for n in TOP:
        out[f"top{n}_hit"] = float(np.mean([x[f"top{n}_hit_{h}y"] for x in r]))
        out[f"top{n}_return"] = float(np.mean([x[f"top{n}_return_{h}y"] for x in r]))
        out[f"top{n}_years_ahead"] = int(sum(x[f"top{n}_return_{h}y"] > x[f"universe_{h}y"] for x in r))
        vs = [x[f"top{n}_vs_size_{h}y"] for x in r]
        out[f"top{n}_vs_same_size"] = float(np.mean(vs))
        out[f"top{n}_ahead_of_same_size"] = int(sum(v > 0 for v in vs))
        out[f"top{n}_median"] = float(np.mean([x[f"top{n}_median_{h}y"] for x in r]))
    out["universe_median"] = float(np.mean([x[f"universe_median_{h}y"] for x in r]))
    return out


def run(which: str = "all", rebuild: bool = False,
        exit_bought: float = EXIT_BOUGHT, exit_gone: float = EXIT_GONE,
        extra: tuple = (), attach=None) -> dict:
    """`which`: "all" (every filer, dead or alive) or "survivors" (the
    companies that file today, with real prices). `attach` adds the columns
    named in `extra` (an attribute module's attach()), which join the traits;
    the run is saved and logged under `which` plus their names."""
    started = time.time()
    base = which
    if which == "all":
        df, traits, key = outcomes(panel_all(rebuild), exit_bought, exit_gone), TRAITS_ALL, "name"
    else:
        df, traits, key = panel(rebuild), TRAITS, "ticker"
    if attach is not None:
        df, traits = attach(df), traits + tuple(extra)
        which = "+".join([which, *extra])
    rows, weights = evaluate(df, traits, key)
    w = np.mean(weights, axis=0) if weights else None
    trials = monitor_trials() + 1
    how = {h: df[f"how{h}"].value_counts().to_dict() for h in HORIZONS} if base == "all" else None
    out = {"run_at": time.strftime("%Y-%m-%d %H:%M"), "seconds": round(time.time() - started),
           "which": which, "goal": GOAL, "train_h": TRAIN_H, "traits": list(traits), "trials": trials,
           "hurdle_t": validation.significance_hurdle(trials),
           "exits": {"bought": exit_bought, "gone": exit_gone} if base == "all" else None,
           "measured_by": how,
           "results": {str(h): pooled(rows, h) for h in HORIZONS},
           "weights": dict(zip(traits, w[1:].round(3).tolist())) if w is not None else None,
           "survivor_gap": {str(h): survivor_gap(df, h) for h in HORIZONS},
           "years": rows, "caveat": validation.SURVIVORSHIP_CAVEAT}
    saved = result() or {}
    saved = saved if "runs" in saved else {"runs": {}}
    saved["runs"][which] = out
    RESULT.write_text(json.dumps(saved, indent=1, default=float))
    monitor.log_experiment(f"winners:logistic:{which}",
                           {"traits": list(traits), "goal": GOAL, "train_h": TRAIN_H, "exits": out["exits"]},
                           {h: v for h, v in out["results"].items()})
    return out


def monitor_trials() -> int:
    """Earlier runs of this study, each one a try."""
    return sum(1 for e in monitor.experiments(1000) if e["kind"].startswith("winners:"))


def result() -> dict | None:
    return json.loads(RESULT.read_text()) if RESULT.exists() else None


if __name__ == "__main__":
    import sys
    r = run(sys.argv[1] if len(sys.argv) > 1 else "all")
    print(json.dumps({k: v for k, v in r.items() if k not in ("years", "survivor_gap")}, indent=1, default=float))
