"""Portfolio analytics: regression, liquidity, hedge offset, French files."""

import pytest

from terminal import analytics


def test_ols_recovers_known_loadings():
    xs = [[0.01, 0.02], [-0.02, 0.01], [0.03, -0.01], [0.0, 0.02], [0.01, -0.02], [-0.01, 0.0], [0.02, 0.01], [-0.03, -0.01]]
    y = [0.001 + 1.2 * a - 0.5 * b for a, b in xs]
    fit = analytics.ols(y, xs)
    assert fit["coef"] == pytest.approx([0.001, 1.2, -0.5])
    assert fit["r2"] == pytest.approx(1.0)


def test_liquidity_and_offset():
    assert analytics.days_to_liquidate(1_000_000, 1_000_000, 0.2) == pytest.approx(5)
    assert analytics.days_to_liquidate(10, None, 0.2) is None
    assert analytics.dollar_offset([10, -5, 3], [-9, 4, -3]) == pytest.approx(-1.0)


def test_french_monthly_block_only():
    text = ("This file was created...\n\n,Mkt-RF,SMB,RF\n196307,   -0.39,   -0.48,    0.27\n196308,    5.07,   -0.80,    0.25\n\n"
            " Annual Factors: January-December \n,Mkt-RF,SMB,RF\n  1964,   12.0,  1.0, 3.0\n")
    f = analytics.parse_french(text)
    assert list(f) == ["1963-07", "1963-08"]
    assert f["1963-08"] == pytest.approx({"Mkt-RF": 0.0507, "SMB": -0.008, "RF": 0.0025})
