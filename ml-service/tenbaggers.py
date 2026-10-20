"""
Ten-baggers — can the companies that rise tenfold in five years be told
apart beforehand?

Bessembinder, "Do Stocks Outperform Treasury Bills?" (Journal of Financial
Economics 129, 2018): a few stocks make all of the market's net gain, and
most stocks trail Treasury bills over their lives. Among every U.S. filer
worth $50M or more on a 30 June since 2010, dead companies included, 0.9%
rose tenfold within five years (0.7% where a real price exists) and 19%
lost half (measured 2026-10-18).

The winner study's model (winners.evaluate), with the target moved: a win
is ten times the money in five years, 10^(1/5) - 1 = 58.5% a year, and the
model learns that same five-year label, so a start date is ranked only by
dates whose five years had ended before it. The traits are the filing
numbers known that day (winners.TRAITS_ALL).

Predicted beforehand (2026-10-19): AUC 0.62 at most; even the top 50 picks
hold ten-baggers under 3% of the time, against 0.9% at random.

Also: where the ten-baggers sat in the lose-less screen (were they kept or
dropped?), and what they looked like at the start against everyone else.

Measured 2026-10-19, 166 ten-baggers among 18,951 company-starts:
- the model ranked no better than chance: AUC 0.51 over the four start
  dates it could judge (2017-20); top 50 hit 1.0% against a 1.0% base,
  top 10 none;
- at the start they ranked low on latest ROIC (0.25), moat years (0.27),
  Altman Z (0.31) and size (0.38), and high on share issuance (0.68): the
  look of a wipeout. The corner losing money and issuing shares holds 1.5%
  ten-baggers against 0.8% elsewhere, but 38% of it halves, 15% loses 90%,
  and its average five years (1.56x) trail the rest (1.77x);
- the lose-less screen kept 68 of the 105 in its half; kept 1.0% vs dropped
  1.5% ten-baggers, while halving 24% vs 38%.
"""

import numpy as np
import pandas as pd

import eightk
import loseless
import monitor
import reports
import shorts
import winners

YEARS = 5
GOAL = 10 ** (1 / YEARS) - 1        # ten times in five years


def panel() -> pd.DataFrame:
    return winners.outcomes(winners.panel_all(), horizons=(YEARS,))


def model(df: pd.DataFrame) -> dict:
    rows, weights = winners.evaluate(df, winners.TRAITS_ALL, "name", goal=GOAL, horizons=(YEARS,), train_h=YEARS)
    out = winners.pooled(rows, YEARS) or {}
    out["by_date"] = [{k: v for k, v in r.items() if k in ("date", "companies", f"auc_{YEARS}y", f"base_rate_{YEARS}y",
                                                              f"top10_hit_{YEARS}y", f"top50_hit_{YEARS}y", "top_names")}
                      for r in rows]
    if weights:
        out["weights_last"] = dict(zip(winners.TRAITS_ALL, np.round(weights[-1][1:], 3).tolist()))
    return out


def profile(df: pd.DataFrame) -> dict:
    """Each trait's median day-rank (0 lowest, 1 highest) among the ten-
    baggers, against 0.5 for everyone."""
    d = df[df[f"r{YEARS}"].notna()].copy()
    d["ten"] = (1 + d[f"r{YEARS}"]) ** YEARS >= 10
    out = {}
    for t in winners.TRAITS_ALL:
        r = d.groupby("date")[t].rank(pct=True)
        out[t] = {"ten_baggers": float(r[d["ten"]].median()), "others": float(r[~d["ten"]].median())}
    return {"ten_baggers": int(d["ten"].sum()), "companies": int(len(d)), "median_rank": out}


def screen(df: pd.DataFrame) -> dict:
    """In the smaller half, the share of ten-baggers among the companies the
    lose-less screen keeps and drops (reports and 8-K filters; short
    interest starts in 2018, too late for five-year outcomes)."""
    d = loseless.flag(eightk.attach(shorts.attach(reports.attach(df))))
    d = d[d[f"r{YEARS}"].notna()]
    ten = (1 + d[f"r{YEARS}"]) ** YEARS >= 10
    keep = ~d["rewritten"] & ~d["bad_news"]
    halved = (1 + d[f"r{YEARS}"]) ** YEARS <= 0.5
    return {"kept": {"companies": int(keep.sum()), "ten_bagger_share": float(ten[keep].mean()), "halved": float(halved[keep].mean())},
            "dropped": {"companies": int((~keep).sum()), "ten_bagger_share": float(ten[~keep].mean()), "halved": float(halved[~keep].mean())},
            "ten_baggers_kept": f"{int((ten & keep).sum())} of {int(ten.sum())}"}


def run() -> dict:
    df = panel()
    out = {"goal_a_year": GOAL, "years": YEARS, "model": model(df), "profile": profile(df), "screen": screen(df)}
    m = out["model"]
    monitor.log_experiment("tenbaggers:logistic", {"traits": list(winners.TRAITS_ALL), "goal": GOAL, "years": YEARS},
                           {k: m.get(k) for k in ("auc", "base_rate", "top10_hit", "top50_hit")})
    return out


if __name__ == "__main__":
    import json
    print(json.dumps(run(), indent=1, default=str))
