import math

import options


def test_call_value_matches_textbook():
    # Hull's example: S=42, K=40, r=10%, vol=20%, six months -> 4.76
    assert math.isclose(options.call_value(42, 40, 0.5, 0.10, 0.20), 4.76, abs_tol=0.01)


def test_implied_vol_round_trip():
    p = options.call_value(100, 110, 0.25, 0.04, 0.35)
    assert math.isclose(options.implied_vol(p, 100, 110, 0.25, 0.04), 0.35, abs_tol=1e-6)


def test_implied_vol_below_intrinsic_is_nan():
    assert math.isnan(options.implied_vol(5.0, 100, 90, 0.25, 0.04))
