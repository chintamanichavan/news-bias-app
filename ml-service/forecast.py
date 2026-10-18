"""
The forecast — a company's long-term return, learned from what returns
actually followed, and tested only on years it had not seen.

The pricer's implied return turned out to carry no information about the
next three or five years (proof.py). So instead of assuming how a business
will evolve, this measures how much each trait of a business has paid:

Each 30 June, every priced company's traits are ranked across the day's
companies (rank - 1/2, so -0.5 to +0.5; a missing trait sits at 0) and the
next twelve months' total return is regressed on them. The forecast on a
later date is the average of the earlier years' coefficients applied to that
day's ranks — Fama-MacBeth, as in Lewellen, "The Cross-Section of Expected
Stock Returns", Critical Finance Review 4, 2015. Ranks follow Gu, Kelly &
Xiu, "Empirical Asset Pricing via Machine Learning", Review of Financial
Studies 33, 2020.

The traits, each with the paper that says it should matter:
- roic, moat_years: profitability and how long it has lasted (Novy-Marx
  2013; Fama & French 2000);
- gross_margin, margin_swing: pricing power and its stability;
- sales_growth;
- issuance: share issuance (Pontiff & Woodgate 2008);
- reinvestment: capital spending (Titman, Wei & Xie 2004);
- altman_z: distress (Campbell, Hilscher & Szilagyi, "In Search of
  Distress Risk", Journal of Finance 63, 2008);
- implied: the pricer's implied return — valuation;
- momentum: the past year's return, last month skipped (Jegadeesh & Titman
  1993);
- size: log market value (Banz 1981).

Out of sample means: a forecast on date t uses only years whose twelve
months of returns had ended by t. It is judged on the 1-, 3- and 5-year
returns that followed (proof.realised) and by two portfolios — the top fifth
by forecast and the top TOP wide-moat names by forecast — which, with the
six portfolios proof.py tried, make PRIOR_TRIALS + 2 tries.
"""

import json
import time

import numpy as np
import pandas as pd
from scipy import stats as sstats

import monitor
import pricer
import proof
import scorecard
import validation

FEATURES = ("roic", "moat_years", "gross_margin", "margin_swing", "sales_growth", "issuance",
            "reinvestment", "altman_z", "implied", "momentum", "size")
HORIZONS = (1, 3, 5)
TOP = 20
PRIOR_TRIALS = 6
WINSOR = (0.01, 0.99)   # yearly returns clipped at these percentiles before fitting
RESULT = scorecard.DATA / "forecast.json"


def traits(priced: dict, cards: dict[str, dict], mom: dict[str, float]) -> pd.DataFrame:
    """One row per priced company: its raw traits, moat grade and name."""
    rows = []
    for p in priced["companies"]:
        c = cards.get(p["ticker"], {})
        years = [r for r in c.get("return_by_year", []) if r is not None]
        rows.append({
            "ticker": p["ticker"], "name": p["name"], "moat": p["moat"],
            "roic": c.get("return_median"),
            "moat_years": float(np.mean([r >= 0.15 for r in years])) if years else None,
            "gross_margin": c.get("gross_margin"),
            "margin_swing": c.get("gross_margin_swing"),
            "sales_growth": c.get("sales_growth_5y"),
            "issuance": c.get("share_change_yearly"),
            "reinvestment": c.get("reinvestment"),
            "altman_z": c.get("altman_z"),
            "implied": p["percentiles"]["50"],
            "momentum": mom.get(p["ticker"]),
            "size": np.log(p["market_value"]) if p["market_value"] > 0 else None,
        })
    return pd.DataFrame(rows).set_index("ticker")


def ranked(df: pd.DataFrame) -> pd.DataFrame:
    """Each trait as its rank across the day's companies, -0.5 to +0.5;
    a company missing a trait sits in the middle."""
    out = pd.DataFrame(index=df.index)
    for f in FEATURES:
        x = pd.to_numeric(df[f], errors="coerce")
        out[f] = (x.rank(pct=True) - 0.5).fillna(0.0) if x.notna().sum() > 1 else 0.0
    return out


def fit(X: pd.DataFrame, y: pd.Series) -> np.ndarray:
    """One year's coefficients: intercept, then one per trait."""
    y = y.clip(y.quantile(WINSOR[0]), y.quantile(WINSOR[1]))
    A = np.column_stack([np.ones(len(X)), X[list(FEATURES)].to_numpy()])
    return np.linalg.lstsq(A, y.to_numpy(), rcond=None)[0]


def predict(coef: np.ndarray, X: pd.DataFrame) -> pd.Series:
    return pd.Series(coef[0] + X[list(FEATURES)].to_numpy() @ coef[1:], index=X.index)


def sections(rets: pd.DataFrame) -> list[dict]:
    """Every replayed date's traits, ranks and the year of returns that followed."""
    out = []
    for day in proof.rebalance_dates(str(rets.index.max().date())):
        saved = json.loads((proof.REPLAY / f"{day}.json").read_text())
        cards = {c["ticker"]: c for c in scorecard.cards(day)}
        raw = traits(saved["priced"], cards, proof.momentum(rets, day))
        nxt = proof.realised(rets, day, 1)
        out.append({"date": day, "raw": raw, "X": ranked(raw),
                    "next_year": pd.Series({t: nxt[t] for t in raw.index if t in nxt})})
    return out


def run() -> dict:
    started = time.time()
    first = json.loads(proof.RESULT.read_text())["dates"]
    every = sorted({c["ticker"] for d in first
                    for c in json.loads((proof.REPLAY / f"{d}.json").read_text())["priced"]["companies"]}
                   | {"SPY"})
    rets = proof.monthly_returns(every)
    secs = sections(rets)
    coefs = []
    for s in secs:
        both = s["next_year"].index
        coefs.append(fit(s["X"].loc[both], s["next_year"]) if len(both) >= 50 else None)

    # Out of sample: each date's forecast from the years before it.
    tests, monthly, spy, rows = [], {"top_fifth": [], "moat_top": [], "universe": []}, [], []
    for i, s in enumerate(secs):
        past = [c for c in coefs[:i] if c is not None]
        if not past:
            continue
        f = predict(np.mean(past, axis=0), s["X"]).sort_values(ascending=False)
        fifth = max(1, len(f) // 5)
        wide = [t for t in f.index if s["raw"].loc[t, "moat"] == "wide"]
        held = {"top_fifth": list(f.index[:fifth]), "moat_top": wide[:TOP], "universe": list(f.index)}
        for k, names in held.items():
            monthly[k].append(proof.hold(rets, names, s["date"]))
        spy.append(proof.hold(rets, ["SPY"], s["date"]))
        row = {"date": s["date"], "trained_on": len(past), "moat_top_names": held["moat_top"]}
        for h in HORIZONS:
            if pd.Timestamp(s["date"]) + pd.DateOffset(years=h) > rets.index.max():
                continue
            real = proof.realised(rets, s["date"], h)
            both = [t for t in f.index if t in real]
            if len(both) < 30:
                continue
            fc, rl = f[both].to_numpy(), np.array([real[t] for t in both])
            row[f"rank_corr_{h}y"] = float(sstats.spearmanr(fc, rl)[0])
            tests.append({"date": s["date"], "h": h, "forecast": fc, "realised": rl})
        rows.append(row)

    trials = PRIOR_TRIALS + 2
    spy_all = pd.concat(spy)
    series = {k: pd.concat(v) for k, v in monthly.items()}
    portfolios = {k: {"growth_a_year": float(np.prod(1 + series[k].fillna(0)) ** (12 / len(series[k])) - 1),
                      "vs_spy": proof.summarise(series[k] - spy_all, 12, trials),
                      "vs_universe": proof.summarise(series[k] - series["universe"], 12, trials)
                      if k != "universe" else None}
                  for k in series}
    horizons = {}
    for h in HORIZONS:
        t = [x for x in tests if x["h"] == h]
        if not t:
            continue
        fc = np.concatenate([x["forecast"] for x in t])
        rl = np.concatenate([x["realised"] for x in t])
        slope, intercept = np.polyfit(fc, rl, 1)
        corrs = [r[f"rank_corr_{h}y"] for r in rows if f"rank_corr_{h}y" in r]
        # Fifths by forecast within each date, averaged over dates.
        fifths = np.zeros((5, 2))
        for x in t:
            order = np.argsort(np.argsort(x["forecast"])) * 5 // len(x["forecast"])
            for q in range(5):
                fifths[q] += [x["forecast"][order == q].mean(), x["realised"][order == q].mean()]
        fifths /= len(t)
        horizons[str(h)] = {
            "dates": len(t), "slope": float(slope), "intercept": float(intercept),
            "rank_corr_mean": float(np.mean(corrs)),
            "rank_corr_positive": int(sum(c > 0 for c in corrs)),
            "fifths": [{"fifth": q + 1, "forecast": float(a), "realised": float(b)}
                       for q, (a, b) in enumerate(fifths)]}

    # What each trait has paid, a year, per unit of rank (top vs bottom = 1).
    fitted = np.array([c for c in coefs if c is not None])
    payoffs = {f: {"mean": float(fitted[:, j + 1].mean()),
                   "t": float(fitted[:, j + 1].mean() / (fitted[:, j + 1].std(ddof=1) / np.sqrt(len(fitted))))
                   if len(fitted) > 1 and fitted[:, j + 1].std(ddof=1) > 0 else None}
               for j, f in enumerate(FEATURES)}
    out = {"run_at": time.strftime("%Y-%m-%d %H:%M"), "seconds": round(time.time() - started),
           "features": list(FEATURES), "trials": trials,
           "hurdle_t": validation.significance_hurdle(trials),
           "payoffs": payoffs, "horizons": horizons, "portfolios": portfolios,
           "spy_growth_a_year": float(np.prod(1 + spy_all) ** (12 / len(spy_all)) - 1),
           "years": rows, "coefficients": np.mean(fitted, axis=0).tolist(),
           "caveat": validation.SURVIVORSHIP_CAVEAT}
    RESULT.write_text(json.dumps(out, indent=1, default=float))
    monitor.log_experiment("forecast:fama_macbeth", {"features": list(FEATURES), "top": TOP},
                           {"horizons": {h: {k: v for k, v in d.items() if k != "fifths"}
                                         for h, d in horizons.items()},
                            "moat_top_vs_universe": portfolios["moat_top"]["vs_universe"]})
    return out


def result() -> dict | None:
    return json.loads(RESULT.read_text()) if RESULT.exists() else None


if __name__ == "__main__":
    print(json.dumps({k: v for k, v in run().items() if k not in ("years",)}, indent=1, default=float))
