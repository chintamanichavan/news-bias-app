import sqlite3
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "news_bias.db"


def get_conn():
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS articles (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT,
            url TEXT NOT NULL,
            image_url TEXT,
            published DATETIME,
            fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            bias_score REAL,
            confidence REAL,
            model_version INTEGER,
            feature_json TEXT,
            sentiment_score REAL,
            intensity_score REAL,
            emotion_breakdown TEXT,
            sentiment_model_version INTEGER
        );

        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id TEXT NOT NULL REFERENCES articles(id),
            predicted_score REAL NOT NULL,
            user_score REAL NOT NULL,
            feedback_type TEXT NOT NULL,
            dimension TEXT NOT NULL DEFAULT 'bias',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(article_id, feedback_type, dimension)
        );

        CREATE TABLE IF NOT EXISTS model_versions (
            version INTEGER PRIMARY KEY AUTOINCREMENT,
            trained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            feedback_count INTEGER NOT NULL,
            accuracy REAL,
            mae REAL,
            file_path TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sentiment_model_versions (
            version INTEGER PRIMARY KEY AUTOINCREMENT,
            trained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            feedback_count INTEGER NOT NULL,
            polarity_accuracy REAL,
            intensity_accuracy REAL,
            file_path TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS source_fetches (
            source_id TEXT PRIMARY KEY,
            last_fetched DATETIME,
            article_count INTEGER DEFAULT 0,
            error_count INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS story_groups (
            group_id TEXT PRIMARY KEY,
            article_ids TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS prediction_markets (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            question TEXT NOT NULL,
            description TEXT,
            category TEXT,
            yes_price REAL,
            yes_change_24h REAL,
            volume_24h REAL,
            volume_total REAL,
            end_date DATETIME,
            url TEXT,
            image_url TEXT,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)

    # ── Idempotent migrations for pre-sentiment databases ─────────────────
    _migrate_articles_sentiment_columns(conn)
    _migrate_feedback_dimension(conn)
    _migrate_source_fetch_newest(conn)

    conn.commit()
    conn.close()


def _migrate_source_fetch_newest(conn):
    """Record the newest item date the feed itself claims, as fetched.

    Needed because implausible publish dates are dropped on the way into
    `articles` — so a feed still serving three-year-old items ends up with no
    usable dates at all, and looks silent-with-no-history rather than dead.
    This column keeps the raw claim, which is exactly the staleness signal.
    """
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(source_fetches)").fetchall()}
    if "feed_newest" not in cols:
        conn.execute("ALTER TABLE source_fetches ADD COLUMN feed_newest DATETIME")
        conn.commit()


def _migrate_articles_sentiment_columns(conn):
    """Add sentiment columns to existing articles tables."""
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(articles)").fetchall()}
    for col, ddl in [
        ("sentiment_score", "ALTER TABLE articles ADD COLUMN sentiment_score REAL"),
        ("intensity_score", "ALTER TABLE articles ADD COLUMN intensity_score REAL"),
        ("emotion_breakdown", "ALTER TABLE articles ADD COLUMN emotion_breakdown TEXT"),
        ("sentiment_model_version", "ALTER TABLE articles ADD COLUMN sentiment_model_version INTEGER"),
        ("summary", "ALTER TABLE articles ADD COLUMN summary TEXT"),
        ("scrape_attempted_at", "ALTER TABLE articles ADD COLUMN scrape_attempted_at TIMESTAMP"),
    ]:
        if col not in cols:
            try:
                conn.execute(ddl)
            except sqlite3.OperationalError:
                pass


def _migrate_feedback_dimension(conn):
    """
    Older feedback table has UNIQUE(article_id, feedback_type) which prevents
    storing both bias and sentiment feedback on the same article. Rebuild it
    with the new constraint UNIQUE(article_id, feedback_type, dimension).
    """
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(feedback)").fetchall()}
    if "dimension" in cols:
        return  # already migrated

    conn.executescript("""
        CREATE TABLE feedback_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id TEXT NOT NULL REFERENCES articles(id),
            predicted_score REAL NOT NULL,
            user_score REAL NOT NULL,
            feedback_type TEXT NOT NULL,
            dimension TEXT NOT NULL DEFAULT 'bias',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(article_id, feedback_type, dimension)
        );

        INSERT INTO feedback_new (id, article_id, predicted_score, user_score, feedback_type, dimension, created_at)
        SELECT id, article_id, predicted_score, user_score, feedback_type, 'bias', created_at
        FROM feedback;

        DROP TABLE feedback;
        ALTER TABLE feedback_new RENAME TO feedback;
    """)


def upsert_article(conn, article: dict):
    conn.execute("""
        INSERT OR IGNORE INTO articles
            (id, source_id, title, body, url, image_url, published)
        VALUES (:id, :source_id, :title, :body, :url, :image_url, :published)
    """, article)


def update_article_scores(conn, article_id: str, bias_score: float, confidence: float, version: int):
    conn.execute("""
        UPDATE articles SET bias_score=?, confidence=?, model_version=?
        WHERE id=?
    """, (bias_score, confidence, version, article_id))


def update_article_sentiment(conn, article_id: str, sentiment_score: float,
                             intensity_score: float, emotion_breakdown: dict, version: int):
    conn.execute("""
        UPDATE articles
        SET sentiment_score=?, intensity_score=?, emotion_breakdown=?, sentiment_model_version=?
        WHERE id=?
    """, (sentiment_score, intensity_score, json.dumps(emotion_breakdown), version, article_id))


def update_article_summary(conn, article_id: str, summary: str):
    conn.execute("UPDATE articles SET summary=? WHERE id=?", (summary, article_id))


def replace_article_body(conn, article_id: str, body: str):
    """Overwrite body with scraped article text; also clear summary so it
    regenerates from the longer source."""
    conn.execute(
        "UPDATE articles SET body=?, summary=NULL, scrape_attempted_at=CURRENT_TIMESTAMP WHERE id=?",
        (body, article_id),
    )


def mark_scrape_attempted(conn, article_id: str):
    conn.execute(
        "UPDATE articles SET scrape_attempted_at=CURRENT_TIMESTAMP WHERE id=?",
        (article_id,),
    )


def get_articles(conn, page: int, per_page: int, source_id: str | None,
                 min_score: float | None, max_score: float | None,
                 source_ids: list[str] | None = None,
                 lookback_hours: int | None = None,
                 per_source_cap: int | None = None):
    where = ["1=1"]
    params: list = []
    if source_id:
        where.append("source_id = ?")
        params.append(source_id)
    elif source_ids:
        placeholders = ",".join("?" * len(source_ids))
        where.append(f"source_id IN ({placeholders})")
        params.extend(source_ids)
    if min_score is not None:
        where.append("(bias_score IS NULL OR bias_score >= ?)")
        params.append(min_score)
    if max_score is not None:
        where.append("(bias_score IS NULL OR bias_score <= ?)")
        params.append(max_score)
    if lookback_hours is not None:
        where.append(f"datetime(published) > datetime('now', '-{int(lookback_hours)} hours')")

    where_sql = " AND ".join(where)

    if per_source_cap:
        # Cap each source to the N most recent matching articles, then page across
        # the capped set. Keeps high-volume outlets (NYT, Guardian) from drowning
        # out lower-volume but equally relevant sources (FT, Foreign Affairs).
        base = f"""
            SELECT *
              FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY source_id
                    ORDER BY published DESC NULLS LAST
                ) AS _rn
                  FROM articles
                 WHERE {where_sql}
              )
             WHERE _rn <= {int(per_source_cap)}
             ORDER BY published DESC NULLS LAST
        """
        total = conn.execute(f"SELECT COUNT(*) FROM ({base})", params).fetchone()[0]
        rows = conn.execute(base + " LIMIT ? OFFSET ?", params + [per_page, (page - 1) * per_page]).fetchall()
    else:
        sql = f"SELECT * FROM articles WHERE {where_sql} ORDER BY published DESC NULLS LAST"
        total = conn.execute(f"SELECT COUNT(*) FROM articles WHERE {where_sql}", params).fetchone()[0]
        rows = conn.execute(sql + " LIMIT ? OFFSET ?", params + [per_page, (page - 1) * per_page]).fetchall()
    return total, [dict(r) for r in rows]


def get_article(conn, article_id: str):
    row = conn.execute("SELECT * FROM articles WHERE id=?", (article_id,)).fetchone()
    return dict(row) if row else None


def get_all_articles_with_text(conn):
    rows = conn.execute("SELECT id, source_id, title, body FROM articles WHERE title IS NOT NULL").fetchall()
    return [dict(r) for r in rows]


def insert_feedback(conn, article_id: str, predicted_score: float,
                    user_score: float, feedback_type: str, dimension: str = "bias"):
    conn.execute("""
        INSERT INTO feedback (article_id, predicted_score, user_score, feedback_type, dimension)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(article_id, feedback_type, dimension) DO UPDATE SET
            user_score=excluded.user_score,
            predicted_score=excluded.predicted_score,
            created_at=CURRENT_TIMESTAMP
    """, (article_id, predicted_score, user_score, feedback_type, dimension))
    conn.commit()


def get_all_feedback(conn, dimension: str | None = None):
    if dimension:
        rows = conn.execute("SELECT * FROM feedback WHERE dimension=?", (dimension,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM feedback").fetchall()
    return [dict(r) for r in rows]


def get_sentiment_feedback(conn):
    rows = conn.execute(
        "SELECT * FROM feedback WHERE dimension IN ('sentiment', 'intensity')"
    ).fetchall()
    return [dict(r) for r in rows]


def count_feedback_since_last_retrain(conn) -> int:
    last = conn.execute("SELECT MAX(trained_at) FROM model_versions").fetchone()[0]
    if not last:
        return conn.execute("SELECT COUNT(*) FROM feedback WHERE dimension='bias'").fetchone()[0]
    return conn.execute(
        "SELECT COUNT(*) FROM feedback WHERE dimension='bias' AND created_at > ?", (last,)
    ).fetchone()[0]


def count_sentiment_feedback_since_last_retrain(conn) -> int:
    last = conn.execute("SELECT MAX(trained_at) FROM sentiment_model_versions").fetchone()[0]
    if not last:
        return conn.execute(
            "SELECT COUNT(*) FROM feedback WHERE dimension IN ('sentiment','intensity')"
        ).fetchone()[0]
    return conn.execute(
        "SELECT COUNT(*) FROM feedback WHERE dimension IN ('sentiment','intensity') AND created_at > ?",
        (last,),
    ).fetchone()[0]


def save_model_version(conn, feedback_count: int, accuracy: float | None, mae: float | None, file_path: str) -> int:
    cur = conn.execute("""
        INSERT INTO model_versions (feedback_count, accuracy, mae, file_path)
        VALUES (?, ?, ?, ?)
    """, (feedback_count, accuracy, mae, file_path))
    conn.commit()
    return cur.lastrowid


def has_trained_model(conn) -> bool:
    return conn.execute("SELECT COUNT(*) FROM model_versions").fetchone()[0] > 0


def has_trained_sentiment_model(conn) -> bool:
    return conn.execute("SELECT COUNT(*) FROM sentiment_model_versions").fetchone()[0] > 0


def get_latest_model_version(conn):
    row = conn.execute("SELECT * FROM model_versions ORDER BY version DESC LIMIT 1").fetchone()
    return dict(row) if row else None


def get_latest_sentiment_model_version(conn):
    row = conn.execute(
        "SELECT * FROM sentiment_model_versions ORDER BY version DESC LIMIT 1"
    ).fetchone()
    return dict(row) if row else None


def save_sentiment_model_version(conn, feedback_count: int,
                                 polarity_accuracy: float | None,
                                 intensity_accuracy: float | None,
                                 file_path: str) -> int:
    cur = conn.execute("""
        INSERT INTO sentiment_model_versions
            (feedback_count, polarity_accuracy, intensity_accuracy, file_path)
        VALUES (?, ?, ?, ?)
    """, (feedback_count, polarity_accuracy, intensity_accuracy, file_path))
    conn.commit()
    return cur.lastrowid


def get_stats(conn):
    bias_current = get_latest_model_version(conn)
    bias_versions = [dict(r) for r in conn.execute(
        "SELECT * FROM model_versions ORDER BY version"
    ).fetchall()]
    bias_total = conn.execute(
        "SELECT COUNT(*) FROM feedback WHERE dimension='bias'"
    ).fetchone()[0]
    bias_since = count_feedback_since_last_retrain(conn)

    sent_current = get_latest_sentiment_model_version(conn)
    sent_versions = [dict(r) for r in conn.execute(
        "SELECT * FROM sentiment_model_versions ORDER BY version"
    ).fetchall()]
    sent_total = conn.execute(
        "SELECT COUNT(*) FROM feedback WHERE dimension IN ('sentiment', 'intensity')"
    ).fetchone()[0]
    sent_since = count_sentiment_feedback_since_last_retrain(conn)

    return {
        # Bias (existing fields preserved for backwards compat)
        "current_version": bias_current["version"] if bias_current else 0,
        "current_accuracy": bias_current["accuracy"] if bias_current else None,
        "total_feedback": bias_total,
        "feedback_since_retrain": bias_since,
        "next_retrain_at": max(0, 50 - bias_since),
        "versions": bias_versions,
        # Sentiment
        "sentiment": {
            "current_version": sent_current["version"] if sent_current else 0,
            "polarity_accuracy": sent_current["polarity_accuracy"] if sent_current else None,
            "intensity_accuracy": sent_current["intensity_accuracy"] if sent_current else None,
            "total_feedback": sent_total,
            "feedback_since_retrain": sent_since,
            "next_retrain_at": max(0, 50 - sent_since),
            "versions": sent_versions,
        },
    }


def upsert_source_fetch(
    conn,
    source_id: str,
    article_count: int,
    error: bool = False,
    feed_newest: str | None = None,
):
    conn.execute("""
        INSERT INTO source_fetches (source_id, last_fetched, article_count, error_count, feed_newest)
        VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET
            last_fetched=CURRENT_TIMESTAMP,
            article_count=article_count + excluded.article_count,
            -- Consecutive failures, not lifetime: a success clears the counter.
            -- As a running total it never decayed, so three transient 503s last
            -- month kept a healthy feed flagged as "failing to fetch" forever.
            error_count=CASE WHEN excluded.error_count = 0
                             THEN 0
                             ELSE source_fetches.error_count + 1 END,
            -- Keep the last known claim if this fetch reported none.
            feed_newest=COALESCE(excluded.feed_newest, source_fetches.feed_newest)
    """, (source_id, article_count, 1 if error else 0, feed_newest))


def save_story_groups(conn, groups: list[list[str]]):
    conn.execute("DELETE FROM story_groups")
    for group in groups:
        import hashlib
        group_id = hashlib.sha256(":".join(sorted(group)).encode()).hexdigest()[:12]
        conn.execute("INSERT OR IGNORE INTO story_groups (group_id, article_ids) VALUES (?, ?)",
                     (group_id, json.dumps(group)))
    conn.commit()


def get_story_groups(conn):
    rows = conn.execute("""
        SELECT sg.group_id, sg.article_ids, sg.created_at
        FROM story_groups sg
        ORDER BY sg.created_at DESC
        LIMIT 50
    """).fetchall()
    result = []
    for r in rows:
        ids = json.loads(r["article_ids"])
        articles = []
        for aid in ids:
            a = get_article(conn, aid)
            if a:
                articles.append(a)
        if len(articles) > 1:
            result.append({"group_id": r["group_id"], "articles": articles})
    return result


# ── Corpus analytics ─────────────────────────────────────────────────────────
# Everything the /insights dashboard reads. All of it is derived from columns we
# already write during ingestion — nothing here needs a new model run.
#
# Bucket edges are shared with the frontend histograms. Seven buckets per scale
# (three per arm + a neutral middle) so a diverging bar chart can colour each arm
# with a validated three-step ramp.

BIAS_BUCKETS = [
    ("far_left",   "Far left",   -5.0, -3.5),
    ("left",       "Left",       -3.5, -1.5),
    ("lean_left",  "Lean left",  -1.5, -0.5),
    ("center",     "Center",     -0.5,  0.5),
    ("lean_right", "Lean right",  0.5,  1.5),
    ("right",      "Right",       1.5,  3.5),
    ("far_right",  "Far right",   3.5,  5.0),
]

TONE_BUCKETS = [
    ("very_negative", "Very negative", -1.00, -0.60),
    ("negative",      "Negative",      -0.60, -0.25),
    ("slight_negative", "Slightly negative", -0.25, -0.05),
    ("neutral",       "Neutral",       -0.05,  0.05),
    ("slight_positive", "Slightly positive", 0.05, 0.25),
    ("positive",      "Positive",       0.25,  0.60),
    ("very_positive", "Very positive",  0.60,  1.00),
]

EMOTIONS = ["anger", "fear", "joy", "sadness", "disgust", "trust", "anticipation", "surprise"]


def _bucketize(values: list[float], buckets: list[tuple]) -> list[dict]:
    """Count values into the given (key, label, lo, hi) buckets.

    Edges are half-open [lo, hi) so a score never lands in two buckets; the last
    bucket is closed so the scale's maximum is counted.
    """
    counts = {b[0]: 0 for b in buckets}
    last_key = buckets[-1][0]
    for v in values:
        for key, _label, lo, hi in buckets:
            if lo <= v < hi or (key == last_key and v == hi):
                counts[key] += 1
                break
    return [
        {"key": key, "label": label, "lo": lo, "hi": hi, "count": counts[key]}
        for key, label, lo, hi in buckets
    ]


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 4) if values else None


def _quantiles(values: list[float]) -> dict | None:
    """Five-number summary + spread. Nearest-rank, no interpolation — with
    thousands of rows the difference is invisible and this can't invent a value
    the model never produced."""
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    at = lambda p: s[min(n - 1, max(0, int(round(p * (n - 1)))))]  # noqa: E731
    mean = sum(s) / n
    var = sum((v - mean) ** 2 for v in s) / n
    return {
        "min": round(s[0], 4), "p10": round(at(0.10), 4), "p25": round(at(0.25), 4),
        "median": round(at(0.50), 4), "p75": round(at(0.75), 4), "p90": round(at(0.90), 4),
        "max": round(s[-1], 4), "mean": round(mean, 4), "stdev": round(var ** 0.5, 4),
    }


def _fine_histogram(values: list[float], bins: int = 24) -> list[dict]:
    """Equal-width bins across the *observed* range.

    The semantic buckets answer "how many are left-leaning"; this answers "what
    shape is the model's output", which the semantic buckets hide whenever the
    model's range is narrow relative to its nominal scale.
    """
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi - lo < 1e-9:
        return [{"lo": round(lo, 4), "hi": round(hi, 4), "count": len(values)}]
    width = (hi - lo) / bins
    counts = [0] * bins
    for v in values:
        idx = min(bins - 1, int((v - lo) / width))
        counts[idx] += 1
    return [
        {"lo": round(lo + i * width, 4), "hi": round(lo + (i + 1) * width, 4), "count": c}
        for i, c in enumerate(counts)
    ]


def _describe(values: list[float], buckets: list[tuple], nominal: tuple[float, float]) -> dict:
    """Semantic buckets + observed shape + how much of the nominal scale the
    model actually uses. `scale_used` near zero means the histogram will look
    degenerate for a real reason, and the UI should say so rather than imply the
    corpus is uniformly centred."""
    span = nominal[1] - nominal[0]
    observed = (max(values) - min(values)) if values else 0.0
    return {
        "histogram": _bucketize(values, buckets),
        "fine_histogram": _fine_histogram(values),
        "quantiles": _quantiles(values),
        "nominal_min": nominal[0],
        "nominal_max": nominal[1],
        "scale_used": round(observed / span, 4) if span else 0.0,
        "scored": len(values),
    }


# A feed that 200s but has stopped publishing looks perfectly healthy to
# source_fetches — CNN's old endpoint still serves items three years stale. A
# fixed "silent for N days" rule can't work across outlets whose real cadence
# ranges from minutes (wires) to weeks (quarterly journals), so each source is
# judged against its own historical rhythm.
STALE_GAP_MULTIPLIER = 5      # silent for 5× its usual gap …
STALE_MIN_HOURS = 72          # … and at least this long, so bursty feeds don't trip
STALE_HARD_DAYS = 45          # nothing at all in this long is dead regardless
_CADENCE_SAMPLE = 40          # recent articles used to establish the rhythm


def _publish_cadence(conn) -> dict[str, float]:
    """Median hours between consecutive articles, per source.

    Median rather than mean: one long holiday gap shouldn't redefine an
    outlet's normal rhythm.
    """
    rows = conn.execute(
        """SELECT source_id, published FROM articles
            WHERE published IS NOT NULL
            ORDER BY source_id, published DESC"""
    ).fetchall()
    stamps: dict[str, list[str]] = {}
    for r in rows:
        got = stamps.setdefault(r["source_id"], [])
        if len(got) < _CADENCE_SAMPLE:
            got.append(r["published"])

    out: dict[str, float] = {}
    for source_id, values in stamps.items():
        parsed = []
        for v in values:
            try:
                parsed.append(datetime.fromisoformat(v.replace("Z", "+00:00")))
            except (ValueError, AttributeError):
                continue
        if len(parsed) < 3:
            continue  # too little history to call anything abnormal
        gaps = sorted(
            (parsed[i] - parsed[i + 1]).total_seconds() / 3600
            for i in range(len(parsed) - 1)
        )
        gaps = [g for g in gaps if g >= 0]
        if gaps:
            out[source_id] = gaps[len(gaps) // 2]
    return out


def _parse_stamp(value) -> "datetime | None":
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, AttributeError, TypeError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _staleness(outlet: dict, median_gap_hours: float | None) -> dict:
    """Classify how long a source has been silent relative to its own cadence.

    Uses the older of "newest article we stored" and "newest item the feed
    claims". The two diverge exactly in the case worth catching: a feed serving
    only years-old items has those dates rejected on ingest, so `latest` would
    otherwise be empty and the source would look merely new rather than dead.
    """
    stored = _parse_stamp(outlet.get("latest"))
    claimed = _parse_stamp(outlet.get("feed_newest"))
    candidates = [s for s in (stored, claimed) if s]
    if not candidates:
        return {"silent_hours": None, "median_gap_hours": None, "stale": False}
    last = min(candidates)

    now = datetime.now(timezone.utc)
    silent = max(0.0, (now - last).total_seconds() / 3600)

    stale = silent > STALE_HARD_DAYS * 24
    if not stale and median_gap_hours:
        stale = silent > max(STALE_MIN_HOURS, median_gap_hours * STALE_GAP_MULTIPLIER)
    return {
        "silent_hours": round(silent, 1),
        "median_gap_hours": round(median_gap_hours, 2) if median_gap_hours else None,
        "stale": bool(stale),
    }


def get_analytics(conn, window_hours: int = 24, trend_days: int = 14):
    """Corpus-wide aggregates for the /insights dashboard.

    Returns raw source_id-keyed rows; the API layer joins publication metadata
    (name, category, AllSides rating) from SOURCE_MAP the same way _enrich does.
    """
    def scalar(sql: str, params: tuple = ()) -> int:
        return conn.execute(sql, params).fetchone()[0]

    # ── Totals ──────────────────────────────────────────────────────────────
    total = scalar("SELECT COUNT(*) FROM articles")
    totals = {
        "articles": total,
        "articles_window": scalar(
            f"SELECT COUNT(*) FROM articles WHERE datetime(published) > datetime('now', '-{int(window_hours)} hours')"
        ),
        "articles_prev_window": scalar(
            f"""SELECT COUNT(*) FROM articles
                 WHERE datetime(published) > datetime('now', '-{int(window_hours) * 2} hours')
                   AND datetime(published) <= datetime('now', '-{int(window_hours)} hours')"""
        ),
        "articles_7d": scalar(
            "SELECT COUNT(*) FROM articles WHERE datetime(published) > datetime('now', '-7 days')"
        ),
        "scored_bias": scalar("SELECT COUNT(*) FROM articles WHERE bias_score IS NOT NULL"),
        "scored_tone": scalar("SELECT COUNT(*) FROM articles WHERE sentiment_score IS NOT NULL"),
        "with_body": scalar("SELECT COUNT(*) FROM articles WHERE body IS NOT NULL AND LENGTH(body) > 400"),
        "with_summary": scalar("SELECT COUNT(*) FROM articles WHERE summary IS NOT NULL"),
        "with_image": scalar("SELECT COUNT(*) FROM articles WHERE image_url IS NOT NULL"),
        "sources_ingesting": scalar("SELECT COUNT(DISTINCT source_id) FROM articles"),
        "story_groups": scalar("SELECT COUNT(*) FROM story_groups"),
        "words": scalar(
            "SELECT COALESCE(SUM(LENGTH(body) - LENGTH(REPLACE(body, ' ', '')) + 1), 0) "
            "FROM articles WHERE body IS NOT NULL"
        ),
        "oldest": conn.execute(
            "SELECT MIN(published) FROM articles WHERE published IS NOT NULL"
        ).fetchone()[0],
        "newest": conn.execute(
            "SELECT MAX(published) FROM articles WHERE published IS NOT NULL"
        ).fetchone()[0],
    }

    # ── Bias distribution ───────────────────────────────────────────────────
    bias_rows = conn.execute(
        "SELECT bias_score, confidence FROM articles WHERE bias_score IS NOT NULL"
    ).fetchall()
    bias_values = [r["bias_score"] for r in bias_rows]
    confidences = [r["confidence"] for r in bias_rows if r["confidence"] is not None]
    bias = {
        **_describe(bias_values, BIAS_BUCKETS, (-5.0, 5.0)),
        "mean": _mean(bias_values),
        "mean_confidence": _mean(confidences),
        "confidence_quantiles": _quantiles(confidences),
        "left": sum(1 for v in bias_values if v <= -0.5),
        "center": sum(1 for v in bias_values if -0.5 < v < 0.5),
        "right": sum(1 for v in bias_values if v >= 0.5),
    }

    # ── Tone, intensity, emotions ───────────────────────────────────────────
    tone_rows = conn.execute(
        """SELECT sentiment_score, intensity_score, emotion_breakdown
             FROM articles WHERE sentiment_score IS NOT NULL"""
    ).fetchall()
    tone_values = [r["sentiment_score"] for r in tone_rows]
    intensities = [r["intensity_score"] for r in tone_rows if r["intensity_score"] is not None]

    emotion_sums = {e: 0.0 for e in EMOTIONS}
    emotion_dominant = {e: 0 for e in EMOTIONS}
    emotion_n = 0
    for r in tone_rows:
        if not r["emotion_breakdown"]:
            continue
        try:
            breakdown = json.loads(r["emotion_breakdown"])
        except (TypeError, json.JSONDecodeError):
            continue
        emotion_n += 1
        top, top_v = None, 0.0
        for e in EMOTIONS:
            v = breakdown.get(e) or 0.0
            emotion_sums[e] += v
            if v > top_v:
                top, top_v = e, v
        if top:
            emotion_dominant[top] += 1

    tone = {
        **_describe(tone_values, TONE_BUCKETS, (-1.0, 1.0)),
        "mean": _mean(tone_values),
        "mean_intensity": _mean(intensities),
        "intensity_quantiles": _quantiles(intensities),
        "intensity_fine_histogram": _fine_histogram(intensities),
        "negative": sum(1 for v in tone_values if v <= -0.05),
        "neutral": sum(1 for v in tone_values if -0.05 < v < 0.05),
        "positive": sum(1 for v in tone_values if v >= 0.05),
        "charged": sum(1 for v in intensities if v >= 0.66),
        "emotions": [
            {
                "emotion": e,
                "mean": round(emotion_sums[e] / emotion_n, 4) if emotion_n else 0.0,
                "dominant_count": emotion_dominant[e],
            }
            for e in EMOTIONS
        ],
        "emotion_sample": emotion_n,
    }

    # ── Publishing cadence ──────────────────────────────────────────────────
    hourly = [
        {"bucket": r["bucket"], "count": r["n"]}
        for r in conn.execute(
            """SELECT strftime('%Y-%m-%dT%H:00', datetime(published)) AS bucket, COUNT(*) AS n
                 FROM articles
                WHERE datetime(published) > datetime('now', '-48 hours')
                GROUP BY bucket ORDER BY bucket"""
        ).fetchall()
    ]
    daily_counts = {
        r["bucket"]: r["n"]
        for r in conn.execute(
            f"""SELECT date(datetime(published)) AS bucket, COUNT(*) AS n
                  FROM articles
                 WHERE datetime(published) > datetime('now', '-{int(trend_days)} days')
                 GROUP BY bucket ORDER BY bucket"""
        ).fetchall()
    }
    # Emit every day in the window, including empty ones. A GROUP BY simply
    # omits days with no articles, and the chart plots by array index — so an
    # ingestion outage was silently re-spaced into an unbroken healthy line
    # instead of showing as a trough.
    today = datetime.now(timezone.utc).date()
    daily = [
        {
            "bucket": (day := (today - timedelta(days=offset))).isoformat(),
            "count": daily_counts.get(day.isoformat(), 0),
        }
        for offset in range(int(trend_days) - 1, -1, -1)
    ]
    by_hour = {r["h"]: r["n"] for r in conn.execute(
        f"""SELECT CAST(strftime('%H', datetime(published)) AS INTEGER) AS h, COUNT(*) AS n
              FROM articles
             WHERE datetime(published) > datetime('now', '-{int(trend_days)} days')
             GROUP BY h"""
    ).fetchall()}
    cadence = {
        "hourly": hourly,
        "daily": daily,
        "by_hour_of_day": [{"hour": h, "count": by_hour.get(h, 0)} for h in range(24)],
        "trend_days": trend_days,
    }

    # ── Per-outlet rollup ───────────────────────────────────────────────────
    # (staleness helpers live just above get_analytics)
    outlet_rows = conn.execute(
        f"""SELECT a.source_id,
                   COUNT(*)                                        AS articles,
                   AVG(a.bias_score)                               AS mean_bias,
                   AVG(a.sentiment_score)                          AS mean_tone,
                   AVG(a.intensity_score)                          AS mean_intensity,
                   AVG(a.confidence)                               AS mean_confidence,
                   MAX(a.published)                                AS latest,
                   SUM(CASE WHEN datetime(a.published) > datetime('now', '-{int(window_hours)} hours')
                            THEN 1 ELSE 0 END)                     AS articles_window,
                   SUM(CASE WHEN a.body IS NOT NULL AND LENGTH(a.body) > 400
                            THEN 1 ELSE 0 END)                     AS full_text,
                   AVG(LENGTH(COALESCE(a.body, '')))               AS mean_body_chars,
                   f.last_fetched                                  AS last_fetched,
                   f.error_count                                   AS error_count,
                   f.feed_newest                                   AS feed_newest
              FROM articles a
              LEFT JOIN source_fetches f ON f.source_id = a.source_id
             GROUP BY a.source_id
             ORDER BY articles DESC"""
    ).fetchall()
    # Fetch bookkeeping keyed by source, so the API layer can still describe a
    # source that has never produced an article (a feed erroring on every run).
    source_fetches = {
        r["source_id"]: {
            "last_fetched": r["last_fetched"],
            "error_count": r["error_count"],
            "feed_newest": r["feed_newest"],
        }
        for r in conn.execute(
            "SELECT source_id, last_fetched, error_count, feed_newest FROM source_fetches"
        ).fetchall()
    }

    cadence_by_source = _publish_cadence(conn)
    outlets = []
    for r in outlet_rows:
        d = dict(r)
        for k in ("mean_bias", "mean_tone", "mean_intensity", "mean_confidence"):
            d[k] = round(d[k], 4) if d[k] is not None else None
        d["mean_body_chars"] = int(d["mean_body_chars"] or 0)
        d.update(_staleness(d, cadence_by_source.get(d["source_id"])))
        outlets.append(d)

    # ── Coverage clustering ─────────────────────────────────────────────────
    # Group size distribution + the widest-covered clusters, with each member's
    # source and bias so the API layer can compute the left/centre/right spread.
    group_rows = conn.execute(
        "SELECT group_id, article_ids, created_at FROM story_groups"
    ).fetchall()
    size_counts: dict[int, int] = {}
    groups: list[dict] = []
    for r in group_rows:
        try:
            ids = json.loads(r["article_ids"])
        except (TypeError, json.JSONDecodeError):
            continue
        if not ids:
            continue
        placeholders = ",".join("?" * len(ids))
        members = conn.execute(
            f"""SELECT id, source_id, title, published, bias_score, sentiment_score
                  FROM articles WHERE id IN ({placeholders})
                 ORDER BY published DESC NULLS LAST""",
            ids,
        ).fetchall()
        if len(members) < 2:
            continue
        size = len({m["source_id"] for m in members})
        size_counts[size] = size_counts.get(size, 0) + 1
        groups.append({
            "group_id": r["group_id"],
            "created_at": r["created_at"],
            "outlets": size,
            "articles": [dict(m) for m in members],
        })
    groups.sort(key=lambda g: (-g["outlets"], g["created_at"] or ""))
    coverage = {
        "size_distribution": [
            {"outlets": k, "groups": size_counts[k]} for k in sorted(size_counts)
        ],
        "clustered_articles": sum(len(g["articles"]) for g in groups),
        "groups": groups,
    }

    return {
        "window_hours": window_hours,
        "totals": totals,
        "bias": bias,
        "tone": tone,
        "cadence": cadence,
        "outlets": outlets,
        "source_fetches": source_fetches,
        "coverage": coverage,
    }


# ── Top stories ──────────────────────────────────────────────────────────────

def _active_sources_by_category() -> dict[str, set[str]]:
    """Active source ids grouped by category, read straight from sources.json.

    Loaded here rather than imported from feed_manager, which imports this
    module. Read once at import; the service restarts on config changes anyway.
    """
    try:
        with open(Path(__file__).parent / "data" / "sources.json") as f:
            rows = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    out: dict[str, set[str]] = {}
    for s in rows:
        if s.get("active"):
            out.setdefault(s.get("category") or "general", set()).add(s["id"])
    return out


_BY_CATEGORY = _active_sources_by_category()

# These two curation sets used to be hardcoded id lists. That silently broke
# when the source list was rewritten: six of the ten "essential" ids were
# deactivated, leaving four slow-publishing journals, so the default 24h feed
# and the whole digest page came back empty. Deriving them from the config the
# feeds already use means the two can no longer drift apart.

# Homepage digest: reporting-led beats only — opinion and commentary belong in
# /feed, not in a curated digest.
PRESTIGE_SOURCES = set().union(
    *(_BY_CATEGORY.get(c, set()) for c in ("news", "geopolitics", "science"))
) or set()

# Default /feed view: everything active except opinion.
ESSENTIAL_SOURCES = set().union(
    *(v for k, v in _BY_CATEGORY.items() if k != "opinion")
) or set()


def get_top_stories(conn, limit: int = 12, lookback_hours: int = 36):
    """
    Score recent articles by:
      - cross-source coverage (story_group member count) × 3.0
      - recency (3h/12h/24h tiered)
      - prestige bonus for high-quality single-source pieces (+4.0)
    Returns deduped top stories (one per story group).
    """
    # Build article → group_id and group → size maps
    group_rows = conn.execute("SELECT group_id, article_ids FROM story_groups").fetchall()
    article_to_group: dict[str, str] = {}
    group_sizes: dict[str, int] = {}
    group_members: dict[str, list[str]] = {}
    for r in group_rows:
        ids = json.loads(r["article_ids"])
        group_sizes[r["group_id"]] = len(ids)
        group_members[r["group_id"]] = ids
        for aid in ids:
            article_to_group[aid] = r["group_id"]

    # Pull candidate articles
    rows = conn.execute(
        f"""SELECT * FROM articles
            WHERE published IS NOT NULL
              AND datetime(published) > datetime('now', '-{int(lookback_hours)} hours')
            ORDER BY published DESC
            LIMIT 500""",
    ).fetchall()

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    scored = []
    for r in rows:
        a = dict(r)
        gid = article_to_group.get(a["id"])
        size = group_sizes.get(gid, 1) if gid else 1

        # Recency
        try:
            pub_str = a["published"].replace(" ", "T")
            if not pub_str.endswith("Z") and "+" not in pub_str[-6:]:
                pub_str += "+00:00"
            else:
                pub_str = pub_str.replace("Z", "+00:00")
            pub = datetime.fromisoformat(pub_str)
            hours_ago = (now - pub).total_seconds() / 3600
        except Exception:
            hours_ago = 24.0
        if hours_ago < 3:    recency = 3.0
        elif hours_ago < 12: recency = 2.0
        elif hours_ago < 24: recency = 1.0
        else:                recency = 0.3

        coverage_score = size * 3.0
        prestige = 2.0 if size == 1 and a["source_id"] in PRESTIGE_SOURCES else 0.0
        intensity_boost = (a.get("intensity_score") or 0) * 0.6

        score = coverage_score + recency + prestige + intensity_boost
        a["_score"] = round(score, 2)
        a["_group_id"] = gid
        a["_group_size"] = size
        a["_group_members"] = group_members.get(gid, []) if gid else []
        scored.append(a)

    # Dedupe by group, take highest-scoring representative per group
    seen_groups: set[str] = set()
    out: list[dict] = []
    for a in sorted(scored, key=lambda x: -x["_score"]):
        if a["_group_id"]:
            if a["_group_id"] in seen_groups:
                continue
            seen_groups.add(a["_group_id"])
        out.append(a)
        if len(out) >= limit:
            break
    return out


# ── Prediction markets ───────────────────────────────────────────────────────

def upsert_signal(conn, signal: dict):
    conn.execute("""
        INSERT INTO prediction_markets
            (id, source, question, description, category, yes_price,
             yes_change_24h, volume_24h, volume_total, end_date, url, image_url, last_updated)
        VALUES
            (:id, :source, :question, :description, :category, :yes_price,
             :yes_change_24h, :volume_24h, :volume_total, :end_date, :url, :image_url, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            question=excluded.question,
            description=excluded.description,
            category=excluded.category,
            yes_price=excluded.yes_price,
            yes_change_24h=excluded.yes_change_24h,
            volume_24h=excluded.volume_24h,
            volume_total=excluded.volume_total,
            end_date=excluded.end_date,
            url=excluded.url,
            image_url=excluded.image_url,
            last_updated=CURRENT_TIMESTAMP
    """, signal)


def get_signals(conn, category: str | None = None, sort: str = "movers", limit: int = 60):
    where = ["1=1"]
    params: list = []
    if category:
        where.append("category = ?")
        params.append(category)

    order_sql = {
        "movers":  "ABS(COALESCE(yes_change_24h, 0)) DESC",
        "volume":  "COALESCE(volume_24h, 0) DESC",
        "expiry":  "end_date ASC",
    }.get(sort, "ABS(COALESCE(yes_change_24h, 0)) DESC")

    sql = f"""
        SELECT * FROM prediction_markets
        WHERE {' AND '.join(where)}
          AND (end_date IS NULL OR end_date > datetime('now'))
        ORDER BY {order_sql}
        LIMIT ?
    """
    rows = conn.execute(sql, params + [limit]).fetchall()
    return [dict(r) for r in rows]


def get_signal_categories(conn):
    rows = conn.execute(
        "SELECT category, COUNT(*) AS n FROM prediction_markets WHERE category IS NOT NULL GROUP BY category"
    ).fetchall()
    return {r["category"]: r["n"] for r in rows}


def get_signals_meta(conn):
    row = conn.execute(
        "SELECT COUNT(*) AS count, MAX(last_updated) AS last_updated FROM prediction_markets"
    ).fetchone()
    return {"count": row["count"], "last_updated": row["last_updated"]}


def prune_stale_signals(conn, days: int = 7):
    """Drop markets we haven't refreshed in N days (Polymarket pulled them)."""
    conn.execute(
        "DELETE FROM prediction_markets WHERE last_updated < datetime('now', ?)",
        (f"-{days} days",),
    )
