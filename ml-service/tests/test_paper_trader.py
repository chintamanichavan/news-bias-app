import json

import paper_trader as pt


def _clear_gate(db):
    """Insert an alpha study that clears the hurdle so entries are allowed."""
    conn = db.get_conn()
    conn.execute("INSERT INTO experiments (kind, params, metrics) VALUES ('alpha', '{}', ?)",
                 (json.dumps({"ic_t": 3.5, "ic_mean": 0.05}),))
    conn.commit(); conn.close()


def _positions(db):
    conn = db.get_conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM paper_positions").fetchall()]
    conn.close()
    return rows


def _trades(db):
    conn = db.get_conn()
    rows = [dict(r) for r in conn.execute("SELECT * FROM paper_trades ORDER BY id").fetchall()]
    conn.close()
    return rows


def test_alpha_gate_blocks_entries_by_default(tmp_db, offline_universe):
    """Limited resources buy validated edge or nothing: with no cleared alpha
    study on record, the book must refuse to open positions."""
    pt.on_cycle([{"entity": "AAA", "composite": 0.5}], {"AAA": 50.0}, vols={"AAA": 0.2})
    assert _positions(tmp_db) == []
    rep = pt.report({})
    assert rep["alpha_gate"]["cleared"] is False


def test_first_rebalance_accounting(tmp_db, offline_universe):
    _clear_gate(tmp_db)
    results = [
        {"entity": "AAA", "composite": 0.20},
        {"entity": "BBB", "composite": 0.06},
        {"entity": "PENNY", "composite": 0.50},  # below liquidity floor
        {"entity": "markets", "composite": 0.5},
    ]
    quotes = {"AAA": 50.0, "BBB": 20.0, "PENNY": 2.0}
    pt.on_cycle(results, quotes, vols={"AAA": 0.2, "BBB": 0.2, "PENNY": 0.2})

    pos = {p["symbol"]: p for p in _positions(tmp_db)}
    assert "PENNY" not in pos, "liquidity floor must exclude sub-$5 names"
    assert "AAA" in pos and "BBB" in pos
    assert pos["AAA"]["qty"] * 50 > pos["BBB"]["qty"] * 20, "stronger signal gets more capital"

    conn = tmp_db.get_conn()
    state = dict(conn.execute("SELECT * FROM paper_state").fetchone())
    equity = dict(conn.execute("SELECT * FROM paper_equity ORDER BY id DESC").fetchone())
    conn.close()
    mv = sum(p["qty"] * quotes[p["symbol"]] for p in pos.values())
    assert abs(equity["equity"] - (state["cash"] + mv)) < 1.0, "equity = cash + market value"
    assert equity["equity"] < pt.CAPITAL, "slippage and commissions must cost something"
    assert equity["equity"] > pt.CAPITAL * 0.995


def test_stop_loss_fires(tmp_db):
    conn = tmp_db.get_conn()
    conn.execute("INSERT INTO paper_state (id, cash, last_rebalance) VALUES (1, 0, datetime('now'))")
    conn.execute("INSERT INTO paper_positions (symbol, qty, entry_price) VALUES ('TST', 100, 100.0)")
    conn.commit(); conn.close()

    pt.on_cycle([], {"TST": 91.0})  # -9% <= -8% stop
    assert _positions(tmp_db) == []
    sells = [t for t in _trades(tmp_db) if t["side"] == "sell"]
    assert sells and "stop-loss" in sells[0]["reason"]
    assert sells[0]["pnl"] < -890  # ~-9% on 10k plus frictions


def test_kill_switch_liquidates(tmp_db):
    conn = tmp_db.get_conn()
    conn.execute("INSERT INTO paper_state (id, cash, last_rebalance) VALUES (1, 0, datetime('now'))")
    conn.execute("INSERT INTO paper_positions (symbol, qty, entry_price) VALUES ('TST', 1000, 100.0)")
    conn.execute("INSERT INTO paper_equity (equity, cash) VALUES (120000, 0)")  # prior high
    conn.commit(); conn.close()

    pt.on_cycle([], {"TST": 100.0})  # equity 100k vs high 120k -> dd -16.7%
    assert _positions(tmp_db) == []
    assert any("kill-switch" in t["reason"] for t in _trades(tmp_db))


def test_report_shape(tmp_db):
    rep = pt.report({})
    for key in ("equity", "cash", "total_return_pct", "var_1d_95_pct",
                "class_exposures", "positions", "equity_curve", "risk_limits"):
        assert key in rep
