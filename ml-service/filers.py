"""
Every company that filed an annual report, dead or alive.

The collected companies (scorecard.py) are those that file today, so every
company that failed or was bought is missing, and studies on them flatter
whatever traits dying companies share (winners.py). SEC's records keep the
dead: the quarterly form indexes list every filing since 1993, and the bulk
companyfacts and submissions files hold every filer's reported figures and
industry code, whether or not it still exists. All free.

- forms(): from the indexes, each company's 10-Ks and the forms that mark
  an exit — merger proxies and tender offers (bought), delisting notices
  and deregistrations (Form 25, Form 15);
- extract(): the scorecard's tags for every company with a 10-K from
  FIRST_YEAR on, plus two cover-page figures each 10-K carries: the public
  float (the market value of shares held by outsiders on the last day of
  the second fiscal quarter) and the shares outstanding;
- connect(): a DuckDB connection whose `fundamentals` view holds them, so
  scorecard.annual() reads them as it reads the collected companies.

Symbols are "CIK" + the ten-digit CIK, so these never collide with tickers.
"""

import json
import re
import zipfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

import scorecard

ROOT = Path(__file__).parent / "data" / "sec_bulk"
INDEX = ROOT / "index"
FORMS = ROOT / "forms.parquet"
FACTS = ROOT / "facts.parquet"
INFO = ROOT / "filers.parquet"
FIRST_YEAR, LAST_INDEX_YEAR = 2009, 2026
BOUGHT = {"DEFM14A", "DEFM14C", "SC TO-T", "SC 14D9", "SC 13E3"}
GONE = {"25-NSE", "25", "15-12B", "15-12G", "15-15D", "15F-12B", "15F-12G"}
COVER = {"EntityPublicFloat": "public_float", "EntityCommonStockSharesOutstanding": "shares_outstanding"}
_LINE = re.compile(r"^(\S+(?: \S+)?)\s{2,}(.+?)\s{2,}(\d+)\s+(\d{4}-\d{2}-\d{2})\s")
_DATE = re.compile(r"^(19|20)\d\d-\d\d-\d\d$")


def symbol(cik: str | int) -> str:
    return f"CIK{int(cik):010d}"


def forms(rebuild: bool = False) -> pd.DataFrame:
    """Every 10-K and exit form in the indexes: form, name, cik, date."""
    if FORMS.exists() and not rebuild:
        return pd.read_parquet(FORMS)
    keep = {"10-K"} | BOUGHT | GONE
    rows = []
    for f in sorted(INDEX.glob("*.idx")):
        for line in open(f, encoding="latin-1"):
            m = _LINE.match(line)
            if m and m.group(1) in keep:
                rows.append(m.groups())
    df = pd.DataFrame(rows, columns=["form", "name", "cik", "date"])
    df["cik"] = df["cik"].astype(int)
    df.to_parquet(FORMS)
    return df


def _one(args: tuple[str, int]) -> tuple[pd.DataFrame, dict | None]:
    """The figures and the industry of one company, read from the zips."""
    path, cik = args
    name = f"CIK{cik:010d}.json"
    with zipfile.ZipFile(path) as z:
        try:
            payload = json.loads(z.read(name))
        except KeyError:
            return pd.DataFrame(), None
    # Some filers type impossible dates (the year 202); such entries are dropped.
    for ns in payload.get("facts", {}).values():
        for node in ns.values():
            for unit, entries in (node.get("units") or {}).items():
                node["units"][unit] = [e for e in entries if all(
                    _DATE.match(e.get(k) or "2000-01-01") for k in ("start", "end", "filed"))]
    df = scorecard.parse_facts(symbol(cik), payload)
    cover = []
    for tag, col in COVER.items():
        for unit, entries in ((payload.get("facts", {}).get("dei") or {}).get(tag, {}).get("units") or {}).items():
            for e in entries:
                if e.get("val") is not None and e.get("filed") and e.get("end") and e.get("form", "").startswith("10-K"):
                    cover.append({"cik": f"{cik:010d}", "symbol": symbol(cik), "tag": tag, "unit": unit,
                                  "period_start": None, "period_end": e["end"], "value": float(e["val"]),
                                  "filed_at": e["filed"]})
    if cover:
        c = pd.DataFrame(cover)
        c["period_start"] = pd.NaT
        c["period_end"] = pd.to_datetime(c["period_end"])
        c["filed_at"] = pd.to_datetime(c["filed_at"])
        df = pd.concat([df, c], ignore_index=True)
    return df, {"cik": cik, "name": payload.get("entityName")}


def _info(args: tuple[str, list[int]]) -> list[dict]:
    path, ciks = args
    out = []
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        for cik in ciks:
            name = f"CIK{cik:010d}.json"
            if name not in names:
                continue
            s = json.loads(z.read(name))
            out.append({"cik": cik, "symbol": symbol(cik), "name": s.get("name"), "sic": s.get("sic") or "",
                        "industry": s.get("sicDescription") or "", "tickers": ",".join(s.get("tickers") or []),
                        "exchanges": ",".join(e or "" for e in (s.get("exchanges") or []))})
    return out


def extract(workers: int = 20) -> dict:
    """Figures and industry codes for every company with a 10-K from
    FIRST_YEAR on; writes FACTS and INFO."""
    f = forms()
    ciks = sorted(f[(f["form"] == "10-K") & (f["date"] >= f"{FIRST_YEAR}-01-01")]["cik"].unique().tolist())
    facts_zip, subs_zip = str(ROOT / "companyfacts.zip"), str(ROOT / "submissions.zip")
    parts, n = [], 0
    with ProcessPoolExecutor(workers) as pool:
        for df, _ in pool.map(_one, [(facts_zip, c) for c in ciks], chunksize=64):
            if len(df):
                parts.append(df)
                n += 1
        chunks = [ciks[i:i + 500] for i in range(0, len(ciks), 500)]
        info = [r for rows in pool.map(_info, [(subs_zip, c) for c in chunks]) for r in rows]
    facts = pd.concat(parts, ignore_index=True)
    facts.to_parquet(FACTS)
    pd.DataFrame(info).to_parquet(INFO)
    return {"companies": len(ciks), "with_facts": n, "rows": len(facts), "with_info": len(info)}


def connect() -> duckdb.DuckDBPyConnection:
    conn = duckdb.connect()
    conn.execute(f"CREATE VIEW fundamentals AS SELECT *, TIMESTAMPTZ '2000-01-01' AS ingested_at "
                 f"FROM read_parquet('{FACTS}')")
    return conn


def info() -> pd.DataFrame:
    return pd.read_parquet(INFO)


if __name__ == "__main__":
    import time
    t = time.time()
    print(len(forms(rebuild=True)), "forms", flush=True)
    print(extract(), f"{time.time() - t:.0f}s", flush=True)


def rescale(values: pd.Series) -> pd.Series:
    """Filers sometimes type a figure at the wrong scale (56.1 for $56.1
    billion). A value a thousandfold or more off the company's median is
    brought back by the power of a thousand nearest the gap."""
    med = values.median()
    if not med > 0:
        return values
    k = np.round(np.log10(med / values.where(values > 0)) / 3)
    return values * np.where(k.abs() >= 1, 1000.0 ** k.fillna(0), 1.0)


def value_points() -> pd.DataFrame:
    """Each 10-K's public float and the shares outstanding it reports, with
    their ratio as a price proxy: symbol, float_date, filed_at, float,
    shares, p. Float and shares are first-filed and rescaled per company."""
    conn = connect()
    cov = conn.execute("""
      SELECT symbol, tag, period_end, value, filed_at FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY symbol, tag, period_end ORDER BY filed_at) rn
        FROM fundamentals WHERE tag IN ('EntityPublicFloat', 'EntityCommonStockSharesOutstanding'))
      WHERE rn = 1""").df()
    fl = cov[cov["tag"] == "EntityPublicFloat"].rename(columns={"value": "float", "period_end": "float_date"})
    sh = (cov[cov["tag"] == "EntityCommonStockSharesOutstanding"]
          .groupby(["symbol", "filed_at"])["value"].sum().rename("shares").reset_index())   # all classes
    pts = fl[["symbol", "float_date", "filed_at", "float"]].merge(sh, on=["symbol", "filed_at"])
    pts = pts[(pts["float"] > 0) & (pts["shares"] > 0)].sort_values(["symbol", "float_date"])
    pts["float"] = pts.groupby("symbol")["float"].transform(rescale)
    pts["shares"] = pts.groupby("symbol")["shares"].transform(rescale)
    pts["p"] = pts["float"] / pts["shares"]
    pts = pts.drop_duplicates(["symbol", "float_date"])
    return pts.merge(share_growth(conn), on=["symbol", "filed_at"], how="left").reset_index(drop=True)


def share_growth(conn) -> pd.DataFrame:
    """Each 10-K's growth in weighted diluted shares over the prior year,
    both years as that filing states them — in the same units, so a split
    or reverse split between filings cancels out."""
    tags = scorecard.TAGS["shares"]
    raw = conn.execute(f"""
      SELECT symbol, tag, period_end, value, filed_at FROM fundamentals
      WHERE unit = 'shares' AND date_diff('day', period_start, period_end) BETWEEN 350 AND 380
        AND tag IN ({','.join('?' * len(tags))})""", list(tags)).df()
    rows = []
    for (sym, filed), f in raw.groupby(["symbol", "filed_at"]):
        for t in tags:                                   # the first tag present wins
            v = f[f["tag"] == t].drop_duplicates("period_end").set_index("period_end")["value"].sort_index()
            if len(v) >= 2 and 300 <= (v.index[-1] - v.index[-2]).days <= 430 and v.iloc[-2] > 0:
                rows.append((sym, filed, v.iloc[-1] / v.iloc[-2] - 1))
                break
    return pd.DataFrame(rows, columns=["symbol", "filed_at", "share_growth"])


def links(pts: pd.DataFrame) -> pd.Series:
    """Each value point's price change since the company's previous point:
    growth in public float over growth in shares, both read from the later
    10-K, so splits cancel. Without that filing's share growth, the ratio of
    float-over-shares, unless the share count jumped by half or more (a
    likely split); otherwise NaN. NaN for the first point, and across gaps
    of more than 15 months."""
    pts = pts.sort_values(["symbol", "float_date"])
    prev = pts.groupby("symbol")[["float_date", "float", "shares", "p"]].shift(1)
    gap = (pts["float_date"] - prev["float_date"]).dt.days
    by_growth = pts["float"] / prev["float"] / (1 + pts["share_growth"])
    jump = pts["shares"] / prev["shares"]
    by_price = (pts["p"] / prev["p"]).where(jump.between(2 / 3, 1.5))
    return by_growth.fillna(by_price).where(gap.between(250, 460))
