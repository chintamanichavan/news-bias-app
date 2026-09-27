"""
Point-in-time data store — Phase 1's foundation.

Immutable Parquet snapshots under data/pit/, queried through DuckDB. The
discipline is one rule enforced everywhere: every row carries the timestamp
at which it became KNOWN (`ingested_at`, or `filed_at` for fundamentals,
`vintage` for macro), and every research read goes through an as-of filter
so nothing can see the future. Snapshots are append-only: a re-ingest writes
a new snapshot file, never rewrites an old one — which is what makes any
past study replayable byte-for-byte.

Tables
------
prices_eod    symbol, date, open, high, low, close, volume, source
fundamentals  cik, symbol, tag, unit, period_end, value, filed_at
macro         series, date, value
news_tone     date, theme, tone, articles

Each parquet file lives at data/pit/<table>/snapshot=<utc-iso>/part.parquet;
`ingested_at` is stamped into every row from the snapshot id.
"""

import os
import re
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd

import contracts

PIT_ROOT = Path(os.environ.get("ARTHA_PIT_ROOT",
                               Path(__file__).parent / "data" / "pit"))

TABLES = ("prices_eod", "fundamentals", "macro", "news_tone")


def _utcnow_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def write_snapshot(table: str, df: pd.DataFrame, snapshot_id: str | None = None) -> Path:
    """Validate against the table's contract, stamp `ingested_at`, and write
    an immutable snapshot. A contract violation raises — bad batches never
    reach the store."""
    if table not in TABLES:
        raise ValueError(f"unknown PIT table: {table}")
    df = contracts.validate(table, df)

    snapshot_id = snapshot_id or _utcnow_id()
    if not re.fullmatch(r"[0-9TZ]+", snapshot_id):
        raise ValueError("snapshot id must be a plain UTC stamp")
    out_dir = PIT_ROOT / table / f"snapshot={snapshot_id}"
    out_path = out_dir / "part.parquet"
    if out_path.exists():
        raise FileExistsError(f"snapshot {snapshot_id} already exists for {table} — snapshots are immutable")
    out_dir.mkdir(parents=True, exist_ok=True)

    df = df.copy()
    df["ingested_at"] = pd.Timestamp(
        datetime.strptime(snapshot_id, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    )
    df.to_parquet(out_path, index=False)
    return out_path


def connect() -> duckdb.DuckDBPyConnection:
    """A DuckDB connection with every PIT table registered as a view over its
    snapshot files (empty tables become empty views)."""
    conn = duckdb.connect()
    for table in TABLES:
        glob = str(PIT_ROOT / table / "snapshot=*" / "*.parquet")
        if list((PIT_ROOT / table).glob("snapshot=*/*.parquet")):
            # union_by_name: snapshots may gain columns over time (e.g.
            # fundamentals grew period_start); older files read as NULL.
            conn.execute(
                f"CREATE VIEW {table} AS SELECT * FROM read_parquet('{glob}', union_by_name=true)")
    return conn


def tables_present() -> dict[str, int]:
    out = {}
    for table in TABLES:
        files = list((PIT_ROOT / table).glob("snapshot=*/*.parquet"))
        out[table] = len(files)
    return out


# ── As-of reads: the only sanctioned way research touches the store ─────────

def prices_asof(conn, as_of: str, symbols: list[str] | None = None) -> pd.DataFrame:
    """EOD prices using only rows ingested on or before `as_of` (ISO date or
    timestamp). Duplicate (symbol, date) rows resolve to the latest ingest at
    or before the as-of instant — a replayed correction never rewrites the
    past study that ran before the correction arrived."""
    sym_clause = ""
    params: list = [as_of]
    if symbols:
        sym_clause = f"AND symbol IN ({','.join('?' * len(symbols))})"
        params += symbols
    return conn.execute(
        f"""
        SELECT symbol, date, open, high, low, close, volume FROM (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY symbol, date ORDER BY ingested_at DESC) AS rn
          FROM prices_eod
          WHERE ingested_at <= CAST(? AS TIMESTAMPTZ) {sym_clause}
        ) WHERE rn = 1
        ORDER BY symbol, date
        """,
        params,
    ).df()


def fundamentals_asof(conn, as_of: str, tag: str | None = None) -> pd.DataFrame:
    """Fundamentals as they were KNOWN at `as_of`: filed on or before it,
    and present in the store by then."""
    tag_clause = "AND tag = ?" if tag else ""
    params = [as_of, as_of] + ([tag] if tag else [])
    return conn.execute(
        f"""
        SELECT cik, symbol, tag, unit, period_start, period_end, value, filed_at FROM (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY cik, tag, period_end ORDER BY filed_at DESC, ingested_at DESC) AS rn
          FROM fundamentals
          WHERE filed_at <= CAST(? AS TIMESTAMP)
            AND ingested_at <= CAST(? AS TIMESTAMPTZ) {tag_clause}
        ) WHERE rn = 1
        """,
        params,
    ).df()
