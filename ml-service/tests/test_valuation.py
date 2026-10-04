"""The return rule: 15% a year is the floor, 20% the target, and every input
is held down so the estimate errs low."""

import math

import valuation as v


def test_expected_return_hand_calc():
    # EPS 5, growth 10%, exit P/E 20 -> terminal 5 * 1.1^5 * 20 = 161.05
    # at price 80: (161.05/80)^(1/5) - 1 = 15.02%
    r = v.expected_return(80.0, 5.0, 0.10, 20.0)
    assert math.isclose(r, (161.051 / 80) ** 0.2 - 1, rel_tol=1e-9)
    # a dividend adds its yield at today's price
    assert math.isclose(v.expected_return(80.0, 5.0, 0.10, 20.0, dps=1.6) - r, 0.02, rel_tol=1e-9)


def test_no_earnings_means_no_estimate():
    assert v.expected_return(50.0, -1.0, 0.1, 20.0) is None
    assert v.expected_return(0.0, 5.0, 0.1, 20.0) is None
    assert v.price_for_return(0.15, 0.0, 0.1, 20.0) is None
    assert v.tier(None) is None


def test_inputs_are_capped():
    # growth: the slower record, never above the cap, never below zero
    assert v.conservative_growth(0.30, 0.40) == v.GROWTH_CAP
    assert v.conservative_growth(0.08, 0.25) == 0.08
    assert v.conservative_growth(-0.05, 0.10) == 0.0
    assert v.conservative_growth(None, None) == 0.0
    # a rich historical multiple earns no extra credit
    assert v.terminal_price(5.0, 0.1, 60.0) == v.terminal_price(5.0, 0.1, v.EXIT_PE_CAP)


def test_price_for_return_inverts_expected_return():
    for hurdle in (v.MIN_RETURN, v.TARGET_RETURN):
        for dps in (0.0, 1.2):
            px = v.price_for_return(hurdle, 5.0, 0.10, 20.0, dps)
            assert math.isclose(v.expected_return(px, 5.0, 0.10, 20.0, dps), hurdle, abs_tol=1e-6)
    # the 20% price is always below the 15% price
    assert v.price_for_return(0.20, 5.0, 0.1, 20.0) < v.price_for_return(0.15, 5.0, 0.1, 20.0)


def test_tiers():
    assert v.tier(0.149) is None
    assert v.tier(0.15) == "minimum"
    assert v.tier(0.199) == "minimum"
    assert v.tier(0.20) == "target"
