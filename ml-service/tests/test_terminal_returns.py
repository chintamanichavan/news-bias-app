"""Terminal step 11: dividends, splits and returns."""

from datetime import date, timedelta

import pytest

from terminal import returns


def test_parse_history_reads_closes_dividends_and_splits():
    payload = {"chart": {"result": [{
        "meta": {"currency": "USD"},
        "timestamp": [1700000000, 1700086400, 1700172800],
        "indicators": {"quote": [{"close": [10.0, None, 11.0]}], "adjclose": [{"adjclose": [9.5, None, 11.0]}]},
        "events": {"dividends": {"1": {"date": 1700086400, "amount": 0.25}},
                   "splits": {"2": {"date": 1700000000, "numerator": 4.0, "denominator": 1.0}}},
    }]}}
    h = returns.parse_history(payload)
    assert [r[1:] for r in h["rows"]] == [(10.0, 9.5), (11.0, 11.0)]   # the day without a close is dropped
    assert h["dividends"] == [(date(2023, 11, 15), 0.25)]
    assert h["splits"][0][1:] == (4.0, 1.0) and h["currency"] == "USD"


def _rows(end: date, days: int, close0: float, close_step: float, adj_step: float):
    return [(end - timedelta(days=days - i), close0 + close_step * i, close0 + adj_step * i) for i in range(days + 1)]


def test_period_returns_split_price_and_income():
    rows = _rows(date(2026, 10, 16), 400, 100.0, 0.1, 0.12)
    p = returns.period_returns(rows)
    one = p["1y"]
    start = rows[-366]
    assert one["price_pct"] == pytest.approx((rows[-1][1] / start[1] - 1) * 100, abs=0.01)
    assert one["total_pct"] == pytest.approx((rows[-1][2] / start[2] - 1) * 100, abs=0.01)
    assert one["income_pct"] == pytest.approx(one["total_pct"] - one["price_pct"], abs=0.02)
    assert one["per_year_pct"] is not None and p["1m"]["per_year_pct"] is None
    assert p["3y"] is None and p["10y"] is None        # history too short to say
    assert p["ytd"] is not None


def test_dividend_summary_growth_streak_and_yield():
    pays = [(date(y, m, 15), 0.2 * 1.1 ** (y - 2015)) for y in range(2015, 2027) for m in (3, 6, 9, 12)
            if date(y, m, 15) <= date(2026, 10, 1)]
    s = returns.dividend_summary(pays, last_close=40.0, today=date(2026, 10, 16))
    assert s["growth_5y_pct"] == pytest.approx(10.0, abs=0.01)
    assert s["years_of_increases"] == 10                 # 2016 through 2025 each higher
    assert s["yield_pct"] == pytest.approx(sum(a for d, a in pays if (date(2026, 10, 16) - d).days <= 365) / 40 * 100, abs=0.01)
    assert s["by_year"][0]["year"] == 2015


def test_dividend_changes_and_cut_breaks_streak():
    pays = [(date(2020, 3, 1), 0.5), (date(2020, 6, 1), 0.5), (date(2020, 9, 1), 0.25), (date(2020, 12, 1), 0.30)]
    ch = returns.dividend_changes(pays)
    assert [c["change_pct"] for c in ch] == [-50.0, 20.0]
    s = returns.dividend_summary([(date(2023, 1, 1), 1.0), (date(2024, 1, 1), 2.0), (date(2025, 1, 1), 1.5)],
                                 last_close=None, today=date(2026, 1, 1))
    assert s["years_of_increases"] == 0 and s["yield_pct"] is None


def test_growth_of_100_weekly():
    rows = _rows(date(2026, 10, 16), 30, 50.0, 1.0, 1.0)
    g = returns.growth_of_100(rows, rows[0][0], total=True)
    assert g[0]["v"] == 100 and g[-1]["t"] == "2026-10-16"
    assert g[-1]["v"] == pytest.approx(80 / 50 * 100)
    assert 4 <= len(g) <= 7


def test_payments_slipping_across_new_year_are_not_a_cut():
    # a monthly payer raising 1% each January, with one payment pushed
    # from December into January: 11 payments one year, 13 the next
    pays = []
    for y in range(2020, 2026):
        amount = 0.25 * 1.01 ** (y - 2020)
        for m in range(1, 13):
            d = date(y, m, 15)
            if (y, m) == (2023, 12):
                d = date(2024, 1, 2)
            pays.append((d, amount if d.year == y else amount))
    pays.sort()
    s = returns.dividend_summary(pays, last_close=20.0, today=date(2026, 3, 1))
    totals = {r["year"]: r["total"] for r in s["by_year"]}
    assert totals[2023] < totals[2022]          # the totals alone would show a cut
    assert s["years_of_increases"] == 5          # but the rate rose every year


def test_parse_bars_keeps_every_daily_field():
    payload = {"chart": {"result": [{
        "timestamp": [1700000000, 1700086400],
        "indicators": {"quote": [{"open": [1.0, None], "high": [2.0, None], "low": [0.5, None], "close": [1.5, None], "volume": [10, None]}],
                       "adjclose": [{"adjclose": [1.4, None]}]},
    }]}}
    rows = returns.parse_bars(payload)
    assert rows == [{"date": "2023-11-14", "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5, "adj_close": 1.4, "volume": 10}]


def test_intraday_bars_are_in_exchange_time_and_skip_gaps():
    payload = {"chart": {"result": [{"meta": {"gmtoffset": -14400}, "timestamp": [1760621400, 1760621700],
               "indicators": {"quote": [{"open": [1, None], "high": [2, None], "low": [0.5, None],
                                         "close": [1.5, None], "volume": [10, None]}]}}]}}
    rows = returns.parse_intraday(payload)
    assert rows == [{"date": "2025-10-16T09:30", "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 10}]
