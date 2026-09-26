"""
Monitoring & data quality — the pipeline watching itself.

- pipeline_health(): freshness per component against its own cadence
  (ok / stale / failing), plus corpus counts and DB size
- signal outliers: composites pinned near ±1 or jumping cycle-over-cycle
- experiments log: every alpha/backtest run with params and metrics
"""

import json
import os

import db

# component -> (query for newest timestamp, ok_minutes, stale_minutes)
_CHECKS = [
    ("news feeds", "SELECT MAX(last_fetched) FROM source_fetches", 90, 360),
    ("social ingest", "SELECT MAX(fetched_at) FROM social_posts", 45, 180),
    ("hazards", "SELECT MAX(fetched_at) FROM hazard_events", 45, 180),
    ("prediction markets", "SELECT MAX(last_updated) FROM prediction_markets", 90, 360),
    ("signal engine", "SELECT MAX(taken_at) FROM signal_snapshots", 30, 90),
    ("paper book", "SELECT MAX(taken_at) FROM paper_equity", 30, 90),
]


def log_experiment(kind: str, params: dict, metrics: dict) -> None:
    try:
        conn = db.get_conn()
        conn.execute("INSERT INTO experiments (kind, params, metrics) VALUES (?,?,?)",
                     (kind, json.dumps(params), json.dumps(metrics)))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[monitor] experiment log failed: {e!r}")


def experiments(limit: int = 20) -> list[dict]:
    conn = db.get_conn()
    rows = [dict(r) for r in conn.execute(
        "SELECT at, kind, params, metrics FROM experiments ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()]
    conn.close()
    for r in rows:
        for k in ("params", "metrics"):
            try:
                r[k] = json.loads(r[k] or "{}")
            except json.JSONDecodeError:
                r[k] = {}
    return rows


def pipeline_health() -> dict:
    conn = db.get_conn()
    components = []
    for name, query, ok_min, stale_min in _CHECKS:
        age_min = None
        try:
            row = conn.execute(
                f"SELECT (julianday('now') - julianday(({query}))) * 1440"
            ).fetchone()
            age_min = round(row[0], 1) if row and row[0] is not None else None
        except Exception:
            pass
        status = ("failing" if age_min is None or age_min > stale_min
                  else "stale" if age_min > ok_min else "ok")
        components.append({"component": name, "age_min": age_min, "status": status})

    counts = {}
    for label, q in [
        ("articles", "SELECT COUNT(*) FROM articles"),
        ("social_posts_24h", "SELECT COUNT(*) FROM social_posts WHERE datetime(fetched_at) > datetime('now','-1 day')"),
        ("hazards_active", "SELECT COUNT(*) FROM hazard_events WHERE datetime(fetched_at) > datetime('now','-6 hours')"),
        ("snapshots", "SELECT COUNT(*) FROM signal_snapshots"),
        ("securities", "SELECT COUNT(*) FROM securities"),
        ("experiments", "SELECT COUNT(*) FROM experiments"),
    ]:
        try:
            counts[label] = conn.execute(q).fetchone()[0]
        except Exception:
            counts[label] = None

    # Outliers: pinned or jumpy composites in the last day
    outliers = []
    try:
        rows = conn.execute(
            """SELECT entity, taken_at, composite,
                      LAG(composite) OVER (PARTITION BY entity ORDER BY taken_at) AS prev
               FROM signal_snapshots
               WHERE datetime(taken_at) > datetime('now', '-1 day')""",
        ).fetchall()
        seen = set()
        for r in rows:
            flag = None
            if abs(r["composite"] or 0) > 0.9:
                flag = f"pinned at {r['composite']:+.2f}"
            elif r["prev"] is not None and abs(r["composite"] - r["prev"]) > 0.5:
                flag = f"jumped {r['prev']:+.2f} → {r['composite']:+.2f}"
            if flag and r["entity"] not in seen:
                seen.add(r["entity"])
                outliers.append({"entity": r["entity"], "flag": flag})
    except Exception:
        pass
    conn.close()

    try:
        db_bytes = os.path.getsize(db.DB_PATH)
    except OSError:
        db_bytes = None

    worst = "ok"
    for c in components:
        if c["status"] == "failing":
            worst = "failing"
            break
        if c["status"] == "stale":
            worst = "stale"
    return {"overall": worst, "components": components, "counts": counts,
            "outliers": outliers[:10], "db_bytes": db_bytes}
