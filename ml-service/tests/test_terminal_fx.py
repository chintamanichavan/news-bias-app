"""Terminal step 6: currency rates and crosses."""

from datetime import date, timedelta

import pytest

from terminal import fx


def test_strength_is_measured_against_the_dollar():
    # 0.90 -> 0.85 euros per dollar: the euro gained about 5.9%
    assert fx.strength_change(0.90, 0.85) == pytest.approx(5.882, abs=1e-3)
    assert fx.strength_change(150, 150) == 0


def test_market_convention():
    assert fx.convention("EUR", 0.8) == ("EURUSD", pytest.approx(1.25))
    assert fx.convention("JPY", 150.0) == ("USDJPY", 150.0)


def test_cross_matrix_is_consistent():
    m = fx.cross_matrix({"EUR": 0.8, "JPY": 160.0}, ["USD", "EUR", "JPY", "XXX"])
    assert m[0][1] == pytest.approx(0.8)          # 1 USD = 0.8 EUR
    assert m[1][2] == pytest.approx(200.0)        # 1 EUR = 200 JPY
    assert m[2][1] == pytest.approx(1 / 200)
    assert all(m[i][i] == pytest.approx(1) for i in range(3))
    assert m[3][0] is None and m[0][3] is None    # an unknown currency stays empty


def _series(start: date, values: list[float]):
    return [(start + timedelta(days=i), v) for i, v in enumerate(values)]


def test_currency_row_lookbacks():
    # 400 daily closes falling from 1.0 to 0.8 units per dollar
    n = 400
    values = [1.0 - 0.2 * i / (n - 1) for i in range(n)]
    s = _series(date(2025, 9, 12), values)
    row = fx.currency_row("CHF", s)
    assert row["pair"] == "USDCHF" and row["rate"] == pytest.approx(0.8)
    assert row["ch_1d"] == pytest.approx(fx.strength_change(values[-2], 0.8), abs=1e-3)
    assert row["ch_1y"] > 0 and row["ch_1m"] > 0           # franc strengthened
    assert row["ch_ytd"] is not None
    assert row["as_of"] == s[-1][0].isoformat()
    assert fx.currency_row("CHF", s[:1]) is None
