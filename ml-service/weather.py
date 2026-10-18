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
miss.

test_county() is the paper's finer measure: county temperatures (NOAA
nClimDiv) weighted by where each industry's establishments were in 1997
(Census County Business Patterns, the last SIC year), out of sample from
1998. Measured 2026-10-18, as predicted: 2 of 49 pass against 2.2 by luck;
+0.1% a year (t 0.05) at LAG 2, +2.3% (t 0.7) at LAG 1. Nothing either way.
Files in data/weather/ (downloaded, not in git): the county temperature
file, cbp97co.zip, and French's Siccodes49.zip.
"""

import io
import re
import zipfile
from pathlib import Path

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
DIR = Path(__file__).parent / "data" / "weather"
COUNTY_TEMPS = DIR / "climdiv-tmpccy-v1.0.0-20261006"      # NOAA nClimDiv, county monthly means
CBP = DIR / "cbp97co.zip"                                 # Census County Business Patterns 1997 (SIC)
SIC49 = DIR / "sic49.zip"                                 # French's SIC ranges for the 49 industries
# NOAA numbers the 48 contiguous states alphabetically; these are their FIPS codes in that order.
NOAA_TO_FIPS = [1, 4, 5, 6, 8, 9, 10, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
                31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 44, 45, 46, 47, 48, 49, 50, 51, 53, 54, 55, 56]


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


def county_shocks() -> pd.DataFrame:
    """Months x counties (5-digit FIPS): each county's monthly mean less its
    calendar month's mean over the NORMAL_YEARS before."""
    rows = []
    for line in open(COUNTY_TEMPS):
        code, *vals = line.split()
        st = int(code[:2])
        if st > len(NOAA_TO_FIPS):
            continue
        fips = f"{NOAA_TO_FIPS[st - 1]:02d}{code[2:5]}"
        year = code[7:11]
        rows += [(f"{year}{m + 1:02d}", fips, float(v)) for m, v in enumerate(vals) if float(v) > -99]
    t = pd.DataFrame(rows, columns=["month", "fips", "temp"]).pivot(index="month", columns="fips", values="temp")
    t = t.sort_index()
    cal = t.index.str[4:]
    normal = t.groupby(cal).transform(lambda x: x.shift(1).rolling(NORMAL_YEARS, min_periods=NORMAL_YEARS).mean())
    return t - normal


def industry_map() -> list[tuple[str, int, int]]:
    """(industry, first SIC, last SIC) from French's definitions."""
    text = zipfile.ZipFile(SIC49).read("Siccodes49.txt").decode("latin-1")
    out, name = [], None
    for line in text.splitlines():
        head = re.match(r"^\s*\d+\s+(\S+)\s", line)
        rng = re.match(r"^\s+(\d{4})-(\d{4})", line)
        if rng and name:
            out.append((name, int(rng.group(1)), int(rng.group(2))))
        elif head:
            name = head.group(1)
    return out


def weights() -> pd.DataFrame:
    """Industries x counties: each industry's share of its establishments
    in each county, 1997. Only 4-digit SIC rows count; the few 3-digit
    totals written as XXX0 scale a county's share within an industry about
    evenly, so they are left in."""
    with zipfile.ZipFile(CBP) as z:
        cbp = pd.read_csv(z.open("cbp97co.txt"), dtype=str, usecols=["fipstate", "fipscty", "sic", "est"])
    cbp = cbp[cbp["sic"].str.fullmatch(r"\d{4}") & (cbp["fipscty"] != "999")]
    cbp["sic"], cbp["est"] = cbp["sic"].astype(int), cbp["est"].astype(float)
    cbp["fips"] = cbp["fipstate"] + cbp["fipscty"]
    parts = []
    for name, lo, hi in industry_map():
        g = cbp[cbp["sic"].between(lo, hi)]
        parts.append(g.assign(industry=name)[["industry", "fips", "est"]])
    w = pd.concat(parts).groupby(["industry", "fips"])["est"].sum().unstack(fill_value=0.0)
    return w.div(w.sum(axis=1), axis=0)


def industry_shocks() -> pd.DataFrame:
    """Months x industries: the establishment-weighted county shock."""
    cs, w = county_shocks(), weights()
    common = [c for c in w.columns if c in cs.columns]
    cs, w = cs[common], w[common]
    w = w.div(w.sum(axis=1), axis=0)
    known = cs.notna()
    num = cs.fillna(0.0) @ w.T
    den = known.astype(float) @ w.T
    return (num / den).where(den > 0.5)


def test_county(start: str = "195001", oos: str = "199801") -> dict:
    """The test above with each industry's own shock: its t+LAG return on
    its establishment-weighted temperature shock; out of sample from 1998
    (after the 1997 weights), long the LEGS industries predicted most, short
    the LEGS predicted least."""
    sh, ind = industry_shocks(), industries()
    months = [m for m in sh.index if m >= start and _shift(m, LAG) in ind.index]
    x = sh.loc[months]
    y = ind.loc[[_shift(m, LAG) for m in months]]
    y.index = months
    cols = [c for c in y.columns if c in x.columns]
    x, y = x[cols], y[cols]
    slopes = {}
    for c in cols:
        ok = x[c].notna() & y[c].notna()
        xx, yy = x[c][ok] - x[c][ok].mean(), y[c][ok] - y[c][ok].mean()
        b = (xx * yy).sum() / (xx * xx).sum()
        se = np.sqrt(((yy - b * xx) ** 2).sum() / (len(xx) - 2) / (xx * xx).sum())
        slopes[c] = {"slope": float(b), "t": float(b / se)}
    spread = []
    for i, m in enumerate(months):
        if m < oos:
            continue
        px, py = x.iloc[:i], y.iloc[:i]
        b = {}
        for c in cols:
            ok = px[c].notna() & py[c].notna()
            xx, yy = px[c][ok] - px[c][ok].mean(), py[c][ok] - py[c][ok].mean()
            b[c] = (xx * yy).sum() / (xx * xx).sum()
        pred = (pd.Series(b) * x.iloc[i]).dropna().sort_values()
        now = y.iloc[i]
        spread.append(float(now[pred.index[-LEGS:]].mean() - now[pred.index[:LEGS]].mean()))
    sp = pd.Series(spread)
    out = {"months": len(months), "industries": len(cols),
           "passing_t2": sorted([k for k, v in slopes.items() if abs(v["t"]) > 2], key=lambda k: -abs(slopes[k]["t"])),
           "expected_by_luck": round(0.0455 * len(cols), 1), "slopes": slopes,
           "out_of_sample": {"from": oos, "months": len(sp), "a_year": float(sp.mean() * 12),
                             "t": float(sp.mean() / (sp.std(ddof=1) / np.sqrt(len(sp)))),
                             "months_positive": float((sp > 0).mean())}}
    monitor.log_experiment("weather:county", {"lag": LAG, "legs": LEGS, "start": start, "oos": oos},
                           {"passing": len(out["passing_t2"]), "oos_a_year": out["out_of_sample"]["a_year"]})
    return out


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
