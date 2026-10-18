"""
Insiders' own money — whether the people who run a company are buying its
shares in the open market, and whether they do it on a schedule.

Cohen, Malloy & Pomorski, "Decoding Inside Information" (Journal of Finance
67, 2012): an insider who traded in the same calendar month in each of the
three years before is "routine", and their trades carry no news; the others
who traded in each of those years are "opportunistic", and a portfolio
following their trades earned about 0.8% a month. Insiders buy for one
reason, to make money, but sell for many (Lakonishok & Lee, "Are Insider
Trades Informative?", Review of Financial Studies 14, 2001), so purchases
carry most of the signal; their net purchase ratio, (buys - sells) /
(buys + sells) over six months, is the second measure here.

Source: SEC's Insider Transactions Data Sets, every Form 4 since 2006 as
quarterly files, free. Only open-market purchases (code P) and sales (S) of
common stock count; grants, option exercises and gifts are not decisions to
buy or sell. A trade counts from the day it was filed.
"""

import zipfile

import numpy as np
import pandas as pd

import filers

DIR = filers.ROOT / "insiders"
TRADES = filers.ROOT / "insider_trades.parquet"


def load(rebuild: bool = False) -> pd.DataFrame:
    """Every open-market purchase and sale in the data sets: issuer cik,
    owner cik, relationship, trade and filing dates, code, shares, price."""
    if TRADES.exists() and not rebuild:
        return pd.read_parquet(TRADES)
    parts = []
    for f in sorted(DIR.glob("*_form345.zip")):
        with zipfile.ZipFile(f) as z:
            sub = pd.read_csv(z.open("SUBMISSION.tsv"), sep="\t", low_memory=False,
                              usecols=["ACCESSION_NUMBER", "FILING_DATE", "DOCUMENT_TYPE", "ISSUERCIK"])
            tr = pd.read_csv(z.open("NONDERIV_TRANS.tsv"), sep="\t", low_memory=False,
                             usecols=["ACCESSION_NUMBER", "TRANS_DATE", "TRANS_CODE", "TRANS_SHARES",
                                      "TRANS_PRICEPERSHARE", "TRANS_ACQUIRED_DISP_CD"])
            own = pd.read_csv(z.open("REPORTINGOWNER.tsv"), sep="\t", low_memory=False,
                              usecols=["ACCESSION_NUMBER", "RPTOWNERCIK", "RPTOWNER_RELATIONSHIP"])
        tr = tr[tr["TRANS_CODE"].isin(["P", "S"])]
        own = own.drop_duplicates("ACCESSION_NUMBER")         # the first reporting owner
        df = tr.merge(sub[sub["DOCUMENT_TYPE"].astype(str).str.startswith("4")], on="ACCESSION_NUMBER") \
               .merge(own, on="ACCESSION_NUMBER")
        parts.append(df)
        print(f"[insiders] {f.name}: {len(df)} trades", flush=True)
    df = pd.concat(parts, ignore_index=True)
    df = df.rename(columns={"ISSUERCIK": "cik", "RPTOWNERCIK": "owner", "RPTOWNER_RELATIONSHIP": "role",
                            "TRANS_CODE": "code", "TRANS_SHARES": "shares", "TRANS_PRICEPERSHARE": "price"})
    df["trade_date"] = pd.to_datetime(df["TRANS_DATE"], format="%d-%b-%Y", errors="coerce")
    df["filed"] = pd.to_datetime(df["FILING_DATE"], format="%d-%b-%Y", errors="coerce")
    df["value"] = pd.to_numeric(df["shares"], errors="coerce") * pd.to_numeric(df["price"], errors="coerce")
    df = df.dropna(subset=["trade_date", "filed", "cik", "owner"])
    df = df[["cik", "owner", "role", "code", "trade_date", "filed", "shares", "price", "value"]]
    df = df.astype({"cik": int, "owner": int}).drop_duplicates()
    df.to_parquet(TRADES)
    return df


def routine(trades: pd.DataFrame, year: int) -> pd.DataFrame:
    """For each (company, insider) who traded in each of the three calendar
    years before `year`: routine if they traded in one same calendar month
    in all three, else opportunistic. Others are unclassified."""
    past = trades[trades["trade_date"].dt.year.between(year - 3, year - 1)]
    past = past.assign(y=past["trade_date"].dt.year, m=past["trade_date"].dt.month)
    years = past.groupby(["cik", "owner"])["y"].nunique()
    every = years[years == 3].index
    months = past.set_index(["cik", "owner"]).loc[every].reset_index().groupby(["cik", "owner", "m"])["y"].nunique()
    is_routine = (months == 3).groupby(["cik", "owner"]).any()
    return is_routine.rename("routine").reset_index()


def features(day: str, trades: pd.DataFrame) -> pd.DataFrame:
    """Each company's insider measures known on `day` (filed by then):
    opportunistic purchases in the past year (count, and value), every
    insider's net purchase ratio over six months, and the count of trades."""
    d = pd.Timestamp(day)
    known = trades[trades["filed"] <= d]
    year = known[known["trade_date"] > d - pd.DateOffset(years=1)]
    kinds = routine(known, d.year)
    year = year.merge(kinds, on=["cik", "owner"], how="left")
    opp = year[(year["code"] == "P") & (year["routine"] == False)]       # noqa: E712 (NaN is unclassified)
    half = known[known["trade_date"] > d - pd.DateOffset(months=6)]
    buys = half[half["code"] == "P"].groupby("cik").size()
    sells = half[half["code"] == "S"].groupby("cik").size()
    ciks = sorted(set(year["cik"]) | set(half["cik"]))
    out = pd.DataFrame({"cik": ciks})
    out["opportunistic_buys"] = out["cik"].map(opp.groupby("cik").size()).fillna(0)
    out["opportunistic_buy_value"] = out["cik"].map(opp.groupby("cik")["value"].sum()).fillna(0)
    b, s = out["cik"].map(buys).fillna(0), out["cik"].map(sells).fillna(0)
    out["net_purchase_ratio"] = ((b - s) / (b + s)).where(b + s > 0)
    out["symbol"] = out["cik"].map(filers.symbol)
    return out.drop(columns="cik")


def attach(df: pd.DataFrame) -> pd.DataFrame:
    """Panel rows with their insider measures; a company with no insider
    trades on record gets zero buys and no ratio."""
    trades = load()
    parts = [df[df["date"] == d].merge(features(d, trades), on="symbol", how="left") for d in sorted(df["date"].unique())]
    out = pd.concat(parts, ignore_index=True)
    out["opportunistic_buys"] = out["opportunistic_buys"].fillna(0)
    out["opportunistic_buy_value"] = out["opportunistic_buy_value"].fillna(0)
    out["opportunistic_buy_share"] = out["opportunistic_buy_value"] / np.exp(out["log_size"])
    return out


def test(horizons: tuple = (1, 3)) -> dict:
    """On each 30 June, against companies of their own size, over the next
    1 and 3 years: companies with an opportunistic purchase in the past year
    against those without, and the fifth with the highest net purchase ratio
    against the lowest."""
    import winners
    df = attach(winners.outcomes(winners.panel_all(), horizons=horizons))
    df["size_tenth"] = df.groupby("date")["log_size"].rank(pct=True).mul(10).apply(np.ceil)
    out = {}
    for h in horizons:
        rows = []
        for d, g in df[df[f"r{h}"].notna()].groupby("date"):
            g = g.assign(excess=g[f"r{h}"] - g.groupby("size_tenth")[f"r{h}"].transform("mean"))
            bought = g["opportunistic_buys"] > 0
            npr = g["net_purchase_ratio"]
            fifth = np.ceil(npr.rank(pct=True) * 5)
            rows.append({"date": d, "with_buys": int(bought.sum()),
                         "buys_minus_none": float(g["excess"][bought].mean() - g["excess"][~bought].mean()),
                         "npr_top_minus_bottom": float(g["excess"][fifth == 5].mean() - g["excess"][fifth == 1].mean())
                         if npr.notna().sum() >= 50 else np.nan})
        s = pd.DataFrame(rows)
        for col in ("buys_minus_none", "npr_top_minus_bottom"):
            x = s[col].dropna()
            out[f"{col}_{h}y"] = {"dates": len(x), "a_year": float(x.mean()),
                                  "t": float(x.mean() / (x.std(ddof=1) / np.sqrt(len(x)))) if len(x) > 2 else None,
                                  "years_positive": int((x > 0).sum()),
                                  "before_2015": float(x[s.loc[x.index, "date"] < "2015"].mean()),
                                  "from_2015": float(x[s.loc[x.index, "date"] >= "2015"].mean())}
        out[f"companies_with_buys_{h}y"] = float(s["with_buys"].mean())
    return out
