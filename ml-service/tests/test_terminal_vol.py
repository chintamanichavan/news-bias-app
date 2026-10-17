"""Terminal step 14: term structure, skew, surface and realized volatility."""

import math
from datetime import date, timedelta

import pytest

from terminal import options, vol


def _chain(vol_of, s=100.0, t=0.25, r=0.04, q=0.0):
    rows = []
    for k in range(70, 131, 2):
        row = {"strike": float(k)}
        for kind, key in (("C", "call"), ("P", "put")):
            sigma = vol_of(k / s)
            g = options.greeks(kind, s, k, t, r, q, sigma)
            row[key] = {"iv": sigma, "bid": 0.5, "delta": g["delta"], "volume": 10, "open_interest": 100}
        rows.append(row)
    return {"spot": s, "years": t, "rate": r, "dividend_yield": q, "rows": rows}


def test_flat_volatility_has_no_skew():
    ch = _chain(lambda m: 0.25)
    atm = vol.at_the_money(ch)
    assert atm == pytest.approx(0.25)
    sk = vol.skew_25(vol.smile(ch), atm)
    assert sk["risk_reversal"] == pytest.approx(0.0, abs=1e-9)
    assert sk["butterfly"] == pytest.approx(0.0, abs=1e-9)


def test_put_skew_shows_as_a_negative_risk_reversal():
    ch = _chain(lambda m: 0.25 - 0.3 * math.log(m))     # dearer volatility on low strikes
    points = vol.smile(ch)
    assert all((p["delta"] < 0) == (p["strike"] < 101) for p in points)   # puts below, calls above
    sk = vol.skew_25(points, vol.at_the_money(ch))
    assert sk["put_25d"] > sk["call_25d"] and sk["risk_reversal"] < 0


def test_smile_skips_contracts_without_a_bid():
    ch = _chain(lambda m: 0.25)
    for row in ch["rows"]:
        row["put"]["bid"] = 0.0
    assert all(p["delta"] > 0 for p in vol.smile(ch))


def test_interpolate_and_variance_in_time():
    assert vol.interpolate([(0, 0), (10, 100)], 2.5) == 25
    assert vol.interpolate([(0, 0), (10, 100)], 11) is None
    term = [(10, 0.2), (40, 0.3)]
    var30 = 0.04 * 10 + (0.09 * 40 - 0.04 * 10) * (20 / 30)
    assert vol.iv_at_days(term, 30) == pytest.approx(math.sqrt(var30 / 30))
    assert vol.iv_at_days(term, 5) is None


def test_pick_expiries():
    now = 0
    listed = [d * 86400 for d in (2, 5, 9, 16, 30, 33, 61, 95, 182, 270, 371, 730)]
    got = [round(e / 86400) for e in vol.pick_expiries(listed, now)]
    assert got == [5, 16, 30, 61, 95, 182, 270, 371]


def test_realized_volatility():
    flat = [100 * 1.001 ** i for i in range(40)]
    assert vol.realized(flat, 30) == pytest.approx(0.0, abs=1e-9)
    alternating = [100 * (1.01 if i % 2 else 1.0) for i in range(40)]
    assert vol.realized(alternating, 30) == pytest.approx(math.log(1.01) * math.sqrt(30 / 29) * math.sqrt(252), rel=1e-6)
    assert vol.realized(flat, 60) is None
    rows = [(date(2026, 1, 1) + timedelta(days=i), c) for i, c in enumerate(alternating)]
    series = vol.rolling_realized(rows, 30)
    assert len(series) == 10 and series[0]["t"] == "2026-01-31"


def test_record_iv_once_a_day(tmp_path):
    path = tmp_path / "iv.json"
    vol.record_iv("AAPL", 0.21, date(2026, 10, 16), path)
    vol.record_iv("AAPL", 0.30, date(2026, 10, 16), path)       # same day: kept once
    h = vol.record_iv("AAPL", 0.22, date(2026, 10, 17), path)
    assert [x["iv30"] for x in h] == [0.21, 0.22]
