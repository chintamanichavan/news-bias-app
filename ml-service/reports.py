"""
The annual report as a signal — how much a company's 10-K changed from the
year before.

Cohen, Malloy & Nguyen, "Lazy Prices" (Journal of Finance 75, 2020): firms
whose annual report barely changes ("non-changers") beat firms whose report
changes a lot by up to 22% a year, and the market is slow to notice, because
a changed report often carries news (new risks, a lawsuit, a weaker
business) in prose few investors reread. Their main measure is the cosine
similarity of the two reports' word counts; Jaccard similarity of the word
sets is a second.

For every company in the winner study's universe (winners.panel_all), each
10-K's main document is read from EDGAR — only the first document of the
submission, never the exhibits — reduced to lower-case words (numbers and
markup dropped), and compared with the same company's previous 10-K when
that one was filed 9 to 15 months earlier. A similarity is known from its
filing date.

Free and public: EDGAR asks for at most ten requests a second and a
User-Agent naming the requester; RATE stays under it.
"""

import asyncio
import html
import math
import re
import time
from collections import Counter

import httpx
import numpy as np
import pandas as pd

import filers

UA = {"User-Agent": "Artha Research research@artha.app"}
RATE = 8                       # requests a second, under EDGAR's ten
WORKERS = 8
TENK = filers.ROOT / "tenk.parquet"
OUT = filers.ROOT / "lazy"     # one parquet per batch of companies; resumable
_TAG = re.compile(r"<[^>]+>")
# English function words: raw counts are dominated by them, which squeezes
# every cosine toward 1.
STOP = frozenset("""
a about above after again against all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have
having he her here hers him his how if in into is it its itself just may me might more most must my
no nor not now of off on once only or other our ours out over own same shall she should so some such
than that the their theirs them then there these they this those through to too under until up upon
us very was we were what when where which while who whom why will with within without would you your
""".split())
_WORD = re.compile(r"[a-z]{2,}")


def tenk_filings(symbols: set[str] | None = None, rebuild: bool = False) -> pd.DataFrame:
    """Every 10-K in the indexes with its file: cik, date, path."""
    if TENK.exists() and not rebuild:
        df = pd.read_parquet(TENK)
    else:
        rows = []
        for f in sorted(filers.INDEX.glob("*.idx")):
            for line in open(f, encoding="latin-1"):
                if line.startswith("10-K "):
                    parts = line.split()
                    rows.append((int(parts[-3]), parts[-2], parts[-1]))
        df = pd.DataFrame(rows, columns=["cik", "date", "path"]).drop_duplicates()
        df.to_parquet(TENK)
    if symbols is not None:
        df = df[df["cik"].map(filers.symbol).isin(symbols)]
    return df.sort_values(["cik", "date"]).reset_index(drop=True)


def words(raw: str) -> Counter:
    """Lower-case words of a filing's main document, markup and numbers out."""
    end = raw.find("</DOCUMENT>")
    body = raw[:end] if end > 0 else raw
    text = html.unescape(_TAG.sub(" ", body)).lower()
    return Counter(_WORD.findall(text))


def cosine(a: Counter, b: Counter) -> float:
    dot = sum(v * b.get(k, 0) for k, v in a.items())
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else float("nan")


def content(a: Counter) -> dict[str, float]:
    """Content words with compressed counts, 1 + log(count)."""
    return {k: 1 + math.log(v) for k, v in a.items() if v > 0 and k not in STOP}


def new_share(cur: Counter, prev: Counter) -> float:
    """The share of this report's content words, counted, that never
    appeared in the previous one."""
    total = sum(v for k, v in cur.items() if k not in STOP)
    fresh = sum(v for k, v in cur.items() if k not in STOP and k not in prev)
    return fresh / total if total else float("nan")


def jaccard(a: Counter, b: Counter) -> float:
    sa, sb = set(a), set(b)
    return len(sa & sb) / len(sa | sb) if sa | sb else float("nan")


class Pace:
    """At most `rate` request starts a second across all workers."""
    def __init__(self, rate: float):
        self.gap, self.next, self.lock = 1 / rate, 0.0, asyncio.Lock()

    async def wait(self):
        async with self.lock:
            now = time.monotonic()
            if now < self.next:
                await asyncio.sleep(self.next - now)
            self.next = max(now, self.next) + self.gap


async def first_document(client: httpx.AsyncClient, pace: Pace, path: str) -> str | None:
    """The submission's first document (the 10-K itself), streamed and cut
    off at its end so the exhibits are never downloaded."""
    for attempt in range(4):
        await pace.wait()
        try:
            buf = []
            async with client.stream("GET", f"https://www.sec.gov/Archives/{path}") as r:
                if r.status_code == 429 or r.status_code >= 500:
                    await asyncio.sleep(10 * (attempt + 1))
                    continue
                if r.status_code != 200:
                    return None
                async for chunk in r.aiter_text():
                    buf.append(chunk)
                    if "</DOCUMENT>" in chunk:
                        break
            return "".join(buf)
        except httpx.HTTPError:
            await asyncio.sleep(5 * (attempt + 1))
    return None


async def company(client, pace, cik: int, rows: pd.DataFrame) -> list[dict]:
    out, prev, prev_date = [], None, None
    for date, path in zip(rows["date"], rows["path"]):
        raw = await first_document(client, pace, path)
        if raw is None:
            prev, prev_date = None, None
            continue
        w = words(raw)
        rec = {"cik": cik, "date": date, "words": int(sum(w.values())), "cosine": np.nan,
               "cosine_content": np.nan, "jaccard": np.nan, "new_share": np.nan}
        if prev is not None and 270 <= (pd.Timestamp(date) - pd.Timestamp(prev_date)).days <= 460:
            rec["cosine"], rec["jaccard"] = cosine(w, prev), jaccard(w, prev)
            rec["cosine_content"] = cosine(content(w), content(prev))
            rec["new_share"] = new_share(w, prev)
        out.append(rec)
        prev, prev_date = w, date
    return out


async def collect(symbols: set[str], batch: int = 100) -> dict:
    """Similarities for every company in `symbols`, a batch of companies per
    parquet file in OUT; companies already done are skipped."""
    OUT.mkdir(parents=True, exist_ok=True)
    done = set()
    for f in OUT.glob("*.parquet"):
        done |= set(pd.read_parquet(f, columns=["cik"])["cik"].unique())
    todo = tenk_filings(symbols)
    todo = todo[~todo["cik"].isin(done)]
    ciks = todo["cik"].unique().tolist()
    pace, started, n = Pace(RATE), time.time(), 0
    async with httpx.AsyncClient(headers=UA, timeout=60, follow_redirects=True) as client:
        for i in range(0, len(ciks), batch):
            part = ciks[i:i + batch]
            queue = asyncio.Queue()
            for c in part:
                queue.put_nowait(c)
            results: list[dict] = []

            async def worker():
                while not queue.empty():
                    c = queue.get_nowait()
                    results.extend(await company(client, pace, c, todo[todo["cik"] == c]))

            await asyncio.gather(*[worker() for _ in range(WORKERS)])
            if results:
                pd.DataFrame(results).to_parquet(OUT / f"batch_{int(time.time())}_{i}.parquet")
            n += len(part)
            rate = n / (time.time() - started)
            print(f"[reports] {len(done) + n}/{len(done) + len(ciks)} companies, "
                  f"{(len(ciks) - n) / rate / 60:.0f} min left", flush=True)
    return {"companies": len(done) + n}


async def update(symbols: set[str]) -> dict:
    """After filers.refresh(): companies never read are crawled whole; for
    the rest, each 10-K filed since is read with the one before it."""
    tenk_filings(rebuild=True)
    new = await collect(symbols)
    have = similarities()
    seen = set(zip(have["cik"], have["date"]))
    todo = tenk_filings(symbols)
    pairs = []
    for cik, g in todo.groupby("cik"):
        for i in range(1, len(g)):
            if (cik, g["date"].iloc[i]) not in seen:
                pairs.append((cik, g.iloc[i - 1:i + 1]))
    pace, results = Pace(RATE), []
    async with httpx.AsyncClient(headers=UA, timeout=60, follow_redirects=True) as client:
        sem = asyncio.Semaphore(WORKERS)

        async def one(cik, rows):
            async with sem:
                got = await company(client, pace, cik, rows)
                results.extend(r for r in got if r["date"] == rows["date"].iloc[-1])
        await asyncio.gather(*[one(c, r) for c, r in pairs])
    if results:
        pd.DataFrame(results).to_parquet(OUT / f"update_{int(time.time())}.parquet")
    return {**new, "new_reports": len(results)}


def similarities() -> pd.DataFrame:
    """cik, date (filed), words, cosine, jaccard for every 10-K read."""
    parts = [pd.read_parquet(f) for f in OUT.glob("*.parquet")]
    if not parts:
        return pd.DataFrame()
    df = pd.concat(parts, ignore_index=True)
    return df.sort_values("cosine", na_position="first").drop_duplicates(["cik", "date"], keep="last")


def attach(df: pd.DataFrame) -> pd.DataFrame:
    """Each panel row with the similarity of the company's latest 10-K filed
    in the 15 months up to its date, and the change in the report's length."""
    sims = similarities()
    sims["symbol"] = sims["cik"].map(filers.symbol)
    sims["filed"] = pd.to_datetime(sims["date"])
    sims = sims.sort_values(["symbol", "filed"])
    sims["length_change"] = np.log(sims["words"] / sims.groupby("symbol")["words"].shift(1))
    rows = df.copy()
    rows["when"] = pd.to_datetime(rows["date"])
    merged = pd.merge_asof(rows.sort_values("when"),
                           sims.sort_values("filed")[["symbol", "filed", "cosine", "cosine_content", "jaccard", "new_share", "length_change"]],
                           left_on="when", right_on="filed", by="symbol", direction="backward",
                           tolerance=pd.Timedelta(days=456))
    return merged.drop(columns=["when", "filed"])


def test(horizons: tuple = (1, 3)) -> dict:
    """The paper's comparison on the winner study's universe, dead included:
    on each 30 June, the fifth of companies whose report changed least
    against the fifth that changed most, each against companies of its own
    size, over the next 1 and 3 years. Medians, as in insiders.test: the
    price proxy puts a few +1000% years in any mean."""
    import winners
    df = attach(winners.outcomes(winners.panel_all(), horizons=horizons))
    df["size_tenth"] = df.groupby("date")["log_size"].rank(pct=True).mul(10).apply(np.ceil)
    df["neg_new_share"] = -df["new_share"]       # higher = less changed, like the similarities
    out = {}
    for measure in ("cosine", "cosine_content", "jaccard", "neg_new_share"):
        for h in horizons:
            spreads = []
            for d, g in df[df[measure].notna() & df[f"r{h}"].notna()].groupby("date"):
                if len(g) < 100:
                    continue
                g = g.assign(excess=g[f"r{h}"] - g.groupby("size_tenth")[f"r{h}"].transform("median"))
                fifth = np.ceil(g[measure].rank(pct=True) * 5)
                spreads.append({"date": d, "companies": len(g),
                                "least_changed": float(g["excess"][fifth == 5].median()),
                                "most_changed": float(g["excess"][fifth == 1].median())})
            s = pd.DataFrame(spreads)
            s["spread"] = s["least_changed"] - s["most_changed"]
            early, late = s[s["date"] < "2015"], s[s["date"] >= "2015"]
            out[f"{measure}_{h}y"] = {
                "dates": len(s), "spread_a_year": float(s["spread"].mean()),
                "t": float(s["spread"].mean() / (s["spread"].std(ddof=1) / np.sqrt(len(s)))) if len(s) > 2 else None,
                "years_positive": int((s["spread"] > 0).sum()),
                "before_2015": float(early["spread"].mean()) if len(early) else None,
                "from_2015": float(late["spread"].mean()) if len(late) else None,
                "by_date": s.to_dict("records")}
    return out


if __name__ == "__main__":
    import winners
    universe = set(winners.panel_all()["symbol"])
    print(asyncio.run(collect(universe)), flush=True)
