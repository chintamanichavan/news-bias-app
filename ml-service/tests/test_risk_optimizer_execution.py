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


# ── Ledoit–Wolf shrinkage + HRP ──────────────────────────────────────────────

def _synthetic_returns(t=250, n=4, seed=11):
    import numpy as np
    rng = np.random.default_rng(seed)
    common = rng.normal(0, 0.01, t)
    return np.column_stack([0.7 * common + rng.normal(0, 0.008, t) for _ in range(n)])


def test_ledoit_wolf_cov_is_valid_and_shrunk():
    import numpy as np
    rets = _synthetic_returns()
    cov, delta = risk.ledoit_wolf_cov(rets)
    assert 0.0 <= delta <= 1.0
    assert np.allclose(cov, cov.T)
    eig = np.linalg.eigvalsh(cov)
    assert eig.min() > -1e-12  # positive semi-definite
    # Diagonal must stay the sample variances (both S and F share them).
    x = rets - rets.mean(axis=0)
    s = x.T @ x / len(rets)
    assert np.allclose(np.diag(cov), np.diag(s))
    # Short histories shrink harder than long ones.
    _, delta_short = risk.ledoit_wolf_cov(rets[:60])
    assert delta_short >= delta


def test_portfolio_var_cov_matches_hand_calc():
    import numpy as np
    cov = np.array([[0.0004, 0.0], [0.0, 0.0009]])
    got = risk.portfolio_var_cov({"A": 0.5, "B": 0.5}, ["A", "B"], cov)
    want = risk.VAR_Z_95 * math.sqrt(0.25 * 0.0004 + 0.25 * 0.0009)
    assert math.isclose(got, want, rel_tol=1e-9)


def test_hrp_weights_sum_and_favor_low_variance():
    import numpy as np
    # Uncorrelated with very different variances: HRP must overweight the
    # quiet names, and weights are a full long-only allocation.
    cov = np.diag([0.0001, 0.0001, 0.0025, 0.0025])
    w = optimizer.hrp_weights(["Q1", "Q2", "L1", "L2"], cov)
    assert math.isclose(sum(w.values()), 1.0, rel_tol=1e-3)
    assert all(v > 0 for v in w.values())
    assert w["Q1"] > w["L1"] and w["Q2"] > w["L2"]


def test_optimize_accepts_cov_for_vol_target(offline_universe):
    import numpy as np
    # A hot flat-corr estimate scales the book; a near-zero true covariance
    # should leave more of it invested.
    signals = {"AAPL": 0.5, "MSFT": 0.5}
    vols = {"AAPL": 0.9, "MSFT": 0.9}
    flat = optimizer.optimize(signals, vols)
    calm_cov = (["AAPL", "MSFT"], np.diag([1e-6, 1e-6]), 0.5)
    calm = optimizer.optimize(signals, vols, cov=calm_cov)
    assert sum(calm.values()) >= sum(flat.values())
