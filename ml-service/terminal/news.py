"""NSE: search Artha's own news corpus."""

import db

MAX_WORDS = 6


def _like(word: str) -> str:
    escaped = word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def search(query: str, days: int = 30, limit: int = 50) -> list[dict]:
    """Stories whose title or summary holds every word of the query, newest
    first. Words are matched as substrings, case-insensitive."""
    words = [w for w in query.split() if len(w) > 1][:MAX_WORDS]
    if not words:
        return []
    # one placeholder pair per word; the text itself only ever travels as a
    # parameter
    match = " AND ".join(["(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')"] * len(words))
    params: list = []
    for w in words:
        params += [_like(w), _like(w)]
    params += [f"-{int(days)} days", int(limit)]
    conn = db.get_conn()
    try:
        rows = conn.execute(
            "SELECT id, title, url, published, source_id, sentiment_score FROM articles "
            f"WHERE {match} AND datetime(published) > datetime('now', ?) "
            "ORDER BY published DESC LIMIT ?",
            params,
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]
