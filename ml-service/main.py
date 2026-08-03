import asyncio
import json
import re
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import db
import divergence
import feed_manager
import retrain
import signal_manager
# The per-article bias model is retired. Its label was the publishing outlet's
# AllSides rating, and `source_prior` fed that same rating in as a feature — so
# the "prediction" was a lookup: source_prior alone scored 1.000 accuracy, and
# every Fox article landed within +/-0.05 of Fox's published rating. Text alone
# scored 0.588 on held-out outlets against a 0.833 majority baseline, and two
# pretrained article-level transformers both turned out to detect which
# politicians an article names rather than how it frames them. Outlet lean is
# now presented as what it always was: an attribute of the publisher.
from sentiment_model import SentimentModel

sentiment_model = SentimentModel()


async def _background_startup():
    # Signals (Polymarket) are independent of feeds + ML models — run in parallel
    # so a hang or slow bootstrap in the feed pipeline doesn't starve the
    # homepage signals section.
    async def _signals_init():
        try:
            await signal_manager.poll_polymarket()
        except Exception as e:
            print(f"[startup] initial signals poll failed: {e}")
        asyncio.create_task(signal_manager.periodic_refresh())

    async def _feeds_and_models():
        # Each step is isolated so a failure (e.g. sentiment bootstrap can't
        # train on single-class data) doesn't stop later steps — particularly
        # registering periodic_refresh, without which feeds stop refreshing.
        async def _step(name: str, coro):
            try:
                await coro
            except Exception as e:
                print(f"[startup] {name} failed: {e!r}")

        await _step("fetch_all_feeds", feed_manager.fetch_all_feeds(sentiment_model))
        await _step("sentiment_bootstrap", retrain.run_sentiment_bootstrap(sentiment_model))
        await _step("score_unscored_feed", feed_manager._score_unscored_feed(sentiment_model))
        asyncio.create_task(feed_manager.periodic_refresh(sentiment_model))

    await asyncio.gather(_signals_init(), _feeds_and_models())


def _cleanup_orphaned_articles():
    """Delete articles whose source has been removed from sources.json entirely.

    Deliberately keyed on *known* ids rather than *active* ones. Toggling
    `"active": false` is an editorial decision that should be reversible —
    keying this on the active set meant flipping one flag silently and
    permanently destroyed every article that source had ever contributed
    (887 rows the first time it happened here). An id disappearing from the
    file altogether is the only unambiguous "this source is retired" signal.
    """
    known_ids = {s["id"] for s in feed_manager.ALL_SOURCES}
    if not known_ids:
        return
    placeholders = ",".join("?" * len(known_ids))
    params = list(known_ids)
    conn = db.get_conn()
    doomed = conn.execute(
        f"SELECT COUNT(*) FROM articles WHERE source_id NOT IN ({placeholders})",
        params,
    ).fetchone()[0]
    # A config typo shouldn't be able to wipe the corpus in one boot.
    total = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    if total and doomed > total * 0.5:
        print(
            f"[startup] REFUSING cleanup: {doomed}/{total} articles have no source "
            f"in sources.json. Check the file before restarting."
        )
        conn.close()
        return
    conn.execute(
        f"DELETE FROM articles WHERE source_id NOT IN ({placeholders})", params
    )
    conn.execute(
        f"DELETE FROM source_fetches WHERE source_id NOT IN ({placeholders})", params
    )
    conn.commit()
    conn.close()
    if doomed > 0:
        print(f"[startup] Cleaned up {doomed} orphaned articles")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    _cleanup_orphaned_articles()
    sentiment_model.load_latest()
    asyncio.create_task(_background_startup())
    yield


app = FastAPI(title="ClearLens ML Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4321", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ──────────────────────────────────────────────────────────────────

class FeedbackIn(BaseModel):
    article_id: str
    predicted_score: float = Field(..., ge=-5, le=5)
    user_score: float = Field(..., ge=-5, le=5)
    feedback_type: str = Field(..., pattern="^(thumbs_up|thumbs_down|slider)$")
    dimension: str = Field("bias", pattern="^(bias|sentiment|intensity)$")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _enrich(article: dict) -> dict:
    # Strip internal columns that shouldn't leak to the API
    article.pop("_rn", None)
    src = feed_manager.SOURCE_MAP.get(article["source_id"], {})
    article["source"] = {
        "id": article["source_id"],
        "name": src.get("name", article["source_id"]),
        "category": src.get("category", "general"),
        "topic": src.get("topic"),
        "allsides_score": src.get("allsides_score", 0.0),
        "allsides_label": src.get("allsides_label", "center"),
    }
    # Parse emotion_breakdown JSON if present
    breakdown_raw = article.get("emotion_breakdown")
    if breakdown_raw:
        try:
            article["emotion_breakdown"] = json.loads(breakdown_raw)
        except (TypeError, json.JSONDecodeError):
            article["emotion_breakdown"] = None
    else:
        article["emotion_breakdown"] = None
    return article


_TITLE_NORM_RE = re.compile(r"[^a-z0-9\s]")
_WS_RE = re.compile(r"\s+")


def _norm_title(t: str | None) -> str:
    if not t:
        return ""
    return _WS_RE.sub(" ", _TITLE_NORM_RE.sub(" ", t.lower())).strip()


def _dedupe(articles: list[dict]) -> list[dict]:
    """Drop near-duplicate articles (same source republishing the same headline
    under different URLs — e.g. Foreign Policy + Foreign Affairs sometimes
    publish an essay at two slugs).

    Keys on (source_id, normalized_title). Among duplicates, prefer the entry
    with the longer body, then the most recent published timestamp.
    """
    best: dict[tuple[str, str], dict] = {}
    for a in articles:
        key = (a.get("source_id") or "", _norm_title(a.get("title")))
        if not key[1]:
            # No title to dedupe on — keep as-is, key by id so each survives.
            best[(a.get("source_id") or "", a.get("id") or str(id(a)))] = a
            continue
        prev = best.get(key)
        if prev is None:
            best[key] = a
            continue
        body_new = len(a.get("body") or "")
        body_old = len(prev.get("body") or "")
        if body_new > body_old:
            best[key] = a
        elif body_new == body_old and (a.get("published") or "") > (prev.get("published") or ""):
            best[key] = a
    return list(best.values())


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    conn = db.get_conn()
    signals_meta = db.get_signals_meta(conn)
    conn.close()
    return {
        "status": "ok",
        "sentiment_model_version": sentiment_model.version,
        "signals": signals_meta,
    }


@app.get("/signals")
def list_signals(
    category: Optional[str] = None,
    sort: str = Query("movers", pattern="^(movers|volume|expiry)$"),
    limit: int = Query(60, ge=1, le=200),
):
    conn = db.get_conn()
    signals = db.get_signals(conn, category=category, sort=sort, limit=limit)
    counts = db.get_signal_categories(conn)
    meta = db.get_signals_meta(conn)
    conn.close()
    return {
        "signals": signals,
        "categories": counts,
        "last_updated": meta["last_updated"],
        "total": meta["count"],
    }


@app.post("/signals/refresh")
async def refresh_signals():
    count = await signal_manager.poll_polymarket()
    return {"upserted": count}


@app.get("/articles")
def list_articles(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    source_id: Optional[str] = None,
    category: Optional[str] = None,
    lookback_hours: Optional[int] = Query(None, ge=1, le=24 * 30),
    include_all: bool = False,
):
    conn = db.get_conn()

    # Default curation: aggressive by design — opt in to the firehose with
    # include_all=true and lookback_hours unset.
    #   - no category, no source picked: ESSENTIAL_SOURCES, 24h, 5/source.
    #   - category picked: that category's sources, 24h, 5/source.
    #   - specific source picked: all-time for that source, no cap (you asked for it).
    source_ids: list[str] | None = None
    per_source_cap: int | None = None
    if source_id:
        pass  # honour explicit single-source view fully
    elif category:
        source_ids = [s["id"] for s in feed_manager.SOURCES if s.get("category") == category]
        if lookback_hours is None:
            lookback_hours = 24
        per_source_cap = 5
    elif not include_all:
        source_ids = sorted(db.ESSENTIAL_SOURCES)
        if lookback_hours is None:
            lookback_hours = 24
        per_source_cap = 5

    total, articles = db.get_articles(
        conn, page, per_page,
        source_id=source_id,
        source_ids=source_ids,
        lookback_hours=lookback_hours,
        per_source_cap=per_source_cap,
    )

    conn.close()
    enriched = [_enrich(a) for a in articles]
    deduped = _dedupe(enriched)
    return {
        "articles": deduped,
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@app.get("/articles/{article_id}")
def get_article(article_id: str):
    conn = db.get_conn()
    article = db.get_article(conn, article_id)
    conn.close()
    if not article:
        raise HTTPException(404, "Article not found")
    return _enrich(article)


@app.get("/articles/{article_id}/related")
def get_related(article_id: str, limit: int = Query(6, ge=1, le=20)):
    """Return:
      - same_story: other articles in the same story_group (cross-outlet coverage)
      - more_from_source: recent articles from the same publication
    Used by the article-reader "Read next" block + channel pages.
    """
    conn = db.get_conn()
    article = db.get_article(conn, article_id)
    if not article:
        conn.close()
        raise HTTPException(404, "Article not found")

    source_id = article["source_id"]

    # Cross-source coverage via story_groups
    same_story: list[dict] = []
    group_row = conn.execute(
        "SELECT article_ids FROM story_groups WHERE article_ids LIKE ?",
        (f'%"{article_id}"%',),
    ).fetchone()
    if group_row:
        try:
            ids = [aid for aid in json.loads(group_row["article_ids"]) if aid != article_id]
        except (TypeError, json.JSONDecodeError):
            ids = []
        if ids:
            placeholders = ",".join("?" * len(ids))
            rows = conn.execute(
                f"SELECT * FROM articles WHERE id IN ({placeholders}) ORDER BY published DESC NULLS LAST",
                ids,
            ).fetchall()
            same_story = [_enrich(dict(r)) for r in rows]

    # More from this publication, newest first, excluding the current article
    rows = conn.execute(
        "SELECT * FROM articles WHERE source_id = ? AND id != ? ORDER BY published DESC NULLS LAST LIMIT ?",
        (source_id, article_id, limit),
    ).fetchall()
    more_from_source = [_enrich(dict(r)) for r in rows]

    conn.close()
    return {
        "same_story": same_story[:limit],
        "more_from_source": more_from_source[:limit],
    }


@app.get("/channels/{source_id}")
def get_channel(source_id: str, limit: int = Query(30, ge=1, le=100)):
    """Channel destination page payload — publication metadata + recent articles."""
    src = feed_manager.SOURCE_MAP.get(source_id)
    if not src:
        raise HTTPException(404, "Channel not found")

    conn = db.get_conn()
    total = conn.execute(
        "SELECT COUNT(*) FROM articles WHERE source_id = ?", (source_id,),
    ).fetchone()[0]
    rows = conn.execute(
        "SELECT * FROM articles WHERE source_id = ? ORDER BY published DESC NULLS LAST LIMIT ?",
        (source_id, limit),
    ).fetchall()
    articles = [_enrich(dict(r)) for r in rows]
    conn.close()

    return {
        "source": {
            "id": src["id"],
            "name": src["name"],
            "category": src.get("category"),
            "topic": src.get("topic"),
            "allsides_score": src.get("allsides_score", 0.0),
            "allsides_label": src.get("allsides_label", "center"),
        },
        "total": total,
        "articles": articles,
    }


@app.get("/sources")
def list_sources():
    conn = db.get_conn()
    fetches = {r["source_id"]: dict(r) for r in
               conn.execute("SELECT * FROM source_fetches").fetchall()}
    conn.close()
    return [
        {**s, "fetch_stats": fetches.get(s["id"], {})}
        for s in feed_manager.SOURCES
    ]


@app.post("/feeds/refresh")
async def refresh_feeds():
    count = await feed_manager.fetch_all_feeds(sentiment_model)
    return {"articles_fetched": count}


@app.post("/feedback")
async def submit_feedback(body: FeedbackIn):
    conn = db.get_conn()
    article = db.get_article(conn, body.article_id)
    if not article:
        conn.close()
        raise HTTPException(404, "Article not found")

    db.insert_feedback(conn, body.article_id, body.predicted_score,
                       body.user_score, body.feedback_type, body.dimension)

    # Bias feedback is still collected, and deliberately so: a human rating a
    # specific article is the article-level label the retired model never had.
    # Nothing trains on it yet — a handful of ratings would only reproduce the
    # old problem with a smaller sample — so it accumulates until there is
    # enough to be worth a model.
    if body.dimension == "bias":
        since = db.count_feedback_since_last_retrain(conn)
        conn.close()
        return {
            "accepted": True,
            "dimension": "bias",
            "feedback_count_since_retrain": since,
            "retrain_triggered": False,
            "note": "Stored as an article-level label. No bias model is trained from it yet.",
        }

    since = db.count_sentiment_feedback_since_last_retrain(conn)
    conn.close()

    retrain_triggered = since >= retrain.SENTIMENT_RETRAIN_THRESHOLD
    await retrain.check_and_retrain_sentiment(sentiment_model)

    return {
        "accepted": True,
        "dimension": body.dimension,
        "feedback_count_since_retrain": since,
        "retrain_triggered": retrain_triggered,
    }


CROSS_REF_KEYWORDS = [
    "iran", "russia", "ukraine", "putin", "zelensky", "china", "taiwan",
    "israel", "gaza", "hamas", "hezbollah", "north korea", "houthi",
    # Event nouns, not just actors — Polymarket phrases its geopolitics
    # contracts around the event ("… ceasefire continues through …"), so a
    # headline that names the event but not the country can still match.
    "ceasefire", "nato", "blockade",
    "fed", "powell", "rate", "cpi", "inflation", "recession",
    "bitcoin", "ethereum", "crypto", "tether",
    "trump", "biden", "harris", "musk", "election",
    "oil", "opec", "wti", "gold", "copper",
]


def _unresolved(signals: list[dict]) -> list[dict]:
    """Keep only contracts that have not reached their end_date.

    A settled market is a fact, not an expectation, and the refresh job can lag
    a day behind — without this the UI happily shows yesterday's resolved odds
    as a live signal.

    Rows with no end_date are kept: Polymarket leaves it null on open-ended
    markets, and dropping those would silently hide live questions.
    """
    now = datetime.now(timezone.utc)
    out = []
    for s in signals:
        end = s.get("end_date")
        if not end:
            out.append(s)
            continue
        try:
            stamp = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
            # Polymarket sometimes stores a stamp with no offset; comparing that
            # to an aware `now` raises TypeError, which would 500 both /top and
            # /analytics for a single bad row.
            if stamp.tzinfo is None:
                stamp = stamp.replace(tzinfo=timezone.utc)
            if stamp > now:
                out.append(s)
        except (ValueError, TypeError):
            out.append(s)  # unparseable stamp — better shown than swallowed
    return out


def _cross_ref_signal(title: str, signals: list[dict]) -> dict | None:
    """If the article title shares a key term with a moving Polymarket market,
    attach that signal as 'market_signal'. Only flag markets that moved >3pts."""
    title_l = title.lower()
    title_keys = {k for k in CROSS_REF_KEYWORDS if k in title_l}
    if not title_keys:
        return None
    best = None
    best_change = 0.03
    for sig in signals:
        change = abs(sig.get("yes_change_24h") or 0)
        if change <= best_change:
            continue
        q_l = (sig.get("question") or "").lower()
        if any(k in q_l for k in title_keys):
            best = sig
            best_change = change
    if not best:
        return None
    return {
        "question": best["question"],
        "yes_price": best["yes_price"],
        "yes_change_24h": best["yes_change_24h"],
        "url": best.get("url"),
        "category": best.get("category"),
    }


@app.get("/top")
def top_stories(limit: int = Query(12, ge=1, le=30)):
    conn = db.get_conn()
    # Over-fetch so post-filter still hits the requested limit
    stories = db.get_top_stories(conn, limit=limit * 3, lookback_hours=36)
    signals = _unresolved(db.get_signals(conn, sort="movers", limit=120))
    conn.close()

    stories = [s for s in stories if not feed_manager._is_low_signal_title(s.get("title") or "")][:limit]

    out = []
    for s in stories:
        s = _enrich(s)
        # Build coverage info
        member_ids = s.pop("_group_members", []) or []
        member_sources: list[str] = []
        member_source_ids: list[str] = []
        if member_ids and len(member_ids) > 1:
            conn2 = db.get_conn()
            placeholders = ",".join("?" * len(member_ids))
            rows = conn2.execute(
                f"SELECT DISTINCT source_id FROM articles WHERE id IN ({placeholders})",
                member_ids,
            ).fetchall()
            conn2.close()
            for r in rows:
                member_source_ids.append(r["source_id"])
                src = feed_manager.SOURCE_MAP.get(r["source_id"], {})
                if src.get("name"):
                    member_sources.append(src["name"])
        s["coverage"] = {
            "count": s.pop("_group_size", 1),
            "sources": sorted(set(member_sources)),
            # Political spread of the outlets covering it — lets the story cards
            # show the same left/centre/right bar the /stories clusters use.
            "spread": _spread_of(member_source_ids or [s["source_id"]]),
        }
        s.pop("_group_id", None)
        s.pop("_score", None)
        # Polymarket cross-reference
        s["market_signal"] = _cross_ref_signal(s["title"], signals)
        out.append(s)
    return {"stories": _dedupe(out)}


# ── Blindspot ───────────────────────────────────────────────────────────────
# Ground-News-style: a story is a "Left Blindspot" if right-leaning outlets
# dominate coverage (people on the left aren't seeing it), and vice versa.

_LEFT_LABELS  = {"far_left", "left", "lean_left"}
_RIGHT_LABELS = {"lean_right", "right", "far_right"}
MIN_OUTLETS_FOR_BLINDSPOT = 4
BLINDSPOT_SKEW_THRESHOLD = 0.70


def _compute_blindspot(articles: list[dict]) -> dict:
    """One vote per distinct outlet — multiple articles from the same source don't double-count."""
    seen: dict[str, str] = {}
    for a in articles:
        sid = a["source"]["id"]
        if sid in seen:
            continue
        lab = a["source"].get("allsides_label", "center")
        if   lab in _LEFT_LABELS:  seen[sid] = "left"
        elif lab in _RIGHT_LABELS: seen[sid] = "right"
        else:                      seen[sid] = "center"

    left   = sum(1 for v in seen.values() if v == "left")
    right  = sum(1 for v in seen.values() if v == "right")
    center = sum(1 for v in seen.values() if v == "center")
    total  = left + center + right
    partisan = left + right

    direction: Optional[str] = None
    skew = 0.0
    if total >= MIN_OUTLETS_FOR_BLINDSPOT and partisan > 0:
        right_share = right / partisan
        left_share  = left  / partisan
        if right_share >= BLINDSPOT_SKEW_THRESHOLD:
            direction, skew = "left", right_share
        elif left_share >= BLINDSPOT_SKEW_THRESHOLD:
            direction, skew = "right", left_share

    return {
        "total": total, "left": left, "center": center, "right": right,
        "direction": direction, "skew": skew,
    }


@app.get("/stories")
def list_stories(
    blindspot: Optional[str] = Query(None, pattern="^(all|left|right)$"),
    min_outlets: int = Query(MIN_OUTLETS_FOR_BLINDSPOT, ge=2, le=20),
):
    conn = db.get_conn()
    groups = db.get_story_groups(conn)
    conn.close()

    out = []
    for g in groups:
        articles = [_enrich(a) for a in g["articles"]]
        bs = _compute_blindspot(articles)
        if blindspot in ("left", "right"):
            if bs["direction"] != blindspot or bs["total"] < min_outlets:
                continue
        out.append({"group_id": g["group_id"], "articles": articles, "blindspot": bs})

    if blindspot in ("left", "right"):
        out.sort(key=lambda x: x["blindspot"]["skew"], reverse=True)
    return {"groups": out}


@app.get("/stats")
def get_stats():
    conn = db.get_conn()
    stats = db.get_stats(conn)
    conn.close()
    return stats


# ── Analytics ────────────────────────────────────────────────────────────────
# One payload behind the /insights dashboard. db.get_analytics does the SQL
# rollups; this layer joins publication metadata and folds in the model, signal
# and blindspot numbers that already exist elsewhere in the API.

def _lean_of(source_id: str) -> str:
    label = feed_manager.SOURCE_MAP.get(source_id, {}).get("allsides_label", "center")
    if label in _LEFT_LABELS:
        return "left"
    if label in _RIGHT_LABELS:
        return "right"
    return "center"


def _spread_of(source_ids: list[str]) -> dict:
    """One vote per distinct outlet, matching _compute_blindspot's rule."""
    leans = [_lean_of(sid) for sid in dict.fromkeys(source_ids)]
    left = leans.count("left")
    right = leans.count("right")
    center = leans.count("center")
    total = left + center + right
    partisan = left + right
    direction: Optional[str] = None
    skew = 0.0
    if total >= MIN_OUTLETS_FOR_BLINDSPOT and partisan > 0:
        right_share, left_share = right / partisan, left / partisan
        if right_share >= BLINDSPOT_SKEW_THRESHOLD:
            direction, skew = "left", right_share
        elif left_share >= BLINDSPOT_SKEW_THRESHOLD:
            direction, skew = "right", left_share
    return {
        "total": total, "left": left, "center": center, "right": right,
        "direction": direction, "skew": round(skew, 4),
    }


# Full-corpus rollup: a dozen GROUP BYs plus per-row bucketing. Cheap at a few
# thousand articles, linear in corpus size, and the underlying data only moves
# when the 15-minute refresh lands — so serve a short-lived snapshot rather than
# recomputing per request.
_ANALYTICS_TTL_SECONDS = 90
_analytics_cache: dict[tuple, tuple[float, dict]] = {}


@app.get("/analytics")
def get_analytics(
    window_hours: int = Query(24, ge=1, le=24 * 7),
    trend_days: int = Query(14, ge=2, le=90),
    top_groups: int = Query(8, ge=1, le=30),
):
    key = (window_hours, trend_days, top_groups)
    hit = _analytics_cache.get(key)
    if hit and time.time() - hit[0] < _ANALYTICS_TTL_SECONDS:
        return hit[1]

    conn = db.get_conn()
    data = db.get_analytics(conn, window_hours=window_hours, trend_days=trend_days)
    model_stats = db.get_stats(conn)
    # Over-fetch, then drop contracts whose end_date has passed: a settled market
    # is a fact, not an expectation, and the refresh job can lag a day behind.
    signals = _unresolved(db.get_signals(conn, sort="movers", limit=60))[:12]
    signals_by_volume = _unresolved(db.get_signals(conn, sort="volume", limit=40))[:6]
    signals_meta = db.get_signals_meta(conn)
    live_signals = _unresolved(db.get_signals(conn, sort="volume", limit=10_000))
    live_signal_count = len(live_signals)
    divergence_articles = [
        dict(r)
        for r in conn.execute(
            f"""SELECT id, source_id, title, summary, sentiment_score
                  FROM articles
                 WHERE datetime(published) > datetime('now', '-{int(trend_days)} days')"""
        ).fetchall()
    ]
    signal_categories = db.get_signal_categories(conn)
    conn.close()

    # ── Outlets: join publication metadata ──────────────────────────────────
    # Keyed off the configured active set, not off rows in `articles`: a feed
    # that 404s on every refresh has no articles, so an article-derived list
    # left it invisible while the UI reported "all fetching cleanly".
    by_source = {row["source_id"]: row for row in data["outlets"]}
    fetch_rows = data.get("source_fetches", {})
    orphaned_articles = sum(
        row["articles"] for sid, row in by_source.items()
        if sid not in feed_manager.SOURCE_MAP
    )
    outlets = []
    for source_id, src in feed_manager.SOURCE_MAP.items():
        row = by_source.get(source_id) or {
            "source_id": source_id,
            "articles": 0, "articles_window": 0, "full_text": 0,
            "mean_tone": None, "mean_intensity": None,
            "mean_body_chars": 0, "latest": None,
            **fetch_rows.get(source_id, {"last_fetched": None, "error_count": 0,
                                         "feed_newest": None}),
            "silent_hours": None, "median_gap_hours": None, "stale": False,
        }
        outlets.append({
            **row,
            "name": src.get("name", row["source_id"]),
            "category": src.get("category", "general"),
            "topic": src.get("topic"),
            "allsides_score": src.get("allsides_score", 0.0),
            "allsides_label": src.get("allsides_label", "center"),
            "lean": _lean_of(row["source_id"]),
            "essential": row["source_id"] in db.ESSENTIAL_SOURCES,
        })
    data["outlets"] = outlets
    data["totals"]["sources_active"] = len(feed_manager.SOURCES)
    data["totals"]["sources_erroring"] = sum(1 for o in outlets if (o["error_count"] or 0) > 0)
    # Distinct from erroring: these fetch cleanly, they've just stopped publishing.
    data["totals"]["sources_stale"] = sum(1 for o in outlets if o.get("stale"))
    # Articles from deactivated/retired sources: still counted corpus-wide but
    # absent from the outlet leaderboard, so the two no longer sum. Reported
    # rather than hidden, since the discrepancy is otherwise unexplainable.
    data["totals"]["articles_unlisted"] = orphaned_articles
    data.pop("source_fetches", None)

    # ── Category rollup — weighted from the per-outlet aggregates ───────────
    cats: dict[str, dict] = {}
    for o in outlets:
        c = cats.setdefault(o["category"], {
            "category": o["category"], "articles": 0, "outlets": 0,
            "_tone_w": 0.0, "_tone_n": 0,
        })
        c["articles"] += o["articles"]
        c["outlets"] += 1
        if o["mean_tone"] is not None:
            c["_tone_w"] += o["mean_tone"] * o["articles"]
            c["_tone_n"] += o["articles"]
    categories = []
    for c in cats.values():
        categories.append({
            "category": c["category"],
            "articles": c["articles"],
            "outlets": c["outlets"],
            "mean_tone": round(c["_tone_w"] / c["_tone_n"], 4) if c["_tone_n"] else None,
        })
    categories.sort(key=lambda c: -c["articles"])
    data["categories"] = categories

    # ── Outlet lean split — how balanced the corpus itself is ───────────────
    lean_split = {"left": 0, "center": 0, "right": 0}
    lean_articles = {"left": 0, "center": 0, "right": 0}
    for o in outlets:
        lean_split[o["lean"]] += 1
        lean_articles[o["lean"]] += o["articles"]
    data["lean_split"] = {"outlets": lean_split, "articles": lean_articles}

    # ── Composition by publisher lean ───────────────────────────────────────
    # This replaces the old per-article bias histogram. It is deliberately not
    # a model output: every article inherits its publisher's AllSides rating,
    # so this describes what the corpus is made of, not what any one article
    # says. That was all the previous "bias distribution" ever measured — it
    # just didn't say so.
    order = ["left", "lean_left", "center", "lean_right", "right"]
    labels = {"left": "Left", "lean_left": "Lean left", "center": "Center",
              "lean_right": "Lean right", "right": "Lean right"}
    labels["right"] = "Right"
    buckets = {k: {"key": k, "label": labels[k], "articles": 0, "outlets": 0,
                   "score": 0.0} for k in order}
    for o in outlets:
        key = o.get("allsides_label")
        if key not in buckets:
            continue
        buckets[key]["articles"] += o["articles"]
        buckets[key]["outlets"] += 1
        buckets[key]["score"] = o.get("allsides_score", 0.0)
    data["composition"] = {
        "buckets": [buckets[k] for k in order],
        "articles": sum(b["articles"] for b in buckets.values()),
        "outlets": sum(b["outlets"] for b in buckets.values()),
        "unrated": data["totals"]["articles"] - sum(b["articles"] for b in buckets.values()),
    }

    # ── Coverage: spread + blindspot per cluster, trimmed to the top N ──────
    groups = data["coverage"].pop("groups")
    blindspots = {"left": 0, "right": 0}
    shaped = []
    for g in groups:
        source_ids = [a["source_id"] for a in g["articles"]]
        spread = _spread_of(source_ids)
        if spread["direction"]:
            blindspots[spread["direction"]] += 1
        by_bias = sorted(
            g["articles"],
            key=lambda a: a["bias_score"] if a["bias_score"] is not None else 0.0,
        )
        median = by_bias[len(by_bias) // 2]
        biases = [a["bias_score"] for a in g["articles"] if a["bias_score"] is not None]
        shaped.append({
            "group_id": g["group_id"],
            "outlets": g["outlets"],
            "articles": len(g["articles"]),
            "headline": median["title"],
            "article_id": median["id"],
            "published": max((a["published"] or "" for a in g["articles"]), default=None) or None,
            "spread": spread,
            # How far apart the outlets are on this one story — the honest measure
            # of "is this contested or agreed-upon coverage".
            "bias_range": round(max(biases) - min(biases), 2) if len(biases) > 1 else 0.0,
            "sources": sorted({
                feed_manager.SOURCE_MAP.get(sid, {}).get("name", sid)
                for sid in source_ids
            }),
        })
    data["coverage"]["blindspots"] = blindspots
    data["coverage"]["total_groups"] = len(shaped)
    data["coverage"]["top"] = shaped[:top_groups]
    data["coverage"]["widest_spread"] = sorted(
        shaped, key=lambda g: -g["bias_range"]
    )[:top_groups]

    data["models"] = model_stats
    data["signals"] = {
        "movers": signals,
        "by_volume": signals_by_volume,
        "categories": signal_categories,
        # The UI labels this "live", so it has to exclude settled contracts the
        # same way movers/by_volume do — get_signals_meta counts every row.
        "count": live_signal_count,
        "count_total": signals_meta["count"],
        "last_updated": signals_meta["last_updated"],
    }
    # Coverage volume vs priced probability. Both sides measured, neither
    # forecast — the panel reports the gap, it does not predict the outcome.
    data["divergence"] = {
        **divergence.build(live_signals, divergence_articles, limit=10),
        "window_days": trend_days,
    }
    data["generated_at"] = int(time.time())
    _analytics_cache[key] = (time.time(), data)
    return data


@app.post("/debug/train_sentiment")
async def debug_train_sentiment():
    conn = db.get_conn()
    articles = db.get_all_articles_with_text(conn)
    feedback = db.get_sentiment_feedback(conn)
    conn.close()
    await asyncio.to_thread(retrain._train_and_save_sentiment, sentiment_model, articles, feedback)
    return {"version": sentiment_model.version}


# ── Weather + markets data proxy ─────────────────────────────────────────────

_data_cache: dict[str, tuple[float, dict]] = {}


async def _cached(key: str, ttl: float, fetcher: Callable[[], Awaitable[dict]]) -> dict:
    now = time.time()
    hit = _data_cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    data = await fetcher()
    _data_cache[key] = (now, data)
    return data


CHICAGO_LAT, CHICAGO_LON = 41.8781, -87.6298


@app.get("/weather")
async def weather(
    lat: float = Query(CHICAGO_LAT, ge=-90, le=90),
    lon: float = Query(CHICAGO_LON, ge=-180, le=180),
    place: Optional[str] = None,
):
    key = f"weather:{lat:.3f},{lon:.3f}"

    async def fetch() -> dict:
        forecast_params = {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,"
                       "precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,"
                       "surface_pressure,pressure_msl,cloud_cover,visibility,dew_point_2m",
            "hourly": "temperature_2m,relative_humidity_2m,dew_point_2m,"
                      "precipitation_probability,precipitation,weather_code,"
                      "wind_speed_10m,wind_gusts_10m,wind_direction_10m,"
                      "surface_pressure,pressure_msl,cloud_cover,visibility,uv_index,is_day",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,"
                     "apparent_temperature_min,precipitation_probability_max,precipitation_sum,"
                     "precipitation_hours,sunrise,sunset,uv_index_max,wind_speed_10m_max,"
                     "wind_gusts_10m_max",
            "temperature_unit": "fahrenheit",
            "wind_speed_unit": "mph",
            "precipitation_unit": "inch",
            "timezone": "auto",
            "forecast_days": 7,
        }
        aq_params = {
            "latitude": lat,
            "longitude": lon,
            "current": "us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,uv_index",
            "hourly": "us_aqi,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen",
            "timezone": "auto",
            "forecast_days": 1,
        }

        async with httpx.AsyncClient(timeout=10) as client:
            forecast_task = client.get("https://api.open-meteo.com/v1/forecast", params=forecast_params)
            aq_task       = client.get("https://air-quality-api.open-meteo.com/v1/air-quality", params=aq_params)
            forecast_resp, aq_resp = await asyncio.gather(forecast_task, aq_task, return_exceptions=True)

        if isinstance(forecast_resp, BaseException):
            raise forecast_resp
        forecast_resp.raise_for_status()
        data = forecast_resp.json()

        if not isinstance(aq_resp, BaseException):
            try:
                aq_resp.raise_for_status()
                data["air_quality"] = aq_resp.json()
            except (httpx.HTTPError, ValueError):
                data["air_quality"] = None
        else:
            data["air_quality"] = None

        data["place"] = place or "Chicago, IL"
        return data

    try:
        return await _cached(key, 600, fetch)
    except httpx.HTTPError as e:
        raise HTTPException(503, f"weather upstream failed: {e}")


YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

_yahoo_sem = asyncio.Semaphore(6)

INDICES     = ["^GSPC", "^DJI", "^IXIC", "^RUT"]
VOLATILITY  = ["^VIX", "^VVIX", "^SKEW"]
MEGACAPS    = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA",
               "BRK-B", "JPM", "AVGO", "AMD", "PLTR", "COIN"]
COMMODITIES = ["CL=F", "BZ=F", "NG=F", "RB=F",                    # energy
               "GC=F", "SI=F", "HG=F", "PL=F", "PA=F",            # metals
               "ZC=F", "ZW=F", "ZS=F", "KC=F", "SB=F", "CT=F"]    # agriculture
FUTURES     = ["ES=F", "NQ=F", "YM=F", "RTY=F",                   # equity index
               "ZN=F", "ZB=F", "ZF=F",                            # rates
               "DX=F", "6E=F", "6J=F",                            # FX
               "BTC=F", "ETH=F"]                                  # crypto
ETFS        = ["SPY", "QQQ", "DIA", "IWM", "TLT", "GLD", "USO", "UUP",
               "HYG", "XLK", "XLF", "XLE", "XLV", "SMH"]


def _compact_chart(symbol: str, payload: dict) -> dict | None:
    try:
        result = payload["chart"]["result"][0]
    except (KeyError, IndexError, TypeError):
        return None
    meta = result.get("meta") or {}
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    change = (price - prev) if (price is not None and prev) else None
    change_pct = (change / prev * 100) if (change is not None and prev) else None

    closes: list[float] = []
    try:
        raw = result["indicators"]["quote"][0]["close"]
        closes = [c for c in raw if c is not None][-40:]
    except (KeyError, IndexError, TypeError):
        pass

    return {
        "symbol": meta.get("symbol", symbol),
        "name": meta.get("shortName") or meta.get("longName") or meta.get("symbol", symbol),
        "price": price,
        "previous_close": prev,
        "change": change,
        "change_pct": change_pct,
        "day_high": meta.get("regularMarketDayHigh"),
        "day_low": meta.get("regularMarketDayLow"),
        "volume": meta.get("regularMarketVolume"),
        "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "instrument_type": meta.get("instrumentType"),
        "spark": closes,
    }


async def _fetch_quote(client: httpx.AsyncClient, symbol: str) -> dict | None:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    async with _yahoo_sem:
        try:
            r = await client.get(
                url,
                params={"range": "5d", "interval": "1d"},
                headers=YAHOO_HEADERS,
            )
            r.raise_for_status()
            return _compact_chart(symbol, r.json())
        except (httpx.HTTPError, ValueError):
            return None


async def _fetch_quotes(client: httpx.AsyncClient, symbols: list[str]) -> list[dict]:
    if not symbols:
        return []
    results = await asyncio.gather(*[_fetch_quote(client, s) for s in symbols])
    return [q for q in results if q]


async def _fetch_trending(client: httpx.AsyncClient) -> list[str]:
    try:
        r = await client.get(
            "https://query1.finance.yahoo.com/v1/finance/trending/US",
            params={"count": 15},
            headers=YAHOO_HEADERS,
        )
        r.raise_for_status()
        items = r.json().get("finance", {}).get("result", [{}])[0].get("quotes", [])
        return [q["symbol"] for q in items if q.get("symbol")][:12]
    except (httpx.HTTPError, ValueError, KeyError, IndexError):
        return []


_RANGE_MAP = {
    "1d":  ("1d",  "5m"),
    "5d":  ("5d",  "15m"),
    "1mo": ("1mo", "1d"),
    "6mo": ("6mo", "1d"),
    "1y":  ("1y",  "1d"),
    "5y":  ("5y",  "1wk"),
}


def _detail_from_chart(symbol: str, payload: dict) -> dict:
    try:
        result = payload["chart"]["result"][0]
    except (KeyError, IndexError, TypeError):
        raise HTTPException(404, f"no data for {symbol}")
    meta = result.get("meta") or {}
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    closes  = quote.get("close")  or []
    opens   = quote.get("open")   or []
    highs   = quote.get("high")   or []
    lows    = quote.get("low")    or []
    volumes = quote.get("volume") or []

    series: list[dict] = []
    for i, t in enumerate(timestamps):
        c = closes[i] if i < len(closes) else None
        if c is None:
            continue
        series.append({
            "t": t,
            "o": opens[i]   if i < len(opens)   else None,
            "h": highs[i]   if i < len(highs)   else None,
            "l": lows[i]    if i < len(lows)    else None,
            "c": c,
            "v": volumes[i] if i < len(volumes) else None,
        })

    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    change = (price - prev) if (price is not None and prev) else None
    change_pct = (change / prev * 100) if (change is not None and prev) else None

    return {
        "symbol": meta.get("symbol", symbol),
        "name": meta.get("shortName") or meta.get("longName") or meta.get("symbol", symbol),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "currency": meta.get("currency"),
        "instrument_type": meta.get("instrumentType"),
        "timezone": meta.get("timezone"),
        "price": price,
        "previous_close": prev,
        "change": change,
        "change_pct": change_pct,
        "day_high": meta.get("regularMarketDayHigh"),
        "day_low":  meta.get("regularMarketDayLow"),
        "volume":   meta.get("regularMarketVolume"),
        "fifty_two_week_high": meta.get("fiftyTwoWeekHigh"),
        "fifty_two_week_low":  meta.get("fiftyTwoWeekLow"),
        "first_trade_date": meta.get("firstTradeDate"),
        "data_granularity": meta.get("dataGranularity"),
        "series": series,
    }


SYMBOL_KEYWORDS: dict[str, list[str]] = {
    # Indices
    "^GSPC": ["S&P 500", "S&P500"],
    "^IXIC": ["Nasdaq"],
    "^DJI":  ["Dow Jones", "Dow Industrials"],
    "^RUT":  ["Russell 2000"],
    "^VIX":  ["VIX", "volatility index"],
    "^VVIX": ["VVIX"],
    "^SKEW": ["SKEW"],
    # Equity index futures
    "ES=F":  ["S&P 500 futures", "S&P futures"],
    "NQ=F":  ["Nasdaq futures"],
    "YM=F":  ["Dow futures"],
    "RTY=F": ["Russell futures"],
    # Energy
    "CL=F":  ["WTI", "crude oil", "WTI crude"],
    "BZ=F":  ["Brent", "Brent crude"],
    "NG=F":  ["natural gas", "natgas"],
    "RB=F":  ["gasoline"],
    # Metals
    "GC=F":  ["gold"],
    "SI=F":  ["silver"],
    "HG=F":  ["copper"],
    "PL=F":  ["platinum"],
    "PA=F":  ["palladium"],
    # Agriculture
    "ZC=F":  ["corn"],
    "ZW=F":  ["wheat"],
    "ZS=F":  ["soybean", "soybeans"],
    "KC=F":  ["coffee"],
    "SB=F":  ["sugar"],
    "CT=F":  ["cotton"],
    # Rates
    "ZN=F":  ["10-year", "10 year treasury", "treasury yield"],
    "ZB=F":  ["30-year treasury", "long bond"],
    # FX / crypto
    "DX=F":  ["dollar index", "DXY"],
    "BTC=F": ["bitcoin", "BTC"],
    "ETH=F": ["ethereum", "ether"],
    # Megacap nicknames + product lines
    "AAPL":  ["Apple", "iPhone"],
    "MSFT":  ["Microsoft"],
    "NVDA":  ["Nvidia"],
    "GOOGL": ["Google", "Alphabet"],
    "META":  ["Meta", "Facebook"],
    "AMZN":  ["Amazon"],
    "TSLA":  ["Tesla", "Musk"],
    "AVGO":  ["Broadcom"],
    "JPM":   ["JPMorgan", "JP Morgan"],
    "BRK-B": ["Berkshire", "Buffett"],
    "COIN":  ["Coinbase"],
    "PLTR":  ["Palantir"],
    "AMD":   ["AMD", "Advanced Micro Devices"],
    # ETFs — usually tied to the underlying narrative
    "SPY":   ["S&P 500"],
    "QQQ":   ["Nasdaq"],
    "GLD":   ["gold"],
    "USO":   ["oil"],
    "TLT":   ["treasury", "bond market"],
    "HYG":   ["high yield", "junk bond"],
}


def _keywords_for(symbol: str) -> list[str]:
    if symbol in SYMBOL_KEYWORDS:
        return SYMBOL_KEYWORDS[symbol]
    base = symbol.split("=")[0].lstrip("^")
    return [base] if base else []


@app.get("/markets/{symbol}/news")
def market_news(symbol: str, limit: int = Query(10, ge=1, le=30)):
    keywords = _keywords_for(symbol)
    if not keywords:
        return {"symbol": symbol, "keywords": [], "articles": []}
    where = " OR ".join(["LOWER(title) LIKE ?"] * len(keywords))
    params: list = [f"%{kw.lower()}%" for kw in keywords]
    conn = db.get_conn()
    # Pull more candidates than needed; word-boundary filter prunes substring false positives.
    rows = conn.execute(
        f"""SELECT id, title, url, image_url, published, source_id,
                   bias_score, sentiment_score, intensity_score
            FROM articles
            WHERE ({where})
            ORDER BY published DESC NULLS LAST
            LIMIT ?""",
        params + [limit * 4],
    ).fetchall()
    conn.close()

    patterns = [re.compile(r"\b" + re.escape(kw) + r"\b", re.IGNORECASE) for kw in keywords]
    articles = []
    for r in rows:
        a = dict(r)
        if not any(p.search(a["title"]) for p in patterns):
            continue
        src = feed_manager.SOURCE_MAP.get(a["source_id"], {})
        a["source"] = {
            "id": a["source_id"],
            "name": src.get("name", a["source_id"]),
            "category": src.get("category", "general"),
            "allsides_label": src.get("allsides_label", "center"),
            "allsides_score": src.get("allsides_score", 0.0),
        }
        articles.append(a)
        if len(articles) >= limit:
            break
    return {"symbol": symbol, "keywords": keywords, "articles": articles}


@app.get("/markets/{symbol}")
async def market_detail(
    symbol: str,
    range: str = Query("6mo", pattern="^(1d|5d|1mo|6mo|1y|5y)$"),
):
    yh_range, interval = _RANGE_MAP[range]
    key = f"detail:{symbol}:{range}"

    async def fetch() -> dict:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        async with _yahoo_sem:
            async with httpx.AsyncClient(timeout=12) as client:
                r = await client.get(
                    url,
                    params={"range": yh_range, "interval": interval},
                    headers=YAHOO_HEADERS,
                )
                r.raise_for_status()
                return _detail_from_chart(symbol, r.json())

    try:
        return await _cached(key, 60, fetch)
    except httpx.HTTPError as e:
        raise HTTPException(503, f"upstream failed: {e}")



@app.get("/markets")
async def markets():
    async def fetch() -> dict:
        async with httpx.AsyncClient(timeout=15) as client:
            trending_symbols = await _fetch_trending(client)
            indices, volatility, megacaps, commodities, futures, etfs, trending = await asyncio.gather(
                _fetch_quotes(client, INDICES),
                _fetch_quotes(client, VOLATILITY),
                _fetch_quotes(client, MEGACAPS),
                _fetch_quotes(client, COMMODITIES),
                _fetch_quotes(client, FUTURES),
                _fetch_quotes(client, ETFS),
                _fetch_quotes(client, trending_symbols),
            )
        return {
            "indices": indices,
            "volatility": volatility,
            "megacaps": megacaps,
            "commodities": commodities,
            "futures": futures,
            "etfs": etfs,
            "trending": trending,
            "fetched_at": int(time.time()),
        }

    return await _cached("markets", 60, fetch)
