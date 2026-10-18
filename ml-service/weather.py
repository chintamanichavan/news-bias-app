"""
Weather as an attribute — does an unusually hot or cold month move
industries?

Addoum, Ng & Ortiz-Bobea, "Temperature Shocks and Industry Earnings News"
(Review of Financial Studies 36, 2023): temperature shocks predict earnings
in many industries, and analysts and prices are slow to take it in. Weather
is regional and industry-wide, so the test is on industries, not
companies.

Temperature: NOAA's contiguous-U.S. monthly mean since 1895 (Climate at a
Glance, free). The shock is the month's mean less the same calendar
month's mean over the 30 years before, so it is known without hindsight.
NOAA publishes about a week after the month ends, so a shock in month t is
traded in month t+2. Industries: French's 49, value-weighted, each less
the market (the 49's average) in that month.

test(): for each industry, the slope of its t+2 return on the shock,
1950 on; and out of sample from 1990, each month long the five industries
whose past slopes (fitted only on months before) predict most, short the
five predicted least.

Measured 2026-10-18, as predicted beforehand: 3 of 49 industries pass
|t| > 2 (business services, steel, personal services) against 2.2 by luck;
out of sample from 1990, -0.5% a year (t -0.2). Trading a month sooner
(LAG = 1, as daily data would allow): 1 industry, +0.8% a year (t 0.3).
National monthly temperature does not move industries in a way prices
miss. The paper's measure is finer (county temperatures weighted by where
each industry's plants are), which this does not test.
"""

import io

import httpx
import numpy as np
import pandas as pd

import monitor
import odds

NOAA = ("https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/national/time-series/"
        "110/tavg/1/0/1895-2026/data.csv")
UA = {"User-Agent": "Artha Research research@artha.app"}
LAG = 2                  # months from the shock to the trade
NORMAL_YEARS = 30
LEGS = 5


def temperature() -> pd.Series:
    r = httpx.get(NOAA, headers=UA, timeout=60)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text), comment="#", dtype={"Date": str})
    return pd.Series(df["Value"].to_numpy(), index=df["Date"].to_numpy())


def shocks(t: pd.Series) -> pd.Series:
    """Each month's temperature less its calendar month's mean over the
    NORMAL_YEARS before it."""
    out = {}
    for m, v in t.items():
        same = [t[k] for k in t.index if k[4:] == m[4:] and int(m[:4]) - NORMAL_YEARS <= int(k[:4]) < int(m[:4])]
        if len(same) >= NORMAL_YEARS:
            out[m] = v - np.mean(same)
    return pd.Series(out)


def industries() -> pd.DataFrame:
    d = odds.french("49_Industry_Portfolios", 0)
    df = pd.DataFrame.from_dict(d, orient="index").sort_index()
    df = df.where(df > -0.99)                         # -99.99 is missing
    return df.sub(df.mean(axis=1), axis=0)            # less the market of 49


def _shift(month: str, k: int) -> str:
    y, m = int(month[:4]), int(month[4:]) + k
    y, m = y + (m - 1) // 12, (m - 1) % 12 + 1
    return f"{y}{m:02d}"


def test(start: str = "195001", oos: str = "199001") -> dict:
    s = shocks(temperature())
    ind = industries()
    rows = [(m, s[m]) for m in s.index if m >= start and _shift(m, LAG) in ind.index]
    x = pd.Series(dict(rows))
    y = ind.loc[[_shift(m, LAG) for m in x.index]]
    y.index = x.index
    slopes = {}
    for col in y:
        ok = y[col].notna()
        xx, yy = x[ok] - x[ok].mean(), y[col][ok]
        b = (xx * (yy - yy.mean())).sum() / (xx * xx).sum()
        resid = yy - yy.mean() - b * xx
        se = np.sqrt((resid ** 2).sum() / (len(xx) - 2) / (xx * xx).sum())
        slopes[col] = {"slope": float(b), "t": float(b / se)}
    # Out of sample: slopes fitted only on months before, traded each month.
    spread = []
    for i, m in enumerate(x.index):
        if m < oos:
            continue
        past_x, past_y = x.iloc[:i], y.iloc[:i]
        xx = past_x - past_x.mean()
        b = past_y.apply(lambda c: (xx[c.notna()] * (c.dropna() - c.mean())).sum() / (xx[c.notna()] ** 2).sum())
        pred = (b * x.iloc[i]).dropna().sort_values()
        now = y.iloc[i]
        longs, shorts = pred.index[-LEGS:], pred.index[:LEGS]
        spread.append(float(now[longs].mean() - now[shorts].mean()))
    sp = pd.Series(spread)
    out = {"months": len(x), "industries": len(slopes),
           "passing_t2": sorted([k for k, v in slopes.items() if abs(v["t"]) > 2], key=lambda k: -abs(slopes[k]["t"])),
           "expected_by_luck": round(0.0455 * len(slopes), 1),
           "slopes": slopes,
           "out_of_sample": {"from": oos, "months": len(sp), "a_year": float(sp.mean() * 12),
                             "t": float(sp.mean() / (sp.std(ddof=1) / np.sqrt(len(sp)))),
                             "months_positive": float((sp > 0).mean())}}
    monitor.log_experiment("weather:industries", {"lag": LAG, "legs": LEGS, "start": start, "oos": oos},
                           {"passing": len(out["passing_t2"]), "oos_a_year": out["out_of_sample"]["a_year"]})
    return out


if __name__ == "__main__":
    r = test()
    print({k: v for k, v in r.items() if k != "slopes"})
    for k in r["passing_t2"]:
        print(k, {a: round(b, 4) for a, b in r["slopes"][k].items()})
