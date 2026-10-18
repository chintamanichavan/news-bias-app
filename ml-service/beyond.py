"""
Beyond the S&P 500 — do the two rules that held up among large companies
(a lasting moat pays, issuing shares costs) pay more where fewer
professionals look?

Return patterns are stronger outside the largest companies (Hou, Xue &
Zhang, "Replicating Anomalies", Review of Financial Studies 33, 2020), so
the same tests are run on the companies outside the index. Fixed before the
first run:

- universe on each 30 June: every collected company NOT in the S&P 500 that
  day, non-financial, worth at least MIN_VALUE. Companies that later joined
  the index stay in: dropping them would drop the biggest winners;
- moat_clean: wide moat and a share count that has not grown over the last
  five years — the two rules together;
- wide: every wide moat in the universe;
- sp_moat_clean: the same two rules inside the S&P 500, for comparison;
- each against its own control (every company in its universe), held a year,
  equal-weighted, dividends in; and moat against the rest over 3 and 5 years;
- what moat years and share issuance paid each year (Fama-MacBeth on their
  ranks with size).

These three portfolios bring the tries to PRIOR_TRIALS + 3.

The bias to keep in view: the collected list is companies that file TODAY,
and small companies fail more often than large ones, so survivors flatter
this universe more than the S&P 500's (Shumway & Warther, "The Delisting
Bias in CRSP's Nasdaq Data", Journal of Finance 54, 1999).
"""

import json
import time

import numpy as np
import pandas as pd

import monitor
import pricer
import proof
import scorecard
import validation

MIN_VALUE = 500e6
PRIOR_TRIALS = 8
CLEAN = 0.0                     # yearly share change at or below this: no dilution
PORTFOLIOS = ("moat_clean", "wide", "control", "sp_moat_clean", "sp_control")
PAYOFF_TRAITS = ("moat_years", "issuance", "size")
RESULT = scorecard.DATA / "beyond.json"


def universe(day: str) -> tuple[list[dict], list[dict], dict]:
    """The day's cards outside and inside the S&P 500 (non-financial, worth
    MIN_VALUE or more), and their market values."""
    inside = set(scorecard.members(day))
    every = list(scorecard.companies())
    cards = scorecard.cards(day, every)
    cards = [c for c in cards if not c["financial"]]
    values = pricer.market_values(day, [c["ticker"] for c in cards])
    ok = [c for c in cards if c["ticker"] in values and values[c["ticker"]]["market_value"] >= MIN_VALUE]
    return ([c for c in ok if c["ticker"] not in inside],
            [c for c in ok if c["ticker"] in inside], values)


def clean_moat(cards: list[dict]) -> list[str]:
    return [c["ticker"] for c in cards if c["moat"] == "wide"
            and c["share_change_yearly"] is not None and c["share_change_yearly"] <= CLEAN]


def moat_years(card: dict) -> float | None:
    years = [r for r in card["return_by_year"] if r is not None]
    return float(np.mean([r >= 0.15 for r in years])) if years else None


def payoff(cards: list[dict], values: dict, nxt: dict[str, float]) -> np.ndarray | None:
    """One year's coefficients on the ranks of PAYOFF_TRAITS."""
    rows = [(c["ticker"], moat_years(c), c["share_change_yearly"],
             np.log(values[c["ticker"]]["market_value"])) for c in cards if c["ticker"] in nxt]
    if len(rows) < 50:
        return None
    df = pd.DataFrame(rows, columns=["ticker", *PAYOFF_TRAITS]).set_index("ticker")
    X = np.column_stack([np.ones(len(df))] +
                        [(df[f].rank(pct=True) - 0.5).fillna(0).to_numpy() for f in PAYOFF_TRAITS])
    y = pd.Series(nxt)[df.index]
    y = y.clip(y.quantile(0.01), y.quantile(0.99))
    return np.linalg.lstsq(X, y.to_numpy(), rcond=None)[0]


def run() -> dict:
    started = time.time()
    first = json.loads(proof.RESULT.read_text())["dates"]
    days = []
    for day in first:
        out_, in_, values = universe(day)
        days.append({"date": day, "outside": out_, "inside": in_, "values": values})
        print(f"[beyond] {day}: {len(out_)} outside, {len(in_)} inside", flush=True)

    every = sorted({c["ticker"] for d in days for c in d["outside"] + d["inside"]} | {"SPY"})
    rets = proof.monthly_returns(every)

    monthly = {p: [] for p in PORTFOLIOS}
    spy, rows, coefs = [], [], []
    long = {h: [] for h in proof.HORIZONS}
    for d in days:
        held = {"moat_clean": clean_moat(d["outside"]),
                "wide": [c["ticker"] for c in d["outside"] if c["moat"] == "wide"],
                "control": [c["ticker"] for c in d["outside"]],
                "sp_moat_clean": clean_moat(d["inside"]),
                "sp_control": [c["ticker"] for c in d["inside"]]}
        row = {"date": d["date"], **{f"n_{k}": len(v) for k, v in held.items()}}
        for k, names in held.items():
            m = proof.hold(rets, names, d["date"])
            monthly[k].append(m)
            row[k] = float(np.prod(1 + m.fillna(0)) - 1)
        spy.append(proof.hold(rets, ["SPY"], d["date"]))
        coefs.append(payoff(d["outside"], d["values"], proof.realised(rets, d["date"], 1)))
        for h in proof.HORIZONS:
            if pd.Timestamp(d["date"]) + pd.DateOffset(years=h) > rets.index.max():
                continue
            real = proof.realised(rets, d["date"], h)
            def avg(names):
                v = [real[t] for t in names if t in real]
                return float(np.mean(v)) if v else None
            others = [t for t in held["control"] if t not in set(held["wide"])]
            long[h].append({"date": d["date"], "wide": avg(held["wide"]), "rest": avg(others),
                            "moat_clean": avg(held["moat_clean"]), "control": avg(held["control"])})
        rows.append(row)

    trials = PRIOR_TRIALS + 3
    spy_all = pd.concat(spy)
    series = {k: pd.concat(v) for k, v in monthly.items()}
    yearly = pd.DataFrame(rows).set_index("date")
    controls = {"moat_clean": "control", "wide": "control", "sp_moat_clean": "sp_control"}
    portfolios = {}
    for k in PORTFOLIOS:
        base = controls.get(k)
        portfolios[k] = {
            "growth_a_year": float(np.prod(1 + series[k].fillna(0)) ** (12 / len(series[k])) - 1),
            "vs_spy": proof.summarise(series[k] - spy_all, 12, trials),
            "vs_control": proof.summarise(series[k] - series[base], 12, trials) if base else None,
            "years_ahead": int((yearly[k] > yearly[base]).sum()) if base else None,
            "average_names": float(yearly[f"n_{k}"].mean())}
    fitted = np.array([c for c in coefs if c is not None])
    payoffs = {f: {"mean": float(fitted[:, j + 1].mean()),
                   "t": float(fitted[:, j + 1].mean() / (fitted[:, j + 1].std(ddof=1) / np.sqrt(len(fitted))))}
               for j, f in enumerate(PAYOFF_TRAITS)}
    horizons = {}
    for h, xs in long.items():
        xs = [x for x in xs if x["wide"] is not None and x["rest"] is not None]
        if xs:
            gap = [x["wide"] - x["rest"] for x in xs]
            clean = [x["moat_clean"] - x["control"] for x in xs if x["moat_clean"] is not None]
            horizons[str(h)] = {"dates": len(xs),
                                "wide": float(np.mean([x["wide"] for x in xs])),
                                "rest": float(np.mean([x["rest"] for x in xs])),
                                "wide_ahead": int(sum(g > 0 for g in gap)),
                                "moat_clean_vs_control": float(np.mean(clean)) if clean else None,
                                "moat_clean_ahead": int(sum(g > 0 for g in clean)),
                                "by_date": xs}
    out = {"run_at": time.strftime("%Y-%m-%d %H:%M"), "seconds": round(time.time() - started),
           "min_value": MIN_VALUE, "trials": trials, "hurdle_t": validation.significance_hurdle(trials),
           "spy_growth_a_year": float(np.prod(1 + spy_all) ** (12 / len(spy_all)) - 1),
           "portfolios": portfolios, "payoffs": payoffs, "horizons": horizons, "years": rows,
           "caveat": validation.SURVIVORSHIP_CAVEAT}
    RESULT.write_text(json.dumps(out, indent=1, default=float))
    monitor.log_experiment("beyond:moat_clean", {"min_value": MIN_VALUE, "clean": CLEAN},
                           {"moat_clean": portfolios["moat_clean"]["vs_control"],
                            "sp_moat_clean": portfolios["sp_moat_clean"]["vs_control"]})
    return out


def result() -> dict | None:
    return json.loads(RESULT.read_text()) if RESULT.exists() else None


if __name__ == "__main__":
    print(json.dumps({k: v for k, v in run().items() if k not in ("years", "horizons")},
                     indent=1, default=float))
