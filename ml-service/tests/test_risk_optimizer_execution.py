import math

import execution
import optimizer
import risk


def test_realized_vol_floor_and_scale():
    assert risk.realized_vol([100.0] * 5) == risk.DEFAULT_VOL  # too short
    flat = [100.0 + (i % 2) * 0.0 for i in range(60)]
    assert risk.realized_vol(flat) == 0.05  # zero variance clamps to floor
    wild = [100 * (1.1 if i % 2 else 0.9) ** i for i in range(1, 40)]
    assert risk.realized_vol(wild) > 1.0


def test_portfolio_var_monotonic():
    vols = {"A": 0.2, "B": 0.2}
    small = risk.portfolio_var({"A": 0.1}, vols)
    big = risk.portfolio_var({"A": 0.5}, vols)
    two = risk.portfolio_var({"A": 0.5, "B": 0.5}, vols)
    assert 0 < small < big < two
    assert risk.portfolio_var({}, vols) == 0.0


def test_class_exposures_sum():
    exp = risk.class_exposures({"AAA": 0.3, "BBB": 0.2})
    assert math.isclose(sum(exp.values()), 0.5, rel_tol=1e-6)


def test_optimizer_caps_and_direction(offline_universe):
    w = optimizer.optimize(
        {"SPY": 0.2, "QQQ": 0.2, "BTC-USD": 0.2},
        {"SPY": 0.15, "QQQ": 0.15, "BTC-USD": 0.60},
    )
    assert all(v <= optimizer.MAX_WEIGHT + 1e-9 for v in w.values())
    assert sum(w.values()) <= 1.0 + 1e-9
    # same signal, 4x the vol -> materially less weight
    assert w["BTC-USD"] < w["SPY"]
    # crypto class cap respected
    exp = risk.class_exposures(w)
    assert exp.get("crypto", 0) <= risk.CLASS_CAPS["crypto"] + 1e-9


def test_optimizer_empty_and_negative():
    assert optimizer.optimize({}, {}) == {}
    assert optimizer.optimize({"X": -0.5}, {"X": 0.2}) == {}


def test_paper_broker_fills():
    buy = execution.broker.execute("buy", "TST", 10, 100.0)
    sell = execution.broker.execute("sell", "TST", 10, 100.0)
    assert buy.fill_price > 100.0 > sell.fill_price  # slippage against the order
    assert buy.cash_delta < -1000.0  # gross + commission
    assert sell.cash_delta < 1000.0  # commission comes out
    assert sell.cash_delta > 990.0
