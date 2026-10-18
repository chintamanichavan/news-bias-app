"""
Short interest — how much of a company's stock traders have borrowed and
sold, betting it falls.

Rapach, Ringgenberg & Zhou, "Short Interest and Aggregate Stock Returns"
(Journal of Financial Economics 121, 2016) and Boehmer, Huszar & Jordan,
"The Good News in Short Interest" (Journal of Financial Economics 96,
2010): short sellers are among the best-informed traders; heavily shorted
stocks do worse, and lightly shorted ones better.

FINRA publishes every exchange's twice-monthly short positions through its
free query API, back to 2018. Tickers are matched to companies through the
ticker each issuer gave on its own Form 4 filings in the year before
(insiders.py), which keeps the companies that later died or changed ticker.

On each 30 June: short_ratio = shares short at the mid-June settlement over
shares outstanding from the company's latest 10-K cover page.
"""

import json
import zipfile

import httpx
import numpy as np
import pandas as pd

import filers
import insiders

API = "https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest"
UA = {"User-Agent": "Artha Research research@artha.app", "Accept": "application/json",
      "Content-Type": "application/json"}
SHORTS = filers.ROOT / "short_interest.parquet"
EXCHANGES = {"NYSE", "NNM", "SC", "AMEX", "ARCA", "BZX"}     # listed, not OTC


def settlement(year: int, client: httpx.Client) -> pd.DataFrame:
    """Every listed stock's short position at the mid-June settlement."""
    for day in range(10, 20):
        date = f"{year}-06-{day:02d}"
        rows, offset = [], 0
        while True:
            body = {"limit": 5000, "offset": offset,
                    "compareFilters": [{"compareType": "equal", "fieldName": "settlementDate", "fieldValue": date}]}
            r = client.post(API, content=json.dumps(body))
            got = r.json() if r.status_code == 200 and r.text.strip() else []
            rows += got
            if len(got) < 5000:
                break
            offset += 5000
        if rows:
            df = pd.DataFrame(rows)
            df = df[df["marketClassCode"].isin(EXCHANGES)]
            return pd.DataFrame({"year": year, "settled": date, "ticker": df["symbolCode"],
                                 "short": pd.to_numeric(df["currentShortPositionQuantity"], errors="coerce")})
    return pd.DataFrame()


def collect(years=range(2018, 2026)) -> pd.DataFrame:
    with httpx.Client(headers=UA, timeout=120) as client:
        df = pd.concat([settlement(y, client) for y in years], ignore_index=True)
    df.to_parquet(SHORTS)
    return df


def tickers() -> pd.DataFrame:
    """cik, ticker, filed: the ticker each issuer gave on its Form 4s."""
    parts = []
    for f in sorted(insiders.DIR.glob("*_form345.zip")):
        with zipfile.ZipFile(f) as z:
            s = pd.read_csv(z.open("SUBMISSION.tsv"), sep="\t", low_memory=False,
                            usecols=["FILING_DATE", "ISSUERCIK", "ISSUERTRADINGSYMBOL"])
        parts.append(s.dropna())
    s = pd.concat(parts, ignore_index=True)
    s["filed"] = pd.to_datetime(s["FILING_DATE"], format="%d-%b-%Y", errors="coerce")
    s["ticker"] = s["ISSUERTRADINGSYMBOL"].astype(str).str.upper().str.strip()
    return s.rename(columns={"ISSUERCIK": "cik"})[["cik", "ticker", "filed"]].dropna()


def attach(df: pd.DataFrame) -> pd.DataFrame:
    """Panel rows with their short ratio, where the June settlement is on
    record (2018 on)."""
    shorts = pd.read_parquet(SHORTS)
    names = tickers()
    pts = filers.value_points()
    out = []
    for d in sorted(df["date"].unique()):
        day = pd.Timestamp(d)
        s = shorts[shorts["year"] == day.year]
        g = df[df["date"] == d].copy()
        if s.empty:
            g["short_ratio"] = np.nan
            out.append(g)
            continue
        recent = names[(names["filed"] <= day) & (names["filed"] > day - pd.DateOffset(years=1))]
        latest = recent.sort_values("filed").groupby("ticker").tail(1)        # each ticker's issuer now
        m = s.merge(latest[["ticker", "cik"]], on="ticker")
        m["symbol"] = m["cik"].astype(int).map(filers.symbol)
        sh = pts[pts["filed_at"] <= day].sort_values("filed_at").groupby("symbol").tail(1)[["symbol", "shares"]]
        m = m.merge(sh, on="symbol")
        m["short_ratio"] = m["short"] / m["shares"]
        g = g.merge(m.groupby("symbol")["short_ratio"].max().clip(upper=1.0), on="symbol", how="left")
        out.append(g)
    return pd.concat(out, ignore_index=True)


def test(horizons: tuple = (1, 3)) -> dict:
    """Against companies of their own size (medians): the most-shorted
    fifth against the least, over the next 1 and 3 years."""
    import winners
    df = attach(winners.outcomes(winners.panel_all(), horizons=horizons))
    df = df[df["short_ratio"].notna()]
    df["size_tenth"] = df.groupby("date")["log_size"].rank(pct=True).mul(10).apply(np.ceil)
    out = {}
    for h in horizons:
        rows = []
        for d, g in df[df[f"r{h}"].notna()].groupby("date"):
            excess = g[f"r{h}"] - g.groupby("size_tenth")[f"r{h}"].transform("median")
            fifth = np.ceil(g["short_ratio"].rank(pct=True) * 5)
            rows.append((d, len(g), float(excess[fifth == 5].median() - excess[fifth == 1].median())))
        s = pd.DataFrame(rows, columns=["date", "companies", "spread"])
        x = s["spread"]
        out[f"most_minus_least_shorted_{h}y"] = {
            "dates": len(x), "companies": float(s["companies"].mean()), "a_year": float(x.mean()),
            "t": float(x.mean() / (x.std(ddof=1) / np.sqrt(len(x)))) if len(x) > 2 else None,
            "years_positive": int((x > 0).sum()), "by_date": dict(zip(s["date"], x.round(4)))}
    return out


if __name__ == "__main__":
    print(collect().groupby("year").size().to_dict())
