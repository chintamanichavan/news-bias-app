"""Calendars: money parsing, the season scorecard and NYSE holidays."""

from datetime import date

from terminal import calendars


def test_money():
    assert calendars.money("$4.60") == 4.6
    assert calendars.money("($0.12)") == -0.12
    assert calendars.money("$2,190,001,700,000") == 2190001700000
    assert calendars.money("N/A") is None and calendars.money("") is None and calendars.money(0.09) == 0.09


def test_earnings_rows():
    rows = calendars.parse_earnings({"data": {"rows": [{"eps": "$4.60", "surprise": "3.37", "time": "time-pre-market", "symbol": "TSM",
                                                          "name": "TSMC", "marketCap": "$2,190", "fiscalQuarterEnding": "Sep/2026",
                                                          "epsForecast": "$4.45", "noOfEsts": "6"}]}}, "2026-10-15")
    assert rows[0] == {"date": "2026-10-15", "symbol": "TSM", "name": "TSMC", "time": "before open", "quarter": "Sep/2026",
                       "eps": 4.6, "estimate": 4.45, "estimates": 6, "surprise_pct": 3.37, "market_cap": 2190.0}


def test_scorecard():
    rows = [{"symbol": "A", "eps": 1.1, "estimate": 1.0, "surprise_pct": 10.0}, {"symbol": "B", "eps": 0.9, "estimate": 1.0, "surprise_pct": -10.0},
            {"symbol": "C", "eps": 1.0, "estimate": 1.0, "surprise_pct": 0.0}, {"symbol": "Z", "eps": 1, "estimate": 1, "surprise_pct": 0}]
    card = calendars.scorecard(rows, {"A": "Tech", "B": "Tech", "C": "Tech"})
    assert card == [{"sector": "Tech", "reported": 3, "beat": 1, "met": 1, "missed": 1, "median_surprise_pct": 0.0}]


def test_easter():
    assert calendars.easter(2026) == date(2026, 4, 5)
    assert calendars.easter(2024) == date(2024, 3, 31)
    assert calendars.easter(2027) == date(2027, 3, 28)


def test_nyse_2026_holidays():
    got = {h["date"]: h["name"] for h in calendars.holidays(2026) if h["kind"] == "closed"}
    assert got == {
        "2026-01-01": "New Year's Day", "2026-01-19": "Martin Luther King Jr. Day", "2026-02-16": "Washington's Birthday",
        "2026-04-03": "Good Friday", "2026-05-25": "Memorial Day", "2026-06-19": "Juneteenth",
        "2026-07-03": "Independence Day", "2026-09-07": "Labor Day", "2026-11-26": "Thanksgiving Day", "2026-12-25": "Christmas Day",
    }
    early = {h["date"] for h in calendars.holidays(2026) if h["kind"] != "closed"}
    assert early == {"2026-11-27", "2026-12-24"}              # July 3 is the holiday itself this year


def test_saturday_new_year_is_not_made_up():
    assert "2022-01-01" not in {h["date"] for h in calendars.holidays(2022)}
    assert "2021-12-31" not in {h["date"] for h in calendars.holidays(2021)}
