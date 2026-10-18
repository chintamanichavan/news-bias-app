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

import monitor
import odds
import pricer
import proof
import scorecard
import validation

FIRST, LAST = 2010, 2021        # start years with prices and filings
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
RESULT = scorecard.DATA / "winners.json"


def days() -> list[str]:
    return [f"{y}-06-30" for y in range(FIRST, LAST + 1)]


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


def ranks(day: pd.DataFrame) -> np.ndarray:
    """The day's traits as ranks, -0.5 to +0.5, missing at 0."""
    cols = []
    for k in TRAITS:
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
    cols = [f"Dec {i}" for i in range(1, 10)] + ["Hi 10"]
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


def run(rebuild: bool = False) -> dict:
    started = time.time()
    df = panel(rebuild)
    for h in HORIZONS:
        df[f"win{h}"] = df[f"r{h}"] >= GOAL
    dates = sorted(df["date"].unique())
    X = {d: ranks(df[df["date"] == d]) for d in dates}
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
        row = {"date": d, "trained_on": known, "companies": len(day), "top_names": day["ticker"].head(10).tolist()}
        for h in HORIZONS:
            done = day[day[f"r{h}"].notna()]
            if len(done) < 50:
                continue
            row[f"base_rate_{h}y"] = float(done[f"win{h}"].mean())
            row[f"auc_{h}y"] = auc(done["p"].to_numpy(), done[f"win{h}"].to_numpy())
            row[f"universe_{h}y"] = float(done[f"r{h}"].mean())
            row[f"spy_{h}y"] = float(done[f"spy{h}"].iloc[0])
            for n in TOP:
                top = done.head(n)
                row[f"top{n}_hit_{h}y"] = float(top[f"win{h}"].mean())
                row[f"top{n}_return_{h}y"] = float(top[f"r{h}"].mean())
        rows.append(row)

    def pooled(h):
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
        return out

    w = np.mean(weights, axis=0) if weights else None
    trials = monitor_trials() + 1
    out = {"run_at": time.strftime("%Y-%m-%d %H:%M"), "seconds": round(time.time() - started),
           "goal": GOAL, "train_h": TRAIN_H, "traits": list(TRAITS), "trials": trials,
           "hurdle_t": validation.significance_hurdle(trials),
           "results": {str(h): pooled(h) for h in HORIZONS},
           "weights": dict(zip(TRAITS, w[1:].round(3).tolist())) if w is not None else None,
           "survivor_gap": {str(h): survivor_gap(df, h) for h in HORIZONS},
           "years": rows, "caveat": validation.SURVIVORSHIP_CAVEAT}
    RESULT.write_text(json.dumps(out, indent=1, default=float))
    monitor.log_experiment("winners:logistic", {"traits": list(TRAITS), "goal": GOAL, "train_h": TRAIN_H},
                           {h: v for h, v in out["results"].items()})
    return out


def monitor_trials() -> int:
    """Earlier runs of this study, each one a try."""
    return sum(1 for e in monitor.experiments(1000) if e["kind"].startswith("winners:"))


def result() -> dict | None:
    return json.loads(RESULT.read_text()) if RESULT.exists() else None


if __name__ == "__main__":
    r = run()
    print(json.dumps({k: v for k, v in r.items() if k not in ("years",)}, indent=1, default=float))
