"""Terminal step 20: paper fills, positions and trade cost analysis."""

import pytest

from terminal import store, trading


@pytest.fixture(autouse=True)
def tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "PATH", tmp_path / "terminal.db")


Q = {"price": 100.0, "bid": 99.9, "ask": 100.1}


def test_market_orders_cross_the_spread():
    assert trading.market_fill("buy", Q) == 100.1
    assert trading.market_fill("sell", Q) == 99.9
    wide = {"price": 100.0, "bid": 90.0, "ask": 110.0}       # a stale after-hours quote
    assert trading.market_fill("buy", wide) == 100.0
    assert trading.midpoint(wide) == 100.0 and trading.midpoint(Q) == pytest.approx(100.0)


def test_limit_orders_fill_only_when_reached():
    assert trading.limit_fill("buy", 99.0, Q) is None
    assert trading.limit_fill("buy", 101.0, Q) == 100.1          # better than the limit
    assert trading.limit_fill("sell", 101.0, Q) is None
    assert trading.limit_fill("sell", 99.0, Q) == 99.9


def test_slippage_sign_and_vwap():
    assert trading.slippage_bps("buy", 100.1, 100.0) == pytest.approx(10.0)
    assert trading.slippage_bps("sell", 99.9, 100.0) == pytest.approx(10.0)
    assert trading.slippage_bps("sell", 100.2, 100.0) == pytest.approx(-20.0)   # sold above: a gain
    assert trading.vwap([(10.0, 100), (20.0, 300)]) == pytest.approx(17.5)
    assert trading.vwap([]) is None


def _o(i, side, qty, price, at):
    return {"id": i, "symbol": "AAA", "side": side, "quantity": qty, "fill_price": price, "filled_at": at}


def test_paper_positions_average_cost_and_realized():
    p = trading.paper_positions([
        _o(1, "buy", 10, 100.0, "2026-10-01"),
        _o(2, "buy", 10, 110.0, "2026-10-02"),
        _o(3, "sell", 5, 120.0, "2026-10-03"),
    ])[0]
    assert p["quantity"] == 15 and p["cost"] == pytest.approx(105.0)
    assert p["realized"] == pytest.approx(5 * 15.0)
    flat = trading.paper_positions([_o(1, "buy", 10, 100.0, "a"), _o(2, "sell", 10, 90.0, "b")])[0]
    assert flat["quantity"] == 0 and flat["realized"] == pytest.approx(-100.0)
    flipped = trading.paper_positions([_o(1, "buy", 10, 100.0, "a"), _o(2, "sell", 15, 110.0, "b")])[0]
    assert flipped["quantity"] == -5 and flipped["cost"] == 110.0 and flipped["realized"] == pytest.approx(100.0)


def test_orders_store_and_cancel_only_working():
    a = store.add_order({"symbol": "aaa", "side": "buy", "quantity": 1, "type": "limit", "limit_price": 1.0, "status": "working"})
    assert store.cancel_order(a) is True
    assert store.cancel_order(a) is False
    b = store.add_order({"symbol": "AAA", "side": "buy", "quantity": 1, "type": "limit", "limit_price": 1.0, "status": "working"})
    store.fill_order(b, 0.99)
    store.fill_order(b, 0.50)                                    # filling twice changes nothing
    filled = next(o for o in store.orders() if o["id"] == b)
    assert filled["status"] == "filled" and filled["fill_price"] == 0.99


def test_fill_day_is_the_exchange_day():
    new_york = -4 * 3600
    assert trading.local_day("2026-10-17T03:13:16+00:00", new_york) == "2026-10-16"
    assert trading.local_day("2026-10-16T14:00:00+00:00", new_york) == "2026-10-16"


def test_a_weekend_fill_uses_fridays_session():
    sessions = {"2026-10-15", "2026-10-16"}
    assert trading.session_for("2026-10-17", sessions) == "2026-10-16"
    assert trading.session_for("2026-10-15", sessions) == "2026-10-15"
    assert trading.session_for("2026-10-01", sessions) is None
