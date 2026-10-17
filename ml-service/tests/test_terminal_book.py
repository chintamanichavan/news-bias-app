"""Terminal step 19: holdings, risk and attribution."""

from datetime import date, timedelta

import pytest

from terminal import book, store


@pytest.fixture(autouse=True)
def tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "PATH", tmp_path / "terminal.db")


def test_holdings_replace_and_add():
    store.replace_holdings([{"symbol": "aapl", "quantity": 10, "cost": 150.0}, {"symbol": "KO", "quantity": 5}])
    assert [(h["symbol"], h["quantity"], h["cost"]) for h in store.holdings()] == [("AAPL", 10, 150.0), ("KO", 5, None)]
    store.replace_holdings([{"symbol": "MSFT", "quantity": 1}])
    assert [h["symbol"] for h in store.holdings()] == ["MSFT"]


def test_positions_merge_lots_and_weight_by_exposure():
    lots = [{"symbol": "A", "quantity": 10, "cost": 10.0}, {"symbol": "A", "quantity": 10, "cost": 20.0},
            {"symbol": "B", "quantity": -5, "cost": 40.0}, {"symbol": "C", "quantity": 3, "cost": None}]
    rows = {r["symbol"]: r for r in book.positions(lots, {"A": 30.0, "B": 40.0, "C": 100.0})}
    assert rows["A"]["quantity"] == 20 and rows["A"]["gain"] == 20 * 30 - 300
    assert rows["B"]["value"] == -200 and rows["B"]["gain"] == 0
    assert rows["C"]["gain"] is None                       # no cost given
    gross = 600 + 200 + 300
    assert rows["A"]["weight"] == pytest.approx(600 / gross) and rows["B"]["weight"] == pytest.approx(-200 / gross)


def _rows(start: date, adj: list[float]):
    return [(start + timedelta(days=i), a, a) for i, a in enumerate(adj)]


def test_returns_book_and_beta():
    start = date(2026, 1, 1)
    a = book.daily_returns(_rows(start, [100, 110, 99]))
    assert a[start + timedelta(days=1)] == pytest.approx(0.10)
    b = {d: 2 * r for d, r in a.items()}
    rets = book.book_returns({"A": 0.5, "B": 0.5}, {"A": a, "B": b})
    assert [r for _, r in rets] == pytest.approx([0.15, -0.15])
    market = {d: r for d, r in a.items()}
    many = {start + timedelta(days=i): (0.01 if i % 2 else -0.01) * (1 + i / 100) for i in range(60)}
    assert book.beta([(d, 2 * r) for d, r in many.items()], many) == pytest.approx(2.0)
    assert book.beta([], market) is None


def test_var_drawdown_and_volatility():
    rets = [0.01] * 90 + [-0.05] * 5 + [-0.10] * 5
    var95, es95 = book.value_at_risk(rets, 0.95)
    assert var95 == pytest.approx(0.10) and es95 == pytest.approx(0.10)
    var90, _ = book.value_at_risk(rets, 0.90)
    assert var90 == pytest.approx(0.05)
    assert book.value_at_risk(rets[:10], 0.95) is None
    assert book.max_drawdown([0.1, -0.5, 0.2]) == pytest.approx(-0.5)
    assert book.volatility([0.01] * 30) == pytest.approx(0.0)


def test_window_return_needs_history_back_to_the_start():
    rows = _rows(date(2020, 1, 1), [100 + i for i in range(100)])
    assert book.window_return(rows, date(2020, 1, 10), date(2020, 2, 9)) == pytest.approx(139 / 109 - 1)
    assert book.window_return(rows, date(2019, 6, 1), date(2020, 2, 1)) is None


def test_brinson_effects_sum_to_excess_return():
    port = {"Tech": (0.6, 0.20), "Energy": (0.4, -0.05)}
    bench = {"Tech": (0.4, 0.15), "Energy": (0.1, 0.02), "Health": (0.5, 0.05)}
    effects = book.brinson(port, bench)
    rp = 0.6 * 0.20 + 0.4 * -0.05
    rb = 0.4 * 0.15 + 0.1 * 0.02 + 0.5 * 0.05
    total = sum(e["allocation"] + e["selection"] + e["interaction"] for e in effects)
    assert total == pytest.approx(rp - rb)
    health = next(e for e in effects if e["sector"] == "Health")
    assert health["selection"] == 0 and health["port_return"] is None
