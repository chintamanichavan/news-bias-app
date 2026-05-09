import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import feedparser

import db

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

        body_raw = ""
        if hasattr(entry, "content") and entry.content:
            body_raw = entry.content[0].get("value", "")
        elif hasattr(entry, "summary"):
            body_raw = entry.summary or ""
        body = _strip_html(body_raw)[:3000]

        published = None
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            try:
                published = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat()
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

    if (bias_model and bias_model.model is not None) or \
       (sentiment_model and sentiment_model.polarity_clf is not None):
        await _score_unscored_feed(bias_model, sentiment_model)

    conn = db.get_conn()
    _group_stories(conn)
    conn.commit()
    conn.close()
    return total_new


async def _score_unscored_feed(bias_model, sentiment_model=None):
    """Score articles missing bias OR sentiment scores. Batched writes."""
    while True:
        conn = db.get_conn()
        rows = conn.execute(
            """SELECT id, source_id, title, body FROM articles
               WHERE bias_score IS NULL OR sentiment_score IS NULL
               LIMIT 20"""
        ).fetchall()
        conn.close()
        if not rows:
            break
        conn = db.get_conn()
        for row in rows:
            source = SOURCE_MAP.get(row["source_id"], {})
            title = row["title"] or ""
            body = row["body"] or ""

            if bias_model and bias_model.model is not None:
                score, conf = bias_model.predict(title, body, source.get("allsides_score", 0.0))
                db.update_article_scores(conn, row["id"], score, conf, bias_model.version)

            if sentiment_model and sentiment_model.polarity_clf is not None:
                pol, intensity, breakdown = sentiment_model.predict(title, body)
                db.update_article_sentiment(conn, row["id"], pol, intensity, breakdown,
                                            sentiment_model.version)
        conn.commit()
        conn.close()
        await asyncio.sleep(0)


def _group_stories(conn):
    from sklearn.feature_extraction.text import TfidfVectorizer
    import numpy as np

    rows = conn.execute(
        "SELECT id, title FROM articles WHERE title IS NOT NULL ORDER BY published DESC NULLS LAST LIMIT 500"
    ).fetchall()
    if len(rows) < 2:
        return

    ids = [r["id"] for r in rows]
    titles = [r["title"] for r in rows]

    try:
        vec = TfidfVectorizer(max_features=1000, stop_words="english", ngram_range=(1, 2))
        mat = vec.fit_transform(titles)
        sim = (mat @ mat.T).toarray()
    except Exception:
        return

    parent = list(range(len(ids)))
    component_size = [1] * len(ids)
    SIM_THRESHOLD = 0.55     # stricter — was 0.35 which transitively merged unrelated stories
    MAX_GROUP_SIZE = 8       # hard cap so a chain of weak similarities can't snowball

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

    groups = [g for g in buckets.values() if len(g) > 1]
    db.save_story_groups(conn, groups)


async def periodic_refresh(bias_model, sentiment_model=None):
    while True:
        await fetch_all_feeds(bias_model, sentiment_model)
        await asyncio.sleep(REFRESH_INTERVAL)
