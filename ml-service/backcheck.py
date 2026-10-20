"""
Back-check — would the pricer's 10-year forecasts have held?

On each start date the pricer is rebuilt from what was known then: S&P 500
members that day, their filings filed by then, and fades fitted on the
panel known then (pricer.calibrate(save=False)). Each company's 5,000
futures give a range for two things ten fiscal years on: sales as a
multiple of the base year's, and return on capital in year 10. Then the
filings that came later say what happened.

Three questions:
- coverage: how often the real result fell inside the 90% range (5th to
  95th) and the 50% range (25th to 75th); a range that holds should hold
  about that often;
- error: the middle forecast's distance from the real result, against two
  plain rules: "the past five years continue" and "everyone grows 4% a
  year" for sales, "it stays where it is" and "it goes to its industry's
  median" for return on capital;
- order: whether companies forecast higher came out higher (rank
  correlation).

Survivors only: a member later bought or failed has no tenth year on file,
so it drops out; the count is reported.

Predicted beforehand (2026-10-19): return-on-capital range holds for
85-90% of companies, sales for 75-80%; the model clearly beats "the past
continues" on sales and slightly beats "it stays" on return on capital.

Measured 2026-10-19, starts 2014, 2015, 2016 (227-244 companies each):
- the 90% ranges held for 68-77% (sales) and 58-67% (return on capital),
  the 50% ranges for 36-42% and 34-39%: real results spread 1.5-2 times
  wider than the futures;
- sales: median log error 0.26-0.32 against 0.41-0.48 for "the past
  continues" but 0.28-0.34 for "everyone 4%": barely better than a constant;
- return on capital: error 5.8-6.7 points against 5.9-6.4 for "it stays";
  "it stays" ranks companies better every year (0.50-0.59 against
  0.39-0.50): the fade toward the industry median is too strong, as many
  companies hold a level of their own.
Not fit to show as forecasts until both are fixed and checked again.
"""

import numpy as np
import pandas as pd

import monitor
import pit
import pricer
import scorecard

STARTS = ("2014-06-30", "2015-06-30", "2016-06-30")
HORIZON = 10
NEAR = pd.Timedelta(days=75)         # a fiscal year end counts as "ten years on" within this


def forecasts(as_of: str) -> pd.DataFrame:
    """One row per member priced on `as_of`: its base year and the
    percentiles of sales multiple and year-10 return on capital."""
    cal = pricer.calibrate(as_of, save=False)
    cards = {c["ticker"]: c for c in scorecard.cards(as_of)}
    tickers = [t for t, c in cards.items() if not c["financial"]]
    years = scorecard.annual(pit.connect(), as_of, tickers)
    cutoff = (pd.Timestamp(as_of) - pd.Timedelta(days=548)).date().isoformat()
    members, past = {}, {}
    for t, y in years.groupby("ticker"):
        s = pricer._state(y)
        if s and s["fiscal_year_end"] >= cutoff:
            members[t] = s
            rev = y.set_index("year_end")["revenue"].dropna()
            five = rev[rev.index <= rev.index[-1] - pd.DateOffset(years=5) + NEAR]
            past[t] = (rev.iloc[-1] / five.iloc[-1]) ** (1 / 5) - 1 if len(five) and five.iloc[-1] > 0 else np.nan
    target = pricer.industry_targets(members, cards)
    rows = []
    for t, m in members.items():
        grade = cal["grades"][cards[t]["moat"] or "none"]
        fade = {**grade, "roic_noise": (grade["roic_noise"] + pricer.own_noise(cards[t], grade)) / 2}
        roic, growth = pricer.trajectories(m["roic"], m["growth"], fade, target[t],
                                           np.random.default_rng(pricer.SEED))
        sales = np.prod(1 + growth[:, :HORIZON], axis=1)
        r10 = roic[:, HORIZON - 1]
        row = {"as_of": as_of, "ticker": t, "moat": cards[t]["moat"], "base_end": m["fiscal_year_end"],
               "revenue": m["revenue"], "roic0": m["roic"], "target": target[t], "past_growth": past[t]}
        for q in (5, 25, 50, 75, 95):
            row[f"sales_{q}"], row[f"roic_{q}"] = np.percentile(sales, q), np.percentile(r10, q)
        rows.append(row)
    return pd.DataFrame(rows)


def outcomes(f: pd.DataFrame) -> pd.DataFrame:
    """The forecasts with what happened ten fiscal years on, from the
    filings known today."""
    years = scorecard.annual(pit.connect(), pd.Timestamp.today().date().isoformat(), sorted(f["ticker"].unique()))
    years = years.sort_values(["ticker", "year_end"])
    years["roic"] = scorecard.roic(years).clip(*pricer.CLIP_ROIC)
    real = []
    for _, r in f.iterrows():
        y = years[years["ticker"] == r["ticker"]]
        when = pd.Timestamp(r["base_end"]) + pd.DateOffset(years=HORIZON)
        hit = y[(y["year_end"] - when).abs() <= NEAR]
        real.append((hit["revenue"].iloc[-1] / r["revenue"], hit["roic"].iloc[-1]) if len(hit) else (np.nan, np.nan))
    f = f.copy()
    f["real_sales"], f["real_roic"] = zip(*real)
    return f


def score(d: pd.DataFrame) -> dict:
    def inside(col, lo, hi):
        return float(((d[f"real_{col}"] >= d[f"{col}_{lo}"]) & (d[f"real_{col}"] <= d[f"{col}_{hi}"])).mean())
    s = d[d["real_sales"] > 0]
    log_err = lambda forecast: float(np.median(np.abs(np.log(forecast) - np.log(s["real_sales"]))))
    past = (1 + s["past_growth"].clip(-0.5, 1.0)) ** HORIZON
    r = d.dropna(subset=["real_roic"])
    return {
        "companies": int(len(d)),
        "sales": {"inside_90": inside("sales", 5, 95), "inside_50": inside("sales", 25, 75),
                  "error_model": log_err(s["sales_50"]),
                  "error_past_continues": float(np.median(np.abs(np.log(past.dropna()) - np.log(s.loc[past.dropna().index, "real_sales"])))),
                  "error_everyone_4pct": log_err(np.full(len(s), 1.04 ** HORIZON)),
                  "rank_corr_model": float(s[["sales_50", "real_sales"]].corr("spearman").iloc[0, 1]),
                  "rank_corr_past": float(pd.concat([past, s["real_sales"]], axis=1).corr("spearman").iloc[0, 1])},
        "roic": {"inside_90": inside("roic", 5, 95), "inside_50": inside("roic", 25, 75),
                 "error_model": float((r["roic_50"] - r["real_roic"]).abs().median()),
                 "error_stays": float((r["roic0"] - r["real_roic"]).abs().median()),
                 "error_industry": float((r["target"] - r["real_roic"]).abs().median()),
                 "rank_corr_model": float(r[["roic_50", "real_roic"]].corr("spearman").iloc[0, 1]),
                 "rank_corr_stays": float(r[["roic0", "real_roic"]].corr("spearman").iloc[0, 1])},
    }


def run() -> dict:
    out = {}
    for day in STARTS:
        f = forecasts(day)
        d = outcomes(f)
        seen = d.dropna(subset=["real_sales", "real_roic"], how="all")
        out[day] = {"forecast": int(len(f)), "dropped_no_year_10": int(len(f) - len(seen)), **score(seen)}
    monitor.log_experiment("backcheck:10y", {"starts": list(STARTS)},
                           {d: {"sales_90": v["sales"]["inside_90"], "roic_90": v["roic"]["inside_90"]} for d, v in out.items()})
    return out


if __name__ == "__main__":
    import json
    print(json.dumps(run(), indent=1))
