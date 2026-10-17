"""Terminal step 5: yield curve, money markets, fed funds path."""

import json
from datetime import date
from pathlib import Path

import pytest

from terminal import rates

FIX = Path(__file__).parent / "fixtures"


def test_treasury_csv_oldest_first_with_labels():
    rows = rates.parse_treasury_csv((FIX / "treasury_2026_head.csv").read_text())
    assert len(rows) == 5
    assert rows == sorted(rows, key=lambda r: r["date"])
    latest = rows[-1]
    assert latest["date"] == date(2026, 10, 16)
    assert latest["yields"]["10Y"] == 5.09 and latest["yields"]["1M"] == 4.12
    assert "1.5 Month" not in latest["yields"]          # not a tenor we chart


def _row(day, ten_y, two_y=4.0, three_m=4.2):
    return {"date": day, "yields": {"3M": three_m, "2Y": two_y, "10Y": ten_y, "5Y": 4.1, "30Y": 4.6}}


def test_curve_view_compares_to_earlier_dates_and_spreads():
    rows = [_row(date(2025, 10, 10), 4.0), _row(date(2026, 9, 15), 4.5),
            _row(date(2026, 10, 9), 4.8), _row(date(2026, 10, 16), 5.0)]
    v = rates.curve_view(rows)
    assert [c["label"] for c in v["curves"]] == ["Latest", "1 week ago", "1 month ago", "1 year ago"]
    assert [c["date"] for c in v["curves"]] == ["2026-10-16", "2026-10-09", "2026-09-15", "2025-10-10"]
    assert v["spreads"] == {"3M10Y_bp": 80, "2Y10Y_bp": 100, "5Y30Y_bp": 50}
    assert rates.curve_view([])["curves"] == []


def test_on_or_before_skips_weekends():
    rows = [_row(date(2026, 10, 9), 1), _row(date(2026, 10, 12), 2)]
    assert rates.on_or_before(rows, date(2026, 10, 11))["date"] == date(2026, 10, 9)
    assert rates.on_or_before(rows, date(2026, 10, 1)) is None


def test_nyfed_rates_and_target_range():
    got = rates.parse_nyfed(json.loads((FIX / "nyfed_latest.json").read_text()))
    assert got["rates"]["EFFR"]["rate"] == 3.88
    assert got["target"] == {"low": 3.75, "high": 4.0}
    assert set(got["rates"]) <= {"EFFR", "OBFR", "SOFR", "BGCR", "TGCR"}
    assert "SOFRAI" not in got["rates"]


def test_fomc_dates_from_the_fed_page():
    days = rates.parse_fomc((FIX / "fomc_text.txt").read_text())
    assert date(2026, 10, 28) in days and date(2026, 12, 9) in days
    assert date(2024, 5, 1) in days                      # "April/May 30-1"
    assert len([d for d in days if d.year == 2027]) == 8  # the stray 2028 date is dropped
    assert days == sorted(days)


def test_futures_symbols_and_months():
    assert rates.zq_symbol(2026, 10) == "ZQV26.CBT"
    assert rates.zq_symbol(2027, 1) == "ZQF27.CBT"
    assert rates.months_ahead(date(2026, 11, 3), 3) == [(2026, 11), (2026, 12), (2027, 1)]


def test_implied_path_two_cuts():
    # Oct 28 is in the last week of October, so November's average is the
    # rate after it; December's meeting on the 9th splits the month 9 / 22.
    nov_after, dec_after = 4.08, 3.83
    dec_avg = (9 * nov_after + 22 * dec_after) / 31
    prices = {(2026, 10): 95.75, (2026, 11): 100 - nov_after, (2026, 12): 100 - dec_avg}
    path = rates.implied_path(date(2026, 10, 16), 4.33, prices,
                              [date(2026, 9, 16), date(2026, 10, 28), date(2026, 12, 9)])
    assert [p["meeting"] for p in path] == ["2026-10-28", "2026-12-09"]
    assert path[0]["rate_after"] == pytest.approx(4.08, abs=1e-3)
    assert path[0]["change_bp"] == pytest.approx(-25, abs=0.1)
    assert path[1]["rate_after"] == pytest.approx(3.83, abs=1e-3)
    assert path[1]["since_today_bp"] == pytest.approx(-50, abs=0.1)
    assert path[1]["moves_priced"] == pytest.approx(-2, abs=0.01)


def test_implied_path_ignores_meetings_already_held():
    path = rates.implied_path(date(2026, 10, 30), 4.0, {(2026, 10): 96.0, (2026, 11): 96.0},
                              [date(2026, 10, 28)])
    assert path == []


def test_implied_path_stops_where_it_cannot_read():
    # Oct 27 leaves four days and there is no November contract
    path = rates.implied_path(date(2027, 9, 20), 4.5, {(2027, 9): 95.5, (2027, 10): 95.6},
                              [date(2027, 10, 27)])
    assert path == []
