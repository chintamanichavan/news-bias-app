"""
The lose-less screen — small companies, minus the two groups that most
often halve.

No free attribute found the 40% winners (winners.py, insiders.py,
attention.py), but two found the losers: the most-shorted fifth
(shorts.py; 30% halve within 3 years) and the fifth whose 10-K was
rewritten most (reports.py; 25%). The screen holds every company in the
smaller half by size, equal weight, bought each 30 June, and drops those
two fifths. Short interest is on record from 2018, so the screen is run
twice: report filter alone (2010 on) and both filters (2018 on).

Same universe as the winner study, dead companies included, same return
measure (winners.outcomes). The price proxy reads a few tiny shells at
+1000% or more in a year (1% of company-years made 85% of the raw mean), so
each company's year is capped at CAP, about the 99th percentile; small
stocks do triple, but not a thousandfold. Medians are shown beside.
"""

import numpy as np
import pandas as pd

import monitor
import reports
import shorts
import winners

SMALL = 0.5          # the smaller half by size, each date
DROP = 0.2           # a fifth
CAP = 3.0            # +300% a company-year


def panel(horizons=(1, 3)) -> pd.DataFrame:
    df = shorts.attach(reports.attach(winners.outcomes(winners.panel_all(), horizons=horizons)))
    df["size_pct"] = df.groupby("date")["log_size"].rank(pct=True)
    df = df[df["size_pct"] <= SMALL].copy()
    pct = lambda c: df.groupby("date")[c].rank(pct=True)       # NaN stays NaN
    df["rewritten"] = pct("cosine_content") <= DROP
    df["shorted"] = pct("short_ratio") > 1 - DROP
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
            ("both", "2018", lambda d: ~d["rewritten"] & ~d["shorted"])):
        d = df[(df["date"] >= start)]
        if name == "both":
            d = d[d["short_ratio"].notna()]                  # only where shorts are on record
        k = keep(d)
        out[name] = {"all_small": summary(d), "kept": summary(d[k]), "dropped": summary(d[~k])}
    monitor.log_experiment("loseless:screen", {"small": SMALL, "drop": DROP, "cap": CAP}, {k: v["kept"]["yearly_mean"] for k, v in out.items()})
    return out


if __name__ == "__main__":
    import json
    r = run()
    for name, groups in r.items():
        print(name)
        for g, s in groups.items():
            print(f"  {g:10s}", {k: round(v, 3) for k, v in s.items() if k != "by_year"})
    print(json.dumps({n: {g: s["by_year"] for g, s in gs.items()} for n, gs in r.items()}, indent=1))
