"""Terminal step 8: release calendar and economic statistics."""

import json
from datetime import date
from pathlib import Path

import pytest

from terminal import econ

FIX = Path(__file__).parent / "fixtures"


def test_bea_schedule_rows_carry_the_header_year():
    events = econ.parse_bea((FIX / "bea_schedule.html").read_text())
    assert events[0] == {"date": "2026-10-29", "time": "8:30 AM",
                         "release": "GDP (Advance Estimate), 3rd Quarter 2026", "source": "BEA"}
    assert all(e["date"].startswith("2026-") for e in events)


def test_census_rows_use_the_exact_timestamp():
    events = econ.parse_census((FIX / "census_calendar.html").read_text())
    assert len(events) >= 150
    assert all(e["date"].startswith("2026-") for e in events)
    assert any(e["time"] == "8:30 AM" for e in events) and any(e["time"] == "10:00 AM" for e in events)
    assert all("(" in e["release"] for e in events)          # period covered is kept


def test_upcoming_window_order_and_duplicates():
    ev = [
        {"date": "2026-10-29", "time": "10:00 AM", "release": "B", "source": "x"},
        {"date": "2026-10-29", "time": "8:30 AM", "release": "A", "source": "x"},
        {"date": "2026-10-29", "time": "8:30 AM", "release": "A", "source": "y"},   # same release twice
        {"date": "2026-10-10", "time": "8:30 AM", "release": "past", "source": "x"},
        {"date": "2027-03-01", "time": None, "release": "far", "source": "x"},
        {"date": "2026-11-04", "time": "8:30 AM", "release": "Trade in Goods (September 2026)", "source": "Census"},
        {"date": "2026-11-04", "time": "8:30 AM", "release": "Trade in Goods, September 2026", "source": "BEA"},
    ]
    got = econ.upcoming(ev, date(2026, 10, 16), 45)
    assert [e["release"] for e in got] == ["A", "B", "Trade in Goods (September 2026)"]


def test_fomc_events():
    assert econ.fomc_events([date(2026, 10, 28)])[0]["release"] == "FOMC rate decision"


def _payload(sid, values):
    data = [{"year": str(y), "period": f"M{m:02d}", "value": str(v)} for y, m, v in values]
    data.append({"year": "2025", "period": "M13", "value": "999"})     # annual average, ignored
    return {"Results": {"series": [{"seriesID": sid, "data": list(reversed(data))}]}}


def test_readings_by_kind():
    months = [(2025, m, 100 + m) for m in range(1, 13)] + [(2026, m, 110 + m) for m in range(1, 10)]
    cpi = econ.stats_rows(_payload("CUUR0000SA0", months))[0]
    assert cpi["period"] == "2026-09"
    assert cpi["latest"] == pytest.approx((119 / 109 - 1) * 100, abs=0.01)        # Sep vs Sep
    assert cpi["prior"] == pytest.approx((118 / 108 - 1) * 100, abs=0.01)
    jobs = econ.stats_rows(_payload("CES0000000001", months))[0]
    assert jobs["latest"] == 1 and jobs["unit"] == "thousand jobs"
    rate = econ.stats_rows(_payload("LNS14000000", months))[0]
    assert rate["latest"] == 119


def test_real_bls_answer_reads_every_series():
    rows = econ.stats_rows(json.loads((FIX / "bls_v1.json").read_text()))
    assert len(rows) == len(econ.STATS)
    by = {r["series"]: r for r in rows}
    assert by["LNS14000000"]["latest"] == 4.2 and by["LNS14000000"]["period"] == "2026-09"
    assert by["CES0000000001"]["latest"] == 29          # 159044 - 159015
    assert by["JTS000000000000000JOL"]["period"] == "2026-08"
    assert 0 < by["CUUR0000SA0"]["latest"] < 10
