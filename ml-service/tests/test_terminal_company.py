"""Terminal step 10: company sections from a saved Yahoo summary for Apple."""

import json
from pathlib import Path

import pytest

from terminal import company

QS = json.loads((Path(__file__).parent / "fixtures" / "qs_aapl.json").read_text())


def test_raw_values_and_dates():
    assert company.raw({"raw": 1.5, "fmt": "1.50"}) == 1.5
    assert company.raw(7) == 7
    assert company.day({"raw": 1759190400}) == "2025-09-30"
    assert company.day("2026-11-02T00:00:00") == "2026-11-02"
    assert company.pct({"raw": 0.0452}) == 4.52
    assert company.pct(None) is None


def test_estimates_four_periods():
    rows = company.estimates(QS)
    assert [r["period"] for r in rows] == ["This quarter", "Next quarter", "This year", "Next year"]
    q = rows[0]
    assert q["eps_avg"] == pytest.approx(1.97842) and q["analysts"] == 27
    assert q["eps_low"] <= q["eps_avg"] <= q["eps_high"]
    assert q["revenue_growth_pct"] == pytest.approx(10.89)


def test_earnings_history_and_years():
    e = company.earnings(QS)
    assert e["quarters"][0] == {"quarter_end": "2025-09-30", "actual": 1.85, "estimate": pytest.approx(1.76993),
                                "surprise_pct": 4.52}
    assert e["years"][0]["year"] == 2022 and e["years"][0]["revenue"] == 394328000000


def test_events():
    ev = company.events(QS)
    assert ev["earnings_dates"] == ["2026-11-02"]
    assert ev["earnings_date_is_estimate"] is False


def test_analysts():
    a = company.analysts(QS)
    assert a["targets"] == {"low": 215.0, "mean": pytest.approx(329.3759), "median": 340.0, "high": 405.0}
    assert a["opinions"] == 39 and a["rating"] == "buy"
    assert a["trend"][0] == {"period": "0m", "strongBuy": 6, "buy": 19, "hold": 13, "sell": 3, "strongSell": 3}
    assert len(a["changes"]) == 25 and a["changes"][0]["firm"] == "JP Morgan"
    assert a["changes"][0]["target"] == 360.0 and a["changes"][0]["prior_target"] == 340.0


def test_management_short_interest_holders_ownership():
    m = company.management(QS)
    assert m["officers"][0]["name"] == "Mr. Timothy D. Cook" and m["officers"][0]["pay"] == 16759518
    assert m["governance"]["overallRisk"] == 1
    si = company.short_interest(QS)
    assert si["shares_short"] == 120763539 and si["pct_of_float"] == 0.83
    assert si["change_pct"] == pytest.approx((120763539 / 139749097 - 1) * 100, abs=0.01)
    h = company.holders(QS)
    assert h["institutions"][0]["holder"] == "Blackrock Inc." and h["institutions"][0]["pct"] == 7.97
    assert len(h["funds"]) == 10
    o = company.ownership(QS)
    assert o["split"]["institutions_pct"] == pytest.approx(66.35)
    assert o["trades"][0]["name"] == "NEWSTEAD JENNIFER" and o["insider_six_months"]["buys"] == 12


def test_every_section_is_none_on_an_empty_summary():
    out = company.cut({})
    assert out["name"] is None
    assert all(out[s] is None for s in company.SECTIONS)
