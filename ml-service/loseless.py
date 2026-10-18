"""
The lose-less screen — small companies, minus the two groups that most
often halve.

No free attribute found the 40% winners (winners.py, insiders.py,
attention.py), but two found the losers: the most-shorted fifth
(shorts.py; 30% halve within 3 years) and the fifth whose 10-K was
rewritten most (reports.py; 25%). The screen holds every company in the
smaller half by size, equal weight, bought each 30 June, and drops those
two fifths, and (eightk.py) any company whose 8-Ks in the past year
reported a delisting notice, a restatement or a change of auditor (26-32%
of those halve). Short interest is on record from 2018, so each mix is run
from 2010 without it and from 2018 with it.

Same universe as the winner study, dead companies included, same return
measure (winners.outcomes). The price proxy reads a few tiny shells at
+1000% or more in a year (1% of company-years made 85% of the raw mean), so
each company's year is capped at CAP, about the 99th percentile; small
stocks do triple, but not a thousandfold. Medians are shown beside.
"""

import numpy as np
import pandas as pd

import eightk
import monitor
import reports
import scorecard
import shorts
import winners

SMALL = 0.5          # the smaller half by size, each date
DROP = 0.2           # a fifth
CAP = 3.0            # +300% a company-year
BAD_NEWS = ("delisting_notice", "restatement", "auditor_change")   # 8-K items, past year


def panel(horizons=(1, 3)) -> pd.DataFrame:
    return flag(eightk.attach(shorts.attach(reports.attach(winners.outcomes(winners.panel_all(), horizons=horizons)))))


def flag(df: pd.DataFrame) -> pd.DataFrame:
    """The smaller half on each date, with the three reasons to drop a
    company; smallcaps.py applies the same to today."""
    df = df.copy()
    df["size_pct"] = df.groupby("date")["log_size"].rank(pct=True)
    df = df[df["size_pct"] <= SMALL].copy()
    pct = lambda c: df.groupby("date")[c].rank(pct=True)       # NaN stays NaN
    df["rewritten"] = pct("cosine_content") <= DROP
    df["shorted"] = pct("short_ratio") > 1 - DROP
    df["bad_news"] = df[list(BAD_NEWS)].max(axis=1) == 1
    return df


def summary(g: pd.DataFrame) -> dict:
    """One group of companies across dates: the yearly path of an equal-
    weight portfolio rebalanced each 30 June, and 3-year outcomes."""
    one = g[g["r1"].notna()].assign(r1=lambda x: x["r1"].clip(upper=CAP)).groupby("date")["r1"]
    path = one.mean()
    wealth = (1 + path).cumprod()
    three = g[g["r3"].notna()]
    total3 = (1 + three["r3"]) ** 3
    return {"companies": float(one.size().mean()),
            "yearly_mean": float(np.exp(np.log1p(path).mean()) - 1),   # compounded
            "yearly_median_company": float(one.median().mean()),
            "worst_year": float(path.min()),
            "worst_fall": float((wealth / wealth.cummax()).min() - 1),
            "hit40_3y": float((three["r3"] >= 0.40).mean()),
            "halved_3y": float((total3 <= 0.5).mean()),
            "by_year": {str(d)[:10]: round(float(r), 4) for d, r in path.items()}}


def run() -> dict:
    df = panel()
    out = {}
    for name, start, keep in (
            ("reports_only", "2010", lambda d: ~d["rewritten"]),
            ("reports_8k", "2010", lambda d: ~d["rewritten"] & ~d["bad_news"]),
            ("all_three", "2018", lambda d: ~d["rewritten"] & ~d["shorted"] & ~d["bad_news"]),
            ("both", "2018", lambda d: ~d["rewritten"] & ~d["shorted"])):
        d = df[(df["date"] >= start)]
        if name in ("both", "all_three"):
            d = d[d["short_ratio"].notna()]                  # only where shorts are on record
        k = keep(d)
        out[name] = {"all_small": summary(d), "kept": summary(d[k]), "dropped": summary(d[~k])}
    monitor.log_experiment("loseless:screen", {"small": SMALL, "drop": DROP, "cap": CAP}, {k: v["kept"]["yearly_mean"] for k, v in out.items()})
    return out


def sources() -> dict:
    """Where the kept-minus-dropped gap (reports and 8-K filters, 2010 on)
    comes from, by how each company-year was measured; and, for companies
    with real prices, how far the price estimate strays for each group.
    Measured 2026-10-18: among real prices (survivors) the gap is +0.1
    points; it lives in the estimate rows (+8), the companies that later
    left the exchanges. The estimate flatters the dropped (+6.6 points
    mean error) a little more than the kept (+3.9), so it is not what makes
    the gap."""
    df = panel()
    d = df[(df["date"] >= "2010") & df["r1"].notna()].copy()
    d["keep"], d["r"] = ~d["rewritten"] & ~d["bad_news"], d["r1"].clip(upper=CAP)
    out = {"by_source": {f"{'kept' if k else 'dropped'}/{h}": {"share": float(len(g) / (d["keep"] == k).sum()),
                                                                "mean": float(g["r"].mean())}
                         for (k, h), g in d.groupby(["keep", "how1"])}}
    priced = d[d["how1"] == "prices"][["date", "symbol", "r", "keep"]]
    real = scorecard.companies
    scorecard.companies = lambda: {}                 # every row by the estimate
    try:
        est = winners.outcomes(winners.panel_all(), horizons=(1,))
    finally:
        scorecard.companies = real
    m = priced.merge(est[est["how1"] == "proxy"][["date", "symbol", "r1"]], on=["date", "symbol"])
    m["est"] = m["r1"].clip(upper=CAP)
    m["err"] = m["est"] - m["r"]
    out["estimate_error"] = {("kept" if k else "dropped"): {"mean": float(g["err"].mean()), "median": float(g["err"].median()),
                                                           "n": int(len(g))} for k, g in m.groupby("keep")}
    out["estimate_real_corr"] = float(m[["est", "r"]].corr().iloc[0, 1])
    return out


TILTS = {"share_change_yearly": -1, "gross_margin": 1, "reinvestment": -1, "altman_z": 1}   # +1: high is good


def tilts() -> dict:
    """Within the kept list (reports and 8-K filters, 2010 on), the best
    fifth by each business trait less the worst, on all rows and on real
    prices only. Measured 2026-10-18, against predictions of +2 to +5
    points each: issuance +3.7 (6 of 13 years; -4.5 on real prices, and
    the price estimate itself adjusts for share counts, so it cannot judge
    issuance), gross margin +3.1 (7 of 13), reinvestment -6.8 and Altman Z
    -1.8 (wrong way; real prices -15). No tilt is added."""
    df = panel()
    d = df[(df["date"] >= "2010") & ~df["rewritten"] & ~df["bad_news"] & df["r1"].notna()].copy()
    d["r"] = d["r1"].clip(upper=CAP)
    out = {}
    for trait, sign in TILTS.items():
        for name, g0 in (("all", d), ("prices", d[d["how1"] == "prices"])):
            gaps = []
            for _, g in g0[g0[trait].notna()].groupby("date"):
                if len(g) < 50:
                    continue
                f = np.ceil(g[trait].rank(pct=True) * 5)
                good, bad = (5, 1) if sign > 0 else (1, 5)
                gaps.append(g["r"][f == good].mean() - g["r"][f == bad].mean())
            gaps = pd.Series(gaps)
            out[f"{trait}/{name}"] = {"a_year": float(gaps.mean()), "years_ahead": f"{int((gaps > 0).sum())}/{len(gaps)}"}
    monitor.log_experiment("loseless:tilts", {"traits": list(TILTS)}, {k: v["a_year"] for k, v in out.items()})
    return out


HOLDOUT = ("2023-06-30", "2024-06-30")      # never used to choose the filters


def holdout() -> dict:
    """The three filters on years the screen was not built on, one-year
    returns. Measured 2026-10-18, predicted +6 points in both: 2023 kept
    +5.6% vs dropped -3.9% (gap +9.5); 2024 kept +7.6% vs +10.7% (gap -3.1,
    while the median gap was +11.1: 15 dropped names hit the +300% cap
    against 5 kept, in the 2024-25 run in quantum, nuclear and battery
    names). Failures (gone) were 2.5-3 times as common among the dropped in
    both years: the avoidance held, the average edge did not in 2024."""
    info, pts, conn = winners.filers_context()
    df = pd.DataFrame([r for d in HOLDOUT for r in winners.filers_on(d, info, pts, conn)])
    df = flag(eightk.attach(shorts.attach(reports.attach(winners.outcomes(df, horizons=(1,))))))
    df = df[df["r1"].notna()].copy()
    df["r"], df["keep"] = df["r1"].clip(upper=CAP), ~df["rewritten"] & ~df["bad_news"] & ~df["shorted"]
    out = {}
    for d, g in df.groupby("date"):
        k, x = g[g["keep"]], g[~g["keep"]]
        out[d] = {"kept": float(k["r"].mean()), "dropped": float(x["r"].mean()),
                  "median_gap": float(k["r"].median() - x["r"].median()),
                  "gone": [float((k["how1"] == "gone").mean()), float((x["how1"] == "gone").mean())],
                  "at_cap": [int((k["r"] >= CAP).sum()), int((x["r"] >= CAP).sum())]}
    monitor.log_experiment("loseless:holdout", {"dates": list(HOLDOUT)}, {d: v["kept"] - v["dropped"] for d, v in out.items()})
    return out


def holdings(sizes=(10, 20, 50, 100), tries: int = 2000, seed: int = 7) -> dict:
    """How few kept companies (reports and 8-K filters, 2010 on) one can
    hold: each year a random `n` of them, `tries` times."""
    df = panel()
    d = df[(df["date"] >= "2010") & ~df["rewritten"] & ~df["bad_news"] & df["r1"].notna()]
    by = [g["r1"].clip(upper=CAP).to_numpy() for _, g in d.groupby("date")]
    rng, out = np.random.default_rng(seed), {}
    for n in sizes:
        yearly, worst, fall = [], [], []
        for _ in range(tries):
            yr = np.array([rng.choice(v, n, replace=False).mean() for v in by])
            w = np.cumprod(1 + yr)
            yearly.append(np.exp(np.log1p(yr).mean()) - 1)
            worst.append(yr.min())
            fall.append((w / np.maximum.accumulate(w)).min() - 1)
        yearly, worst, fall = map(np.array, (yearly, worst, fall))
        out[n] = {"yearly_median": float(np.median(yearly)), "yearly_5_95": np.percentile(yearly, [5, 95]).tolist(),
                  "worst_year_1_in_20": float(np.percentile(worst, 5)), "fall_past_half": float((fall <= -0.5).mean())}
    return out


if __name__ == "__main__":
    import json
    r = run()
    for name, groups in r.items():
        print(name)
        for g, s in groups.items():
            print(f"  {g:10s}", {k: round(v, 3) for k, v in s.items() if k != "by_year"})
    print(json.dumps({n: {g: s["by_year"] for g, s in gs.items()} for n, gs in r.items()}, indent=1))
