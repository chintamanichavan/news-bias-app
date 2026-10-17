"""Commodities: positioning, crack spread, roll yield, period returns."""

import pytest

from terminal import commodities


def test_cot_net_positions():
    row = commodities.cot_row({"report_date_as_yyyy_mm_dd": "2026-10-13T00:00:00.000", "open_interest_all": "1000",
                               "noncomm_positions_long_all": "400", "noncomm_positions_short_all": "100",
                               "comm_positions_long_all": "300", "comm_positions_short_all": "600",
                               "nonrept_positions_long_all": "50", "nonrept_positions_short_all": "50",
                               "change_in_noncomm_long_all": "20", "change_in_noncomm_short_all": "-5"})
    assert row["speculators_net"] == 300 and row["commercials_net"] == -300 and row["speculators_net_pct_oi"] == 30
    assert row["speculators_change"] == 25 and row["date"] == "2026-10-13"


def test_crack_321_by_hand():
    # crude $80, gasoline $2.50/gal ($105/bbl), diesel $3.00/gal ($126/bbl): (210 + 126 - 240) / 3 = 32
    assert commodities.crack_321(80, 2.5, 3.0) == pytest.approx(32.0)


def test_roll_yield_sign():
    back = commodities.roll_yield([{"month": "Nov 26", "price": 101.0}, {"month": "Dec 26", "price": 99.0}])
    assert back["shape"] == "backwardation" and back["annual_pct"] == pytest.approx(2 / 99 * 12 * 100)
    cont = commodities.roll_yield([{"month": "Nov 26", "price": 3.0}, {"month": "Jan 27", "price": 3.3}])
    assert cont["shape"] == "contango" and cont["annual_pct"] == pytest.approx(-0.3 / 3.3 * 6 * 100)


def test_period_returns():
    bars = [{"date": "2025-12-31", "close": 100.0}, {"date": "2026-09-16", "close": 110.0}, {"date": "2026-10-16", "close": 121.0}]
    r = commodities.period_returns(bars)
    assert r["ytd"] == pytest.approx(21.0) and r["1m"] == pytest.approx(10.0)


def test_wpsr_skips_footnotes():
    text = '"STUB_1","10/9/26","10/2/26","Difference","Percent Change","10/10/25"\r\n"Crude Oil","698.560","707.117","-8.557","-1.200","831.530"\r\n"Note: SPR ..."\r\n'
    d = commodities.parse_wpsr(text)
    assert d["weeks"] == ["10/9/26", "10/2/26"] and d["rows"] == [{"item": "Crude Oil", "this_week": 698.56, "last_week": 707.117, "change": -8.557, "year_ago": 831.53}]
