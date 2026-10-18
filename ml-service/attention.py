"""
Attention — how many people are looking a company up.

Da, Engelberg & Gao, "In Search of Attention" (Journal of Finance 66, 2011):
a jump in attention (they used Google searches) is followed by higher
prices for a couple of weeks and a reversal within the year, as the buying
it draws in comes from the less informed. Moat, Curme, Avakian, Kenett,
Stanley & Preis, "Quantifying Wikipedia Usage Patterns Before Stock Market
Moves" (Scientific Reports 3, 2013) used Wikipedia page views.

Wikidata links companies to their SEC CIK (property P5531) and to their
English Wikipedia article; Wikimedia's API gives each article's monthly
views by people (not bots) since July 2015. Both free.

On each 30 June, from complete months before it:
- attention_spike: views in the last 3 months over the monthly average of
  the 12 before (log);
- attention_growth: the last 12 months over the 12 before (log).
Companies without an article sit out — they are smaller and more often
dead, so the tests compare within the covered companies only.
"""

import asyncio
import time
from urllib.parse import quote, unquote

import httpx
import numpy as np
import pandas as pd

import filers

UA = {"User-Agent": "Artha Research research@artha.app"}
VIEWS = filers.ROOT / "wiki_views.parquet"
LINKS = filers.ROOT / "wiki_links.parquet"
RATE = 5


def links(rebuild: bool = False) -> pd.DataFrame:
    """symbol, article: every CIK Wikidata links to an English article."""
    if LINKS.exists() and not rebuild:
        return pd.read_parquet(LINKS)
    q = """SELECT ?cik ?article WHERE { ?item wdt:P5531 ?cik . ?article schema:about ?item ;
           schema:isPartOf <https://en.wikipedia.org/> . }"""
    r = httpx.get("https://query.wikidata.org/sparql", params={"query": q, "format": "json"},
                  headers=UA, timeout=120)
    r.raise_for_status()
    rows = [(filers.symbol(b["cik"]["value"]), unquote(b["article"]["value"].rsplit("/wiki/", 1)[1]))
            for b in r.json()["results"]["bindings"] if b["cik"]["value"].isdigit()]
    df = pd.DataFrame(rows, columns=["symbol", "article"]).drop_duplicates("symbol")
    df.to_parquet(LINKS)
    return df


async def _views(client, pace, article: str) -> list[tuple[str, int]]:
    url = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/"
           f"{quote(article, safe='')}/monthly/2015070100/2026093000")
    for attempt in range(6):
        await pace()
        try:
            r = await client.get(url)
            if r.status_code == 404:
                return []
            if r.status_code == 429:
                await asyncio.sleep(15 * (attempt + 1))
                continue
            r.raise_for_status()
            return [(i["timestamp"][:6], int(i["views"])) for i in r.json().get("items", [])]
        except httpx.HTTPError:
            await asyncio.sleep(3)
    return []


async def collect(symbols: set[str]) -> pd.DataFrame:
    """symbol, month (YYYYMM), views for every linked company in `symbols`."""
    todo = links()
    todo = todo[todo["symbol"].isin(symbols)]
    lock, state = asyncio.Lock(), {"next": 0.0}

    async def pace():
        async with lock:
            now = time.monotonic()
            if now < state["next"]:
                await asyncio.sleep(state["next"] - now)
            state["next"] = max(now, state["next"]) + 1 / RATE

    rows = []
    async with httpx.AsyncClient(headers=UA, timeout=60) as client:
        results = await asyncio.gather(*[_views(client, pace, a) for a in todo["article"]])
    for sym, got in zip(todo["symbol"], results):
        rows += [(sym, m, v) for m, v in got]
    df = pd.DataFrame(rows, columns=["symbol", "month", "views"])
    df.to_parquet(VIEWS)
    return df


def features(day: str, views: pd.DataFrame) -> pd.DataFrame:
    """attention_spike and attention_growth from the complete months before
    `day`'s month."""
    last = (pd.Timestamp(day) - pd.DateOffset(months=1)).strftime("%Y%m")
    v = views[views["month"] <= last].pivot_table(index="symbol", columns="month", values="views")
    cols = sorted(v.columns)
    if len(cols) < 24:
        return pd.DataFrame(columns=["symbol", "attention_spike", "attention_growth"])
    recent3, before12 = v[cols[-3:]].mean(axis=1), v[cols[-15:-3]].mean(axis=1)
    last12, prior12 = v[cols[-12:]].sum(axis=1), v[cols[-24:-12]].sum(axis=1)
    out = pd.DataFrame({"attention_spike": np.log((recent3 + 1) / (before12 + 1)),
                        "attention_growth": np.log((last12 + 1) / (prior12 + 1))})
    return out.reset_index()


def attach(df: pd.DataFrame) -> pd.DataFrame:
    views = pd.read_parquet(VIEWS)
    parts = [df[df["date"] == d].merge(features(d, views), on="symbol", how="left")
             for d in sorted(df["date"].unique())]
    return pd.concat(parts, ignore_index=True)


def test(horizons: tuple = (1, 3)) -> dict:
    """On each 30 June with two years of views behind it, among companies
    with an article, against companies of their own size (medians): the
    fifth with the biggest spike against the smallest, and likewise for
    growth."""
    import winners
    df = attach(winners.outcomes(winners.panel_all(), horizons=horizons))
    df = df[df["attention_growth"].notna()]
    df["size_tenth"] = df.groupby("date")["log_size"].rank(pct=True).mul(10).apply(np.ceil)
    out = {}
    for h in horizons:
        for col in ("attention_spike", "attention_growth"):
            rows = []
            for d, g in df[df[f"r{h}"].notna()].groupby("date"):
                excess = g[f"r{h}"] - g.groupby("size_tenth")[f"r{h}"].transform("median")
                fifth = np.ceil(g[col].rank(pct=True) * 5)
                rows.append((d, len(g), float(excess[fifth == 5].median() - excess[fifth == 1].median())))
            s = pd.DataFrame(rows, columns=["date", "companies", "spread"])
            x = s["spread"]
            out[f"{col}_{h}y"] = {"dates": len(x), "companies": float(s["companies"].mean()),
                                  "top_minus_bottom": float(x.mean()),
                                  "t": float(x.mean() / (x.std(ddof=1) / np.sqrt(len(x)))) if len(x) > 2 else None,
                                  "years_positive": int((x > 0).sum()),
                                  "by_date": dict(zip(s["date"], x.round(4)))}
    return out


if __name__ == "__main__":
    import winners
    links(rebuild=True)
    df = asyncio.run(collect(set(winners.panel_all()["symbol"])))
    print(len(df), "rows,", df["symbol"].nunique(), "companies")
