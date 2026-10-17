"""The terminal's own data: watchlists, notes and alerts (and, later,
holdings and paper orders). One small SQLite file of its own, so it never
touches the main database. Every query takes its values as parameters."""

import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "data" / "terminal.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS watchlists (
    name TEXT NOT NULL, symbol TEXT NOT NULL, added_at TEXT NOT NULL,
    PRIMARY KEY (name, symbol)
);
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY, symbol TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, op TEXT NOT NULL CHECK (op IN ('above', 'below')),
    level REAL NOT NULL, note TEXT, created_at TEXT NOT NULL,
    triggered_at TEXT, triggered_price REAL
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect(path: Path | None = None) -> sqlite3.Connection:
    p = path or PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def _all(sql: str, params: tuple = ()) -> list[dict]:
    with closing(connect()) as conn:
        return [dict(r) for r in conn.execute(sql, params)]


def _run(sql: str, params: tuple = ()) -> int:
    with closing(connect()) as conn, conn:
        return conn.execute(sql, params).lastrowid


# watchlists

def lists() -> list[dict]:
    return _all("SELECT name, COUNT(*) AS count FROM watchlists GROUP BY name ORDER BY name")


def members(name: str) -> list[str]:
    return [r["symbol"] for r in _all("SELECT symbol FROM watchlists WHERE name = ? ORDER BY added_at", (name,))]


def add_member(name: str, symbol: str) -> None:
    _run("INSERT OR IGNORE INTO watchlists (name, symbol, added_at) VALUES (?, ?, ?)", (name, symbol.upper(), now()))


def remove_member(name: str, symbol: str) -> None:
    _run("DELETE FROM watchlists WHERE name = ? AND symbol = ?", (name, symbol.upper()))


# notes

def notes(symbol: str | None) -> list[dict]:
    if symbol:
        return _all("SELECT * FROM notes WHERE symbol = ? ORDER BY created_at DESC", (symbol.upper(),))
    return _all("SELECT * FROM notes ORDER BY created_at DESC")


def add_note(symbol: str | None, body: str) -> int:
    return _run("INSERT INTO notes (symbol, body, created_at) VALUES (?, ?, ?)",
                (symbol.upper() if symbol else None, body, now()))


def delete_note(note_id: int) -> None:
    _run("DELETE FROM notes WHERE id = ?", (note_id,))


# alerts

def alerts() -> list[dict]:
    return _all("SELECT * FROM alerts ORDER BY triggered_at IS NOT NULL, created_at DESC")


def add_alert(symbol: str, op: str, level: float, note: str | None) -> int:
    return _run("INSERT INTO alerts (symbol, op, level, note, created_at) VALUES (?, ?, ?, ?, ?)",
                (symbol.upper(), op, level, note, now()))


def delete_alert(alert_id: int) -> None:
    _run("DELETE FROM alerts WHERE id = ?", (alert_id,))


def mark_triggered(alert_id: int, price: float) -> None:
    _run("UPDATE alerts SET triggered_at = ?, triggered_price = ? WHERE id = ? AND triggered_at IS NULL",
         (now(), price, alert_id))
