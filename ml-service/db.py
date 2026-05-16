import sqlite3
import json
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

    conn.commit()
    conn.close()


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
        where.append(f"published > datetime('now', '-{int(lookback_hours)} hours')")

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


def upsert_source_fetch(conn, source_id: str, article_count: int, error: bool = False):
    conn.execute("""
        INSERT INTO source_fetches (source_id, last_fetched, article_count, error_count)
        VALUES (?, CURRENT_TIMESTAMP, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET
            last_fetched=CURRENT_TIMESTAMP,
            article_count=article_count + excluded.article_count,
            error_count=error_count + excluded.error_count
    """, (source_id, article_count, 1 if error else 0))


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


# ── Top stories ──────────────────────────────────────────────────────────────

PRESTIGE_SOURCES = {
    # Reporting-led outlets only — opinion/commentary blogs (Marginal Revolution,
    # Ritholtz, Calculated Risk) belong in /feed, not the homepage digest.
    "foreign_affairs", "foreign_policy", "war_on_rocks",
    "nature", "science_mag",
}

# Default /feed view shows only these. FT/WSJ dropped (paywalled stubs); CFR
# and Scientific American dropped (dead RSS feeds — 404 and SSL handshake fail).
ESSENTIAL_SOURCES = {
    "marginal_revolution", "ritholtz", "liberty_street", "econbrowser",
    "foreign_affairs", "foreign_policy", "war_on_rocks",
    "nature", "science_mag", "quanta",
}


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
              AND published > datetime('now', '-{int(lookback_hours)} hours')
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
