"""The terminal's own data: watchlists, notes, alerts, holdings and paper
orders. One small SQLite file of its own, so it never
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
CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, quantity REAL NOT NULL,
    cost REAL, opened TEXT, added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY, symbol TEXT NOT NULL, side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    quantity REAL NOT NULL CHECK (quantity > 0), type TEXT NOT NULL CHECK (type IN ('market', 'limit')),
    limit_price REAL, status TEXT NOT NULL CHECK (status IN ('working', 'filled', 'cancelled')),
    created_at TEXT NOT NULL, arrival_mid REAL, arrival_bid REAL, arrival_ask REAL,
    filled_at TEXT, fill_price REAL
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


# holdings (PRTU): one row per lot; quantities may be negative for shorts

def holdings() -> list[dict]:
    return _all("SELECT * FROM holdings ORDER BY symbol, id")


def replace_holdings(rows: list[dict]) -> int:
    """Swap the whole book for `rows` in one transaction."""
    with closing(connect()) as conn, conn:
        conn.execute("DELETE FROM holdings")
        conn.executemany(
            "INSERT INTO holdings (symbol, quantity, cost, opened, added_at) VALUES (?, ?, ?, ?, ?)",
            [(r["symbol"].upper(), r["quantity"], r.get("cost"), r.get("opened"), now()) for r in rows])
    return len(rows)


def add_holding(symbol: str, quantity: float, cost: float | None, opened: str | None) -> int:
    return _run("INSERT INTO holdings (symbol, quantity, cost, opened, added_at) VALUES (?, ?, ?, ?, ?)",
                (symbol.upper(), quantity, cost, opened, now()))


def delete_holding(holding_id: int) -> None:
    _run("DELETE FROM holdings WHERE id = ?", (holding_id,))


# paper orders (EMSX, TCA)

def orders() -> list[dict]:
    return _all("SELECT * FROM orders ORDER BY created_at DESC, id DESC")


def add_order(o: dict) -> int:
    return _run(
        "INSERT INTO orders (symbol, side, quantity, type, limit_price, status, created_at, "
        "arrival_mid, arrival_bid, arrival_ask, filled_at, fill_price) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (o["symbol"].upper(), o["side"], o["quantity"], o["type"], o.get("limit_price"), o["status"], now(),
         o.get("arrival_mid"), o.get("arrival_bid"), o.get("arrival_ask"), o.get("filled_at"), o.get("fill_price")))


def fill_order(order_id: int, price: float) -> None:
    _run("UPDATE orders SET status = 'filled', filled_at = ?, fill_price = ? WHERE id = ? AND status = 'working'",
         (now(), price, order_id))


def cancel_order(order_id: int) -> bool:
    with closing(connect()) as conn, conn:
        return conn.execute("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'working'",
                            (order_id,)).rowcount == 1
