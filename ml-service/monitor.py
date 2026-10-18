"""
The experiments log: every study run with its parameters and results, so
the number of tries behind a finding is on record.
"""

import json

import db


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
