"""News filters over Artha's own corpus (about 26,000 stories a month from
two dozen outlets): topic screens (ANTN, BBEA, CRPT, CTOP, DTOP, ...),
source screens (NYT, WSJ, WPT), GN (coverage and tone of a company over
time), MMN (news behind the day's biggest movers), NL (news on a
watchlist), TREN (words suddenly in the headlines), NRC (the outlets),
plus two outside feeds: RNS from the SEC's live list of 8-K filings and
TEL from Google News, because the Telegraph blocks automated readers.
"""

import asyncio
import re
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timedelta, timezone

import db

from . import movers, quotes, store, web
from .filings import SEC_HEADERS

TOPICS: dict[str, tuple[str, list[str]]] = {
    "ANTN": ("Antitrust", ["antitrust", "monopoly", "anticompetitive", "anti-competitive", "competition authority", "Federal Trade Commission", "FTC ", "merger review", "Competition and Markets Authority"]),
    "BBEA": ("Earnings, upgrades and downgrades", ["earnings", "quarterly results", "quarterly profit", "beat estimates", "missed estimates", "upgrade", "downgrade", "price target", "guidance"]),
    "BBSE": ("World economy", ["inflation", "GDP", "jobs report", "unemployment", "payrolls", "central bank", "interest rate", "recession", "economy", "tariff"]),
    "TECO": ("Top economic news", ["inflation", "GDP", "jobs report", "unemployment", "payrolls", "Federal Reserve", "interest rates", "recession", "consumer prices", "retail sales"]),
    "BSP": ("Sport", ["NFL", "NBA", "MLB", "NHL", "Premier League", "World Cup", "Olympic", "tennis", "golf", "cricket", "Super Bowl", "championship"]),
    "CRPT": ("Corporate bonds and credit", ["bond sale", "bond offering", "corporate bonds", "credit rating", "junk bond", "high-yield", "credit spreads", "Moody's", "S&P Global Ratings", "Fitch", "debt offering", "private credit"]),
    "CTOP": ("Commodities", ["crude", "oil price", "OPEC", "gold price", "copper", "wheat", "natural gas", "commodit", "soybean", "iron ore", "lithium"]),
    "DTOP": ("Deals", ["merger", "acquisition", "acquire", "takeover", "buyout", "to buy", "deal valued", "IPO", "initial public offering", "spin off", "spinoff"]),
    "ENRG": ("Energy", ["energy", "oil", "natural gas", "electricity", "power grid", "renewable", "solar", "wind power", "nuclear", "LNG", "OPEC"]),
    "MNPL": ("Municipal finance", ["municipal bond", "muni bond", "city budget", "state budget", "bond measure", "tax revenue", "pension fund", "public pension"]),
    "MUSE": ("Arts and culture", ["museum", "film", "album", "theatre", "theater", "novel", "exhibition", "artist", "Broadway", "box office", "festival"]),
    "RTOP": ("Retail", ["retail", "retailer", "shoppers", "store closures", "Walmart", "Target", "Costco", "consumer spending", "e-commerce", "holiday sales"]),
    "TOPCA": ("Canada", ["Canada", "Canadian", "Ottawa", "Toronto", "Carney", "Bank of Canada", "Alberta", "Quebec", "Ontario"]),
    "TOPE": ("Europe", ["Europe", "European", "EU ", "Brussels", "eurozone", "ECB", "Germany", "France", "Italy", "Spain", "Britain", "UK "]),
    "TOPR": ("Real estate", ["real estate", "housing market", "home prices", "mortgage rates", "commercial property", "office market", "REIT", "rents", "homebuyers"]),
}

SOURCES: dict[str, tuple[str, list[str]]] = {
    "NYT": ("The New York Times", ["nyt"]), "WSJ": ("The Wall Street Journal (markets)", ["wsj_markets"]), "WPT": ("The Washington Post", ["wapo"]),
}

STOP = set("""a an and are as at be by for from has have he her his in is it its of on or our she that the their they this to was were
will with not but after over into than who what when where why how new more out up down says say said could would about amid
just also can may first last one two us u.s. you your we vs year years day week report live latest video watch""".split())


def _query(where: str, params: list, days: int, limit: int) -> list[dict]:
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT id, title, url, published, source_id, sentiment_score FROM articles "
            f"WHERE ({where}) AND datetime(published) > datetime('now', ?) ORDER BY datetime(published) DESC LIMIT ?",
            [*params, f"-{int(days)} days", int(limit)]).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _like(word: str) -> str:
    return "%" + word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def any_of(words: list[str], days: int = 7, limit: int = 80) -> list[dict]:
    """Stories whose title or summary contains any of the phrases."""
    cond = " OR ".join(["title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\'"] * len(words))
    params: list = []
    for w in words:
        params += [_like(w), _like(w)]
    return _query(cond, params, days, limit)


def by_source(source_ids: list[str], days: int = 3, limit: int = 80) -> list[dict]:
    return _query(" OR ".join(["source_id = ?"] * len(source_ids)), list(source_ids), days, limit)


def topic(code: str, extra: str | None) -> dict:
    title, words = TOPICS[code]
    if extra:                      # a subject narrows the topic: ENRG solar
        stories = [s for s in any_of(words, 14, 400) if extra.lower() in (s["title"] or "").lower()][:80]
        title = f"{title}: {extra}"
    else:
        stories = any_of(words)
    return {"title": title, "stories": stories, "words": words}


def source(code: str) -> dict:
    name, ids = SOURCES[code]
    return {"title": name, "stories": by_source(ids)}


def coverage(name_words: list[str], days: int = 90) -> dict:
    """GN: stories a day naming the company, and their average tone."""
    stories = any_of(name_words, days, 5000)
    per: dict[str, list[float]] = {}
    for s in stories:
        d = (s["published"] or "")[:10]
        if d:
            per.setdefault(d, []).append(s["sentiment_score"] if s["sentiment_score"] is not None else float("nan"))
    rows = []
    for d in sorted(per):
        tones = [x for x in per[d] if x == x]
        rows.append({"date": d, "stories": len(per[d]), "tone": sum(tones) / len(tones) if tones else None})
    return {"days": rows, "stories": stories[:40], "total": len(stories)}


def terms(titles: list[str]) -> Counter:
    """Words and two-word phrases in headlines, stop words left out."""
    c: Counter = Counter()
    for t in titles:
        words = [w for w in re.findall(r"[a-z][a-z'\-]+", (t or "").lower()) if w not in STOP and len(w) > 2]
        c.update(set(words))
        c.update({f"{a} {b}" for a, b in zip(words, words[1:])})
    return c


def trends(now: Counter, before: Counter, now_n: int, before_n: int, top: int = 40) -> list[dict]:
    """Terms far more common in recent headlines than in the weeks before,
    by the ratio of their shares (smoothed so rare words cannot top it)."""
    out = []
    for term, n in now.items():
        if n < 5:
            continue
        rate_now = n / now_n
        rate_before = (before.get(term, 0) + 1) / (before_n + 1)
        out.append({"term": term, "count": n, "before_per_day": before.get(term, 0) / 14, "lift": rate_now / rate_before})
    out.sort(key=lambda x: -x["lift"])
    # drop a single word when a phrase containing it is already listed above it
    kept: list[dict] = []
    for x in out:
        if " " not in x["term"] and any(x["term"] in k["term"].split() for k in kept):
            continue
        kept.append(x)
    return kept[:top]


def news_trends() -> dict:
    recent = _query("1=1", [], 1, 5000)
    conn = db.get_conn()
    try:
        older = [dict(r) for r in conn.execute(
            "SELECT title FROM articles WHERE datetime(published) BETWEEN datetime('now','-15 days') AND datetime('now','-1 days')").fetchall()]
    finally:
        conn.close()
    rows = trends(terms([s["title"] for s in recent]), terms([s["title"] for s in older]), len(recent) or 1, len(older) or 1)
    for r in rows:
        r["examples"] = [s["title"] for s in recent if r["term"] in (s["title"] or "").lower()][:3]
    return {"stories_today": len(recent), "stories_before": len(older), "terms": rows}


def outlets() -> dict:
    conn = db.get_conn()
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT source_id, count(*) AS stories, avg(sentiment_score) AS tone, max(published) AS latest FROM articles "
            "WHERE datetime(published) > datetime('now','-30 days') GROUP BY source_id ORDER BY stories DESC").fetchall()]
    finally:
        conn.close()
    return {"outlets": rows}


def _name_words(name: str | None, symbol: str) -> list[str]:
    """Ways a company is named in headlines: its short name without the
    legal suffix, and its ticker when that is not an ordinary word."""
    words = []
    if name:
        base = re.sub(r"[,.]|\b(Inc|Corp|Corporation|Company|Co|Ltd|plc|Holdings|Group|Class [AB]|The)\b", "", name).strip()
        if len(base) >= 3:
            words.append(base.split("  ")[0].strip())
    if len(symbol) >= 3 and symbol.isalpha():
        words.append(f"({symbol})")
    return words or [symbol]


async def company_coverage(symbol: str) -> dict:
    q = (await quotes.quotes([symbol])).get(symbol, {})
    words = _name_words(q.get("name"), symbol)
    return {"symbol": symbol, "name": q.get("name"), "words": words, **coverage(words)}


async def movers_news() -> dict:
    async with web.client() as c:
        up, down = await asyncio.gather(movers._screen(c, "day_gainers", 10), movers._screen(c, "day_losers", 10))
    rows = []
    for m in [*up, *down]:
        words = _name_words(m.get("name"), m["symbol"])
        rows.append({**{k: m.get(k) for k in ("symbol", "name", "price", "change_pct")}, "stories": any_of(words, 3, 5)})
    return {"rows": rows}


async def watchlist_news(name: str | None) -> dict:
    lists = store.lists()
    chosen = next((w["name"] for w in lists if w["name"].lower() == (name or "").lower()), lists[0]["name"] if lists else None)
    if not chosen:
        return {"list": None, "rows": []}
    symbols = store.members(chosen)[:30]
    got = await quotes.quotes(symbols)
    rows = []
    for s in symbols:
        words = _name_words(got.get(s, {}).get("name"), s)
        rows.append({"symbol": s, "name": got.get(s, {}).get("name"), "stories": any_of(words, 7, 5)})
    return {"list": chosen, "lists": [w["name"] for w in lists], "rows": rows}


def parse_atom(xml: str) -> list[dict]:
    ns = {"a": "http://www.w3.org/2005/Atom"}
    root = ET.fromstring(xml)
    out = []
    for e in root.findall("a:entry", ns):
        title = (e.findtext("a:title", default="", namespaces=ns) or "").strip()
        m = re.match(r"(?P<form>[^ ]+) - (?P<company>.*) \((?P<cik>\d+)\) \((?P<role>[^)]+)\)", title)
        link = e.find("a:link", ns)
        summary = re.sub(r"<[^>]+>", " ", e.findtext("a:summary", default="", namespaces=ns) or "")
        out.append({"form": m["form"] if m else None, "company": m["company"] if m else title, "cik": m["cik"] if m else None,
                    "role": m["role"] if m else None, "updated": e.findtext("a:updated", default="", namespaces=ns),
                    "url": link.get("href") if link is not None else None,
                    "items": re.findall(r"Item (\d\.\d\d)", summary)})
    return out


ITEMS = {"1.01": "Material agreement", "1.02": "Agreement ended", "1.03": "Bankruptcy", "2.01": "Acquisition or sale completed",
         "2.02": "Results", "2.03": "New debt", "2.05": "Restructuring costs", "2.06": "Impairment", "3.01": "Delisting notice",
         "3.02": "Unregistered share sale", "3.03": "Rights changed", "4.01": "Auditor changed", "4.02": "Non-reliance on past statements",
         "5.01": "Change of control", "5.02": "Officers or directors changed", "5.03": "Bylaws changed", "5.07": "Shareholder vote",
         "7.01": "Regulation FD disclosure", "8.01": "Other events", "9.01": "Financial statements and exhibits"}


async def regulatory() -> dict:
    async def make():
        async with web.client() as c:
            r = await c.get("https://www.sec.gov/cgi-bin/browse-edgar", params={"action": "getcurrent", "type": "8-K", "output": "atom", "count": 100},
                            headers=SEC_HEADERS)
            r.raise_for_status()
            rows = parse_atom(r.text)
        for x in rows:
            x["item_names"] = [ITEMS.get(i, i) for i in x["items"] if i != "9.01"]
        return {"rows": [x for x in rows if x["role"] != "Filed by"]}
    return await web.cached("rns", 120, make)


async def telegraph() -> dict:
    async def make():
        async with web.client() as c:
            r = await c.get("https://news.google.com/rss/search", params={"q": "site:telegraph.co.uk when:2d", "hl": "en-GB", "gl": "GB", "ceid": "GB:en"})
            r.raise_for_status()
        root = ET.fromstring(r.text)
        out = []
        for it in root.iter("item"):
            title = (it.findtext("title") or "").removesuffix(" - The Telegraph")
            out.append({"id": it.findtext("link"), "title": title, "url": it.findtext("link"), "published": it.findtext("pubDate"), "source_id": "telegraph"})
        return {"title": "The Daily Telegraph (through Google News)", "stories": out}
    return await web.cached("telegraph", 600, make)
