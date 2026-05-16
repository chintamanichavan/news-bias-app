import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import feedparser

import db
import scraper
import summarize

feedparser.USER_AGENT = "NewsBiasApp/1.0 +https://github.com/news-bias-app"

SOURCES_PATH = Path(__file__).parent / "data" / "sources.json"
REFRESH_INTERVAL = 900  # 15 minutes


def load_sources() -> list[dict]:
    with open(SOURCES_PATH) as f:
        return [s for s in json.load(f) if s.get("active")]


SOURCES = load_sources()
SOURCE_MAP: dict[str, dict] = {s["id"]: s for s in SOURCES}


class _HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data):
        self._parts.append(data)

    def get_text(self) -> str:
        return " ".join(self._parts)


def _strip_html(html: str) -> str:
    s = _HTMLStripper()
    s.feed(html or "")
    return re.sub(r"\s+", " ", s.get_text()).strip()


def _article_id(source_id: str, url: str) -> str:
    return hashlib.sha256(f"{source_id}:{url}".encode()).hexdigest()[:16]


_NOISE_TITLE_TOKENS = (
    # Sports leagues / tournaments
    " nfl", " nba", " mlb", " nhl", " ncaa", "super bowl", "world cup",
    "champions league", "premier league", "la liga", "uefa", "europa league",
    "wrestlemania", "ufc ", " mma ", " atp ", " wta ", " pga ",
    "tour de france", " f1 ", "formula 1", "esports", "valorant",
    "league of legends", " dota", "fifa world",
    # Sports teams / coverage patterns
    "raiders", "cowboys", "patriots", "yankees", "lakers", "warriors",
    "draft pick", "trade rumor", "trade rumour", " mvp ", " roster ",
    # Sport names (generic) — be precise to avoid economy/finance false positives
    " hoops ", " basketball ", " football ", " baseball ", " hockey ",
    " quarterback", " coach ", " head coach", " linebacker",
    "women's hoops", "men's hoops",
    # Celebrity / entertainment / lifestyle
    "kardashian", "taylor swift", "kanye", " drake ", "rihanna", "beyonce",
    "mrbeast", "mr beast", "tiktok", " kpop", "k-pop",
    "red carpet", "celebrity", "oscars", "grammys", "emmys",
    "golden globe", "met gala", "reality tv",
    # Aggregator/roundup posts (low signal-per-click)
    "weekend reads", "weekly reads", "assorted links",
    "what we're reading", "things i ", "10 things",
    "links for ", "links of the day", "morning links",
    # Obituaries / personal notes (these are the marginal_revolution/blog noise)
    ", rip", " rip:", "obituary", "obit:",
    # Schedule / parody / behind-the-scenes filler
    "hilarious", "goes viral", "shocking moment", " parody ",
    "pole-dancing", "pole dancing",
    # Tabloid patterns ("X spotted with Y", action-movie name-drops)
    " spotted ", " spotted with", " spotted at", " spotted pumping",
    "hollywood", "action star", "movie star", "tv star",
)


def _is_low_signal_title(title: str) -> bool:
    """Drop sports, celebrity, lifestyle, roundup, and obit-style RSS noise."""
    if not title:
        return True
    t = f" {title.lower()} "
    return any(tok in t for tok in _NOISE_TITLE_TOKENS)


def _extract_image(entry) -> str | None:
    if hasattr(entry, "media_content") and entry.media_content:
        return entry.media_content[0].get("url")
    if hasattr(entry, "enclosures") and entry.enclosures:
        for enc in entry.enclosures:
            if enc.get("type", "").startswith("image"):
                return enc.get("href") or enc.get("url")
    if hasattr(entry, "links"):
        for link in entry.links:
            if link.get("type", "").startswith("image"):
                return link.get("href")
    return None


def _parse_feed(source: dict) -> list[dict]:
    feed = feedparser.parse(source["rss_url"])
    articles = []
    for entry in feed.entries[:30]:
        url = entry.get("link", "")
        if not url:
            continue
        title = _strip_html(entry.get("title", ""))
        if not title:
            continue
        if _is_low_signal_title(title):
            continue

        body_raw = ""
        if hasattr(entry, "content") and entry.content:
            body_raw = entry.content[0].get("value", "")
        elif hasattr(entry, "summary"):
            body_raw = entry.summary or ""
        body = _strip_html(body_raw)[:3000]

        # RSS feeds use <pubDate>; Atom feeds (Nature, Science Magazine) only
        # have <updated>. Fall back so we don't lose pub dates on Atom sources.
        published = None
        time_struct = (
            (getattr(entry, "published_parsed", None) if hasattr(entry, "published_parsed") else None)
            or (getattr(entry, "updated_parsed", None) if hasattr(entry, "updated_parsed") else None)
        )
        if time_struct:
            try:
                published = datetime(*time_struct[:6], tzinfo=timezone.utc).isoformat()
            except Exception:
                pass

        articles.append({
            "id": _article_id(source["id"], url),
            "source_id": source["id"],
            "title": title,
            "body": body,
            "url": url,
            "image_url": _extract_image(entry),
            "published": published,
        })
    return articles


async def fetch_all_feeds(bias_model=None, sentiment_model=None) -> int:
    total_new = 0
    for source in SOURCES:
        try:
            articles = await asyncio.to_thread(_parse_feed, source)
            conn = db.get_conn()
            for art in articles:
                db.upsert_article(conn, art)
            db.upsert_source_fetch(conn, source["id"], len(articles))
            conn.commit()
            conn.close()
            total_new += len(articles)
        except Exception as e:
            print(f"[feed] Error fetching {source['id']}: {e}")
            try:
                conn = db.get_conn()
                db.upsert_source_fetch(conn, source["id"], 0, error=True)
                conn.commit()
                conn.close()
            except Exception:
                pass

    # Scrape full article text for short-body sources BEFORE scoring/summarizing,
    # so the summarizer has real content to work with.
    await _enrich_short_bodies()

    if (bias_model and bias_model.model is not None) or \
       (sentiment_model and sentiment_model.polarity_clf is not None):
        await _score_unscored_feed(bias_model, sentiment_model)

    conn = db.get_conn()
    _group_stories(conn)
    conn.commit()
    conn.close()
    return total_new


async def _enrich_short_bodies(max_attempts: int = 40):
    """Scrape source URLs for articles whose RSS body is a short teaser.

    Marks every attempt (success or fail) with scrape_attempted_at so we don't
    re-hit a paywalled source on every refresh. Caps work per call so a slow
    publisher can't stall the whole pipeline.
    """
    attempts = 0
    while attempts < max_attempts:
        conn = db.get_conn()
        rows = conn.execute("""
            SELECT id, url, body FROM articles
             WHERE length(coalesce(body, '')) < 300
               AND url IS NOT NULL
               AND (scrape_attempted_at IS NULL
                    OR scrape_attempted_at < datetime('now', '-24 hours'))
             ORDER BY published DESC NULLS LAST
             LIMIT 8
        """).fetchall()
        conn.close()
        if not rows:
            break
        for row in rows:
            text = await scraper.try_extract(row["url"])
            conn = db.get_conn()
            current_len = len(row["body"] or "")
            if text and len(text) > current_len:
                db.replace_article_body(conn, row["id"], text)
            else:
                db.mark_scrape_attempted(conn, row["id"])
            conn.commit()
            conn.close()
            attempts += 1
            if attempts >= max_attempts:
                break
            await asyncio.sleep(0.3)  # be polite to upstream publishers


async def _score_unscored_feed(bias_model, sentiment_model=None):
    """Score articles missing bias OR sentiment scores. Batched writes.

    Picks WHERE clause to match the models we actually have. Critical: if we
    selected on `bias_score IS NULL OR sentiment_score IS NULL` but only one
    model is loaded, articles missing the other score would never get updated
    and the loop would spin forever at 100% CPU.
    """
    has_bias = bool(bias_model and bias_model.model is not None)
    has_sent = bool(sentiment_model and sentiment_model.polarity_clf is not None)
    if not has_bias and not has_sent:
        return

    # Predicate covers bias + sentiment + summary so a freshly-ingested article
    # gets all three filled in one pass.
    where_parts = []
    if has_bias:
        where_parts.append("bias_score IS NULL")
    if has_sent:
        where_parts.append("sentiment_score IS NULL")
    where_parts.append("summary IS NULL")
    where = " OR ".join(where_parts)

    while True:
        conn = db.get_conn()
        rows = conn.execute(
            f"SELECT id, source_id, title, body, bias_score, sentiment_score, summary FROM articles WHERE {where} LIMIT 20"
        ).fetchall()
        conn.close()
        if not rows:
            break
        conn = db.get_conn()
        for row in rows:
            source = SOURCE_MAP.get(row["source_id"], {})
            title = row["title"] or ""
            body = row["body"] or ""

            if has_bias and row["bias_score"] is None:
                score, conf = bias_model.predict(title, body, source.get("allsides_score", 0.0))
                db.update_article_scores(conn, row["id"], score, conf, bias_model.version)

            if has_sent and row["sentiment_score"] is None:
                pol, intensity, breakdown = sentiment_model.predict(title, body)
                db.update_article_sentiment(conn, row["id"], pol, intensity, breakdown,
                                            sentiment_model.version)

            if row["summary"] is None:
                db.update_article_summary(conn, row["id"], summarize.summarize(title, body))
        conn.commit()
        conn.close()
        await asyncio.sleep(0)


def _group_stories(conn):
    from sklearn.feature_extraction.text import TfidfVectorizer
    import numpy as np

    rows = conn.execute(
        "SELECT id, title, body FROM articles WHERE title IS NOT NULL ORDER BY published DESC NULLS LAST LIMIT 500"
    ).fetchall()
    if len(rows) < 2:
        return

    ids = [r["id"] for r in rows]

    def _cluster_text(title: str, body: str | None) -> str:
        # Strip dots so acronyms ("C.I.A." -> "cia", "U.S." -> "us") tokenize as
        # one term and match variants without dots. Title repeated 2x so it
        # outweighs body context, but the full body still contributes shared
        # vocabulary (e.g. "Havana" in body when title only says "Cuba").
        t = (title or "").replace(".", " ")
        b = (body or "").replace(".", " ")
        return f"{t} {t} {b}"

    docs = [_cluster_text(r["title"], r["body"]) for r in rows]

    try:
        vec = TfidfVectorizer(
            max_features=3000, stop_words="english", ngram_range=(1, 2), min_df=2,
        )
        mat = vec.fit_transform(docs)
        sim = (mat @ mat.T).toarray()
    except Exception:
        return

    parent = list(range(len(ids)))
    component_size = [1] * len(ids)
    # Threshold tuned with full body content in the vector. Full bodies push
    # genuine same-story pairs to 0.35-0.70 (CIA Cuba cluster ranged 0.24-0.70)
    # and cap unrelated topic-overlap pairs (e.g. Mamdani-protest vs Hamas-killed)
    # under 0.25.
    SIM_THRESHOLD = 0.32
    MAX_GROUP_SIZE = 10

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            if sim[i][j] > SIM_THRESHOLD:
                ri, rj = find(i), find(j)
                if ri == rj:
                    continue
                if component_size[ri] + component_size[rj] > MAX_GROUP_SIZE:
                    continue
                parent[rj] = ri
                component_size[ri] += component_size[rj]

    from collections import defaultdict
    buckets: dict[int, list[str]] = defaultdict(list)
    for i, aid in enumerate(ids):
        buckets[find(i)].append(aid)

    # A "story" requires multi-outlet coverage. Same-source clusters (e.g. 10
    # unrelated Nature articles sharing house writing style) are TF-IDF
    # artifacts, not stories — drop them.
    id_to_source = {r["id"]: r["source_id"] for r in
                    conn.execute("SELECT id, source_id FROM articles").fetchall()}
    groups = []
    for g in buckets.values():
        if len(g) < 2:
            continue
        if len({id_to_source.get(aid) for aid in g}) < 2:
            continue
        groups.append(g)
    db.save_story_groups(conn, groups)


async def periodic_refresh(bias_model, sentiment_model=None):
    while True:
        await fetch_all_feeds(bias_model, sentiment_model)
        await asyncio.sleep(REFRESH_INTERVAL)
