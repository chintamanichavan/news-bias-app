"""
Paper book — the engine's signals put on (paper) positions so they're judged
in PnL terms.

Strategy:
- Universe: securities the engine scored this cycle that also have a quote.
- Entry set: names with composite >= ENTRY_THRESHOLD and price >= MIN_PRICE.
- Sizing: optimizer.optimize — signal/vol weighting under a 25%/name cap,
  asset-class caps, and a 15% annualized portfolio vol target (remainder
  stays cash). Rebalanced at most once per REBALANCE_MIN_HOURS.
- Execution: every order routes through execution.broker (paper fills with
  slippage + commission; a live adapter implements the same interface).
- Marking: every engine cycle (15 min).

Per-trade and portfolio risk, enforced every cycle:
- Stop-loss STOP_LOSS from entry, checked at each mark.
- Signal exit below EXIT_THRESHOLD at rebalance.
- Kill-switch: drawdown beyond MAX_DRAWDOWN liquidates to cash and holds
  until drawdown recovers half way.
- report() states 1-day 95% VaR and per-class exposures (risk.py).

Prices are Yahoo's delayed quotes; this is research, not execution advice.
"""

from datetime import datetime, timezone

import db
import optimizer
import risk
import validation
from execution import broker

CAPITAL = 100_000.0
ENTRY_THRESHOLD = 0.05
EXIT_THRESHOLD = 0.0
STOP_LOSS = -0.08
MAX_DRAWDOWN = -0.15
REBALANCE_MIN_HOURS = 20
MAX_CANDIDATES = 8  # optimizer input size
# Entries only inside the configured price band (start: $1-$10, widen via
# ARTHA_PRICE_MIN/MAX). The $1 floor is the junk guard.

# Vols from the last cycle, kept for the report's VaR line.
LAST_VOLS: dict[str, float] = {}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _state(conn) -> dict:
    row = conn.execute("SELECT cash, last_rebalance FROM paper_state WHERE id = 1").fetchone()
    if row is None:
        conn.execute("INSERT INTO paper_state (id, cash, last_rebalance) VALUES (1, ?, NULL)", (CAPITAL,))
        return {"cash": CAPITAL, "last_rebalance": None}
    return dict(row)


def _positions(conn) -> list[dict]:
    return [dict(r) for r in conn.execute(
        "SELECT symbol, qty, entry_price, entry_at, entry_composite FROM paper_positions").fetchall()]


def _sell(conn, pos: dict, ref_price: float, reason: str) -> float:
    fill = broker.execute("sell", pos["symbol"], pos["qty"], ref_price)
    pnl = (fill.fill_price - pos["entry_price"]) * pos["qty"] - fill.commission
    conn.execute("DELETE FROM paper_positions WHERE symbol = ?", (pos["symbol"],))
    conn.execute(
        "INSERT INTO paper_trades (at, symbol, side, qty, price, pnl, reason) VALUES (?,?,?,?,?,?,?)",
        (_now(), pos["symbol"], "sell", pos["qty"], fill.fill_price, round(pnl, 2), reason),
    )
    return fill.cash_delta


def _buy(conn, symbol: str, qty: float, ref_price: float, composite: float, reason: str) -> float:
    fill = broker.execute("buy", symbol, qty, ref_price)
    conn.execute(
        "INSERT OR REPLACE INTO paper_positions (symbol, qty, entry_price, entry_at, entry_composite) VALUES (?,?,?,?,?)",
        (symbol, qty, fill.fill_price, _now(), composite),
    )
    conn.execute(
        "INSERT INTO paper_trades (at, symbol, side, qty, price, pnl, reason) VALUES (?,?,?,?,?,NULL,?)",
        (_now(), symbol, "buy", qty, fill.fill_price, reason),
    )
    return fill.cash_delta


def _drawdown_state(conn, equity: float) -> tuple[float, bool]:
    row = conn.execute("SELECT MAX(equity) FROM paper_equity").fetchone()
    high = max(row[0] or CAPITAL, equity, CAPITAL)
    dd = equity / high - 1
    halted_row = conn.execute(
        "SELECT reason FROM paper_trades WHERE reason LIKE 'kill-switch%' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    recently_halted = halted_row is not None and dd < MAX_DRAWDOWN / 2
    return dd, dd <= MAX_DRAWDOWN or recently_halted


def on_cycle(results: list[dict], quotes: dict[str, float],
             vols: dict[str, float] | None = None) -> None:
    """One engine cycle: stops, maybe rebalance (optimized weights), mark."""
    global LAST_VOLS
    if vols:
        LAST_VOLS = dict(vols)
    vols = vols or LAST_VOLS

    conn = db.get_conn()
    state = _state(conn)
    cash = state["cash"]

    def price_of(pos: dict) -> float:
        return quotes.get(pos["symbol"], pos["entry_price"])

    # ── Stops (every cycle) ────────────────────────────────────────────────
    for pos in _positions(conn):
        p = quotes.get(pos["symbol"])
        if p is not None and p / pos["entry_price"] - 1 <= STOP_LOSS:
            cash += _sell(conn, pos, p, f"stop-loss {STOP_LOSS:.0%}")

    # ── Equity + kill-switch ───────────────────────────────────────────────
    equity = cash + sum(price_of(p) * p["qty"] for p in _positions(conn))
    dd, halted = _drawdown_state(conn, equity)
    if halted:
        for pos in _positions(conn):
            cash += _sell(conn, pos, price_of(pos), f"kill-switch dd {dd:.1%}")
        equity = cash

    # ── Rebalance (daily) ──────────────────────────────────────────────────
    due = True
    if state["last_rebalance"]:
        try:
            last = datetime.fromisoformat(str(state["last_rebalance"]).replace(" ", "T"))
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            due = (datetime.now(timezone.utc) - last).total_seconds() > REBALANCE_MIN_HOURS * 3600
        except ValueError:
            due = True

    # The alpha gate: no NEW capital until a study has cleared the
    # trials-adjusted hurdle. Exits, stops and the kill-switch still run.
    gate = validation.alpha_gate()

    if due and not halted and gate["cleared"]:
        by_symbol = {r["entity"]: r for r in results
                     if r["entity"] not in ("markets", "weather") and r["entity"] in quotes}
        import universe as _u
        candidates = sorted(
            (r for r in by_symbol.values()
             if r["composite"] >= ENTRY_THRESHOLD and _u.in_band(quotes[r["entity"]])),
            key=lambda r: -r["composite"],
        )[:MAX_CANDIDATES]

        target_weights = optimizer.optimize(
            {c["entity"]: c["composite"] for c in candidates},
            {c["entity"]: vols.get(c["entity"], risk.DEFAULT_VOL) for c in candidates},
        )

        # Exits: dropped from the target book, or signal flipped negative
        for pos in _positions(conn):
            comp = by_symbol.get(pos["symbol"], {}).get("composite")
            if pos["symbol"] not in target_weights or (comp is not None and comp < EXIT_THRESHOLD):
                cash += _sell(conn, pos, price_of(pos), "rebalance exit")

        # Entries at optimizer weight (existing positions keep their size —
        # enter/exit only, which keeps turnover and slippage honest)
        held = {p["symbol"] for p in _positions(conn)}
        equity = cash + sum(price_of(p) * p["qty"] for p in _positions(conn))
        for sym, w in sorted(target_weights.items(), key=lambda kv: -kv[1]):
            if sym in held:
                continue
            price = quotes[sym]
            budget = min(w * equity, cash)
            qty = round(budget / price, 4)
            if qty * price < 100:
                continue
            comp = by_symbol[sym]["composite"]
            cash += _buy(conn, sym, qty, price, comp, f"signal {comp:+.2f} w={w:.0%}")
        conn.execute("UPDATE paper_state SET last_rebalance = ? WHERE id = 1", (_now(),))
    elif due and not halted:
        # Gate closed: still consume the rebalance slot so exits fire on
        # signal decay, but no entries.
        for pos in _positions(conn):
            comp = next((r["composite"] for r in results if r["entity"] == pos["symbol"]), None)
            if comp is not None and comp < EXIT_THRESHOLD:
                cash += _sell(conn, pos, price_of(pos), "signal exit (gate closed)")
        conn.execute("UPDATE paper_state SET last_rebalance = ? WHERE id = 1", (_now(),))

    # ── Persist ────────────────────────────────────────────────────────────
    equity = cash + sum(price_of(p) * p["qty"] for p in _positions(conn))
    conn.execute("UPDATE paper_state SET cash = ? WHERE id = 1", (cash,))
    conn.execute("INSERT INTO paper_equity (taken_at, equity, cash) VALUES (?,?,?)",
                 (_now(), round(equity, 2), round(cash, 2)))
    conn.commit()
    conn.close()


def held_symbols() -> list[str]:
    conn = db.get_conn()
    syms = [r[0] for r in conn.execute("SELECT symbol FROM paper_positions").fetchall()]
    conn.close()
    return syms


def report(quotes: dict[str, float] | None = None) -> dict:
    """Everything the PnL panel needs: book, curve, trades, risk stats."""
    quotes = quotes or {}
    conn = db.get_conn()
    state = _state(conn)

    positions = []
    for pos in _positions(conn):
        last = quotes.get(pos["symbol"])
        mv = (last or pos["entry_price"]) * pos["qty"]
        upnl = (last - pos["entry_price"]) * pos["qty"] if last is not None else 0.0
        positions.append({
            **pos, "last": last, "market_value": round(mv, 2),
            "unrealized_pnl": round(upnl, 2),
            "unrealized_pct": round(upnl / (pos["entry_price"] * pos["qty"]) * 100, 2)
                if pos["entry_price"] else 0.0,
        })

    curve = [dict(r) for r in conn.execute(
        "SELECT taken_at, equity, cash FROM paper_equity ORDER BY id").fetchall()][-800:]
    trades = [dict(r) for r in conn.execute(
        "SELECT at, symbol, side, qty, price, pnl, reason FROM paper_trades ORDER BY id DESC LIMIT 20").fetchall()]

    equity = curve[-1]["equity"] if curve else CAPITAL
    high = max((c["equity"] for c in curve), default=CAPITAL)
    closed = [t for t in trades if t["pnl"] is not None]
    wins = sum(1 for t in closed if t["pnl"] > 0)
    exposure = sum(p["market_value"] for p in positions)

    weights = {p["symbol"]: p["market_value"] / equity for p in positions if equity}
    var_pct = risk.portfolio_var(weights, LAST_VOLS) * 100

    conn.close()
    return {
        "alpha_gate": validation.alpha_gate(),
        "capital": CAPITAL,
        "equity": round(equity, 2),
        "cash": round(state["cash"], 2),
        "total_return_pct": round((equity / CAPITAL - 1) * 100, 3),
        "max_drawdown_pct": round((equity / high - 1) * 100, 3) if high else 0.0,
        "exposure_pct": round(exposure / equity * 100, 1) if equity else 0.0,
        "hit_rate": round(wins / len(closed), 2) if closed else None,
        "var_1d_95_pct": round(var_pct, 2),
        "var_1d_95_usd": round(var_pct / 100 * equity, 0),
        "class_exposures": risk.class_exposures(weights),
        "positions": positions,
        "equity_curve": curve,
        "recent_trades": trades,
        "risk_limits": {
            "target_vol": optimizer.TARGET_VOL, "max_weight": optimizer.MAX_WEIGHT,
            "class_caps": risk.CLASS_CAPS, "stop_loss": STOP_LOSS,
            "kill_switch_drawdown": MAX_DRAWDOWN,
            "slippage_bps": 5.0, "commission": 1.0,
            "price_band": __import__("universe").price_band(),
        },
    }
