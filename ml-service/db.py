import os
import sqlite3
from pathlib import Path

# Overridable so containers mount a volume and tests use a throwaway file.
DB_PATH = Path(os.environ.get("ARTHA_DB_PATH",
                              Path(__file__).parent / "data" / "news_bias.db"))


def get_conn():
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    """The tables this module owns; the securities registry makes its own
    (universe.py). Tables left by the retired news and sentiment engine stay
    in old databases, untouched and unread."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_conn()
    conn.executescript("""
        -- Every study run, with its parameters and results: the experiment
        -- log that makes research reproducible and counts the tries.
        CREATE TABLE IF NOT EXISTS experiments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at DATETIME DEFAULT CURRENT_TIMESTAMP,
            kind TEXT NOT NULL,
            params TEXT,
            metrics TEXT
        );
    """)
    conn.commit()
    conn.close()
