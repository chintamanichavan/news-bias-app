"""The return rule: 15% a year is the floor, 20% the target, and every input
is held down so the estimate errs low."""

import math

import pytest

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


def test_base_eps_ignores_a_windfall_year():
    # one huge year must not set the price: the three-year average is lower
    assert math.isclose(v.base_eps([2.0, 2.2, 2.1, 9.0]), (2.2 + 2.1 + 9.0) / 3)
    # a falling business is valued on where it is now, not where it was
    assert v.base_eps([5.0, 4.0, 3.0]) == 3.0
    # losses on either measure: nothing to value
    assert v.base_eps([1.0, -6.0, 1.0]) is None
    assert v.base_eps([2.0, 2.0, -0.5]) is None
    assert v.base_eps([]) is None


def test_growth_takes_the_slowest_record():
    assert v.conservative_growth(0.12, 0.04, 0.20) == 0.04
    assert v.conservative_growth(0.12, None, 0.20) == 0.12
    assert v.cagr(100.0, 121.0, 2) == pytest.approx(0.10)
    assert v.cagr(-1.0, 5.0, 3) is None


def test_an_incredible_return_is_not_a_tier():
    assert v.tier(v.MAX_CREDIBLE) == "target"
    assert v.tier(v.MAX_CREDIBLE + 0.01) is None
