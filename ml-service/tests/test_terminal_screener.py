"""Terminal step 9: the EQS screener's per-company measures."""

import pandas as pd
import pytest

from terminal import screener


def _facts(rows):
    df = pd.DataFrame(rows, columns=["tag", "unit", "period_start", "period_end", "value"])
    df["period_start"] = pd.to_datetime(df["period_start"])
    df["period_end"] = pd.to_datetime(df["period_end"])
    return df


def _year(tag, year, value, unit="USD"):
    return (tag, unit, f"{year}-01-01", f"{year}-12-31", value)


def test_measures_for_a_simple_company():
    years = range(2017, 2026)
    rows = []
    for i, y in enumerate(years):
        rows += [
            _year("EarningsPerShareDiluted", y, 2.0 + 0.2 * i, "USD/shares"),
            _year("Revenues", y, 100.0 * 1.1 ** i),
            _year("NetIncomeLoss", y, 20.0 + 2 * i),
            _year("WeightedAverageNumberOfDilutedSharesOutstanding", y, 10.0, "shares"),
            _year("PaymentsOfDividendsCommonStock", y, 5.0),
        ]
    annual = _facts(rows)
    facts = pd.concat([annual, _facts([("StockholdersEquity", "USD", None, "2025-12-31", 200.0)])])
    days = pd.bdate_range("2017-01-02", "2025-12-31")
    px = pd.DataFrame({"date": days, "close": [40.0 + 0.01 * i for i in range(len(days))]})
    row = screener.measures("TEST", annual, facts, px)
    last = px["close"].iloc[-1]
    assert row["price"] == round(last, 2)
    assert row["pe"] == round(last / 3.6, 1)
    assert row["roe"] == round(36 / 200 * 100, 1)
    assert row["margin"] == round(36 / (100 * 1.1 ** 8) * 100, 1)
    assert row["growth"] == pytest.approx(10.0, abs=0.1)
    assert row["yield"] == round(0.5 / last * 100, 2)
    assert row["mkt_cap"] == pytest.approx(last * 10)


def test_measures_need_a_price():
    assert screener.measures("X", _facts([]), _facts([]), pd.DataFrame({"date": [], "close": []})) is None


def test_incredible_returns_are_set_aside():
    assert screener.credible(None) is None
    assert screener.credible(22.3) == 22.3
    assert screener.credible(60.0) == 60.0
    assert screener.credible(13381.4) is None
