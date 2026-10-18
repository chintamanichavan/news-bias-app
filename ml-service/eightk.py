"""
Company news as the company itself must report it — the 8-K.

Since August 2004 a listed company has had four business days to file an
8-K for each event on a fixed list, and the filing names the event by item
number. That makes it news with no name matching and no tone guessing, for
dead companies too. SEC's submissions bulk file lists every filing's items;
older filings sit in the extra pages (CIK...-submissions-001.json) of the
same zip.

The items tested, each as "filed one in the 12 months before the date":
3.01 notice of delisting, 4.02 past results no longer to be relied on,
4.01 change of auditor, 2.06 impairment, 2.05 exit or restructuring costs,
5.02 a director or officer leaving or arriving, 1.01 a material agreement,
1.03 bankruptcy. Known from the filing date.
"""

import json
import zipfile

import numpy as np
import pandas as pd

import filers

SUBMISSIONS = filers.ROOT / "submissions.zip"
EIGHTK = filers.ROOT / "eightk.parquet"
ITEMS = {"3.01": "delisting_notice", "4.02": "restatement", "4.01": "auditor_change",
         "2.06": "impairment", "2.05": "restructuring", "5.02": "officer_change",
         "1.01": "material_agreement", "1.03": "bankruptcy"}


def _rows(block: dict, cik: int) -> list[tuple]:
    return [(cik, d, it) for f, d, it in zip(block["form"], block["filingDate"], block["items"]) if f == "8-K"]


def load(ciks: set[int] | None = None, rebuild: bool = False) -> pd.DataFrame:
    """cik, filed, item: one row per item of every 8-K."""
    if EIGHTK.exists() and not rebuild:
        return pd.read_parquet(EIGHTK)
    rows = []
    with zipfile.ZipFile(SUBMISSIONS) as z:
        names = set(z.namelist())
        for cik in sorted(ciks):
            name = f"CIK{cik:010d}.json"
            if name not in names:
                continue
            d = json.loads(z.read(name))
            rows += _rows(d["filings"]["recent"], cik)
            for page in d["filings"].get("files", []):
                if page["name"] in names:
                    rows += _rows(json.loads(z.read(page["name"])), cik)
    df = pd.DataFrame(rows, columns=["cik", "filed", "items"])
    df["item"] = df["items"].str.split(",")
    df = df.explode("item").drop(columns="items")
    df["item"] = df["item"].str.strip()
    df["filed"] = pd.to_datetime(df["filed"])
    df = df.drop_duplicates()
    df.to_parquet(EIGHTK, index=False)
    return df


def attach(df: pd.DataFrame) -> pd.DataFrame:
    """Panel rows with a 0/1 column per item: filed one in the past year."""
    ev = load()
    ev = ev[ev["item"].isin(ITEMS)]
    ev["symbol"] = ev["cik"].map(filers.symbol)
    parts = []
    for d in sorted(df["date"].unique()):
        day = pd.Timestamp(d)
        recent = ev[(ev["filed"] <= day) & (ev["filed"] > day - pd.DateOffset(years=1))]
        flags = pd.crosstab(recent["symbol"], recent["item"]).clip(upper=1).rename(columns=ITEMS)
        g = df[df["date"] == d].merge(flags, left_on="symbol", right_index=True, how="left")
        parts.append(g)
    out = pd.concat(parts, ignore_index=True)
    for col in ITEMS.values():
        out[col] = out[col].fillna(0) if col in out else 0.0
    return out


def test(horizons: tuple = (1, 3)) -> dict:
    """For each item, companies that filed one in the past year against
    those that did not, each against companies of their own size
    (medians), and the share that hit 40% a year or halved over 3 years."""
    import winners
    df = attach(winners.outcomes(winners.panel_all(), horizons=horizons))
    df["size_tenth"] = df.groupby("date")["log_size"].rank(pct=True).mul(10).apply(np.ceil)
    for h in horizons:
        df[f"x{h}"] = df[f"r{h}"] - df.groupby(["date", "size_tenth"])[f"r{h}"].transform("median")
    three = df[df["r3"].notna()]
    out = {}
    for col in ITEMS.values():
        row = {"filers_a_year": float(df.groupby("date")[col].sum().mean())}
        for h in horizons:
            s = df[df[f"x{h}"].notna()].groupby("date").apply(
                lambda g: g.loc[g[col] == 1, f"x{h}"].median() - g.loc[g[col] == 0, f"x{h}"].median())
            s = s.dropna()
            row[f"{h}y"] = float(s.mean())
            row[f"{h}y_t"] = float(s.mean() / (s.std(ddof=1) / np.sqrt(len(s)))) if len(s) > 2 else None
            row[f"{h}y_years_negative"] = f"{int((s < 0).sum())}/{len(s)}"
        hit, rest = three[three[col] == 1], three[three[col] == 0]
        row["hit40_3y"] = [float((hit["r3"] >= 0.40).mean()), float((rest["r3"] >= 0.40).mean())]
        row["halved_3y"] = [float(((1 + hit["r3"]) ** 3 <= 0.5).mean()), float(((1 + rest["r3"]) ** 3 <= 0.5).mean())]
        out[col] = row
    return out


if __name__ == "__main__":
    import winners
    ciks = {int(s[3:]) for s in winners.panel_all()["symbol"].unique()}
    ev = load(ciks, rebuild=True)
    print(len(ev), "items,", ev["cik"].nunique(), "companies")
