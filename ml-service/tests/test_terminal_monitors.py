"""Monitors: moves in standard deviations, calendar returns, FX sessions, halts."""

import pytest

from terminal import monitors


def test_z_move():
    closes = [100.0]
    for i in range(80):
        closes.append(closes[-1] * (1.01 if i % 2 else 0.99))
    closes.append(closes[-1] * 1.03)
    z = monitors.z_move(closes)
    assert z["change_pct"] == pytest.approx(3.0)
    assert z["z"] == pytest.approx(3.0 / z["sd_pct"]) and 2.8 < z["z"] < 3.1


def test_calendar_returns_use_each_years_last_close():
    rows = [{"date": "2024-12-31", "close": 100}, {"date": "2025-06-30", "close": 90}, {"date": "2025-12-31", "close": 110},
            {"date": "2026-03-31", "close": 121}]
    assert monitors.calendar_returns(rows) == {2025: pytest.approx(10.0), 2026: pytest.approx(10.0)}


def test_sessions_by_utc_hour():
    # a London bar at 09:00 local in summer (UTC+1) is 08:00 UTC: Europe
    assert monitors.session_of("2026-10-16T09:00", 1) == "Europe"
    assert monitors.session_of("2026-10-16T02:30", 0) == "Asia"
    assert monitors.session_of("2026-10-16T22:00", 0) is None


def test_halts_feed():
    xml = ('<?xml version="1.0"?><rss xmlns:ndaq="http://www.nasdaqtrader.com/"><channel><item>'
           '<ndaq:HaltDate>10/16/2026</ndaq:HaltDate><ndaq:HaltTime>10:01:02</ndaq:HaltTime><ndaq:IssueSymbol>ABCD</ndaq:IssueSymbol>'
           '<ndaq:IssueName>Abcd Inc</ndaq:IssueName><ndaq:Market>NASDAQ</ndaq:Market><ndaq:ReasonCode>LUDP</ndaq:ReasonCode>'
           '</item></channel></rss>')
    h = monitors.parse_halts(xml)[0]
    assert h["symbol"] == "ABCD" and h["reason"] == "LUDP" and h["halt_time"] == "10:01:02"
