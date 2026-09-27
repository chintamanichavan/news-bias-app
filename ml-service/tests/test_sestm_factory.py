"""Phases 3–5: SESTM learns direction from synthetic supervised pairs, the
factory's feature panel cannot leak the future, and the Nautilus bridge
imports (its full run needs PIT bars, exercised as an integration check)."""

import numpy as np
import pandas as pd
import pytest

import alpha_factory
import sestm


UP_WORDS = [f"up{c}" for c in "abcdefghijklm"] + ["growth", "record"]
DOWN_WORDS = [f"dn{c}" for c in "abcdefghijklm"] + ["lawsuit", "probe"]
FILLER = [f"noise{i}" for i in range(40)]


def _synthetic_pairs(n=500, seed=3):
    """A 30-term directional vocabulary plus noise — big enough to clear the
    production screening floor, unambiguous enough to test direction."""
    rng = np.random.default_rng(seed)
    pairs = []
    for _ in range(n):
        up = rng.random() < 0.5
        side = UP_WORDS if up else DOWN_WORDS
        toks = list(rng.choice(side, 4)) + list(rng.choice(FILLER, 3)) + ["shares"]
        ret = float(rng.normal(0.01 if up else -0.01, 0.005))
        pairs.append((toks, ret))
    return pairs


def test_sestm_learns_direction():
    model = sestm._train_on_pairs(_synthetic_pairs())
    assert "error" not in model
    up = sestm.score("record growth this quarter", model)
    down = sestm.score("lawsuit probe widens", model)
    off_topic = sestm.score("the weather was pleasant in lisbon", model)
    assert up is not None and down is not None
    assert up > 0 > down
    assert off_topic is None, "SESTM must abstain off-topic instead of guessing"


def _synthetic_prices(symbols=6, days=200, seed=11):
    rng = np.random.default_rng(seed)
    frames = []
    dates = pd.bdate_range("2025-01-01", periods=days)
    for i in range(symbols):
        close = 100 * np.cumprod(1 + rng.normal(0.0004, 0.015, days))
        frames.append(pd.DataFrame({
            "symbol": f"S{i}", "date": dates,
            "open": close * (1 + rng.normal(0, 0.002, days)),
            "high": close * 1.01, "low": close * 0.99,
            "close": close, "volume": rng.integers(1e5, 1e6, days).astype(float),
        }))
    return pd.concat(frames, ignore_index=True)


def test_factory_features_no_lookahead():
    px = _synthetic_prices()
    panel = alpha_factory.build_features(px)
    assert not panel.empty
    one = panel[panel.symbol == "S0"].sort_values("date")
    g = px[px.symbol == "S0"].sort_values("date").reset_index(drop=True)
    closes = g.set_index("date")["close"]

    # the label really is the forward HORIZON return…
    row = one.iloc[10]
    dates = list(closes.index)
    i = dates.index(row["date"])
    expected = closes.iloc[i + alpha_factory.HORIZON] / closes.iloc[i] - 1
    assert abs(row["label"] - expected) < 1e-9

    # …and the last HORIZON days can carry no label at all
    assert one["date"].max() <= dates[-alpha_factory.HORIZON - 1]

    # a feature at date t is unchanged by mutating strictly-future closes
    g2 = g.copy()
    g2.loc[g2.index[-1], "close"] = 1e6  # absurd future value
    panel2 = alpha_factory.build_features(
        pd.concat([g2, px[px.symbol != "S0"]], ignore_index=True))
    two = panel2[panel2.symbol == "S0"].sort_values("date")
    early_cols = [c for c in one.columns if c not in ("label",)]
    a = one[one.date == row["date"]][early_cols].reset_index(drop=True)
    b = two[two.date == row["date"]][early_cols].reset_index(drop=True)
    pd.testing.assert_frame_equal(a, b)


def test_nautilus_importable():
    bridge = pytest.importorskip("nautilus_bridge")
    assert callable(bridge.run_parity_backtest)


# ── Triple-barrier labels (López de Prado ch. 3) ────────────────────────────

import math  # noqa: E402

def test_triple_barrier_first_touch_and_vertical():
    import numpy as np
    import pandas as pd
    import alpha_factory as af

    # 30 warm-up bars establish sigma, then a +30% spike on the next bar:
    # the label at the eve of the spike must be the touch return, not the
    # fixed-horizon endpoint (which drifts back down).
    rng = np.random.default_rng(3)
    calm = 100 * np.cumprod(1 + rng.normal(0, 0.005, 30))
    path = np.concatenate([calm, [calm[-1] * 1.30], [calm[-1] * 1.02] * af.HORIZON])
    labels = af.triple_barrier_labels(pd.Series(path))
    assert math.isclose(labels.iloc[29], 0.30, rel_tol=1e-9)

    # A quiet drift never touches a barrier: the vertical (fixed-horizon)
    # label applies.
    quiet = pd.Series(100 * np.cumprod(1 + rng.normal(0, 0.004, 60)))
    lq = af.triple_barrier_labels(quiet)
    i = 30
    expected = quiet.iloc[i + af.HORIZON] / quiet.iloc[i] - 1
    sigma = quiet.pct_change().rolling(20).std().iloc[i] * math.sqrt(af.HORIZON)
    if abs(expected) < 2.0 * sigma:  # guard: only assert when no touch occurred
        assert math.isclose(lq.iloc[i], expected, rel_tol=1e-9)
