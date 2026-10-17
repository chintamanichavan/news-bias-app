"""Terminal step 13: option pricing, implied volatility, greeks, the chain."""

import json
import math
from pathlib import Path

import pytest

from terminal import options as o

FIX = Path(__file__).parent / "fixtures"


def test_textbook_prices():
    # Hull, Options, Futures and Other Derivatives, the worked BSM example
    assert o.price("C", 42, 40, 0.5, 0.10, 0.0, 0.20) == pytest.approx(4.76, abs=0.005)
    assert o.price("P", 42, 40, 0.5, 0.10, 0.0, 0.20) == pytest.approx(0.81, abs=0.005)


def test_put_call_parity_with_dividends():
    s, k, t, r, q, v = 100.0, 95.0, 0.75, 0.04, 0.02, 0.3
    lhs = o.price("C", s, k, t, r, q, v) - o.price("P", s, k, t, r, q, v)
    assert lhs == pytest.approx(s * math.exp(-q * t) - k * math.exp(-r * t), abs=1e-9)


def test_implied_vol_round_trip_and_bounds():
    for kind in ("C", "P"):
        for vol in (0.08, 0.25, 0.9):
            p = o.price(kind, 100, 110, 0.3, 0.03, 0.01, vol)
            assert o.implied_vol(kind, p, 100, 110, 0.3, 0.03, 0.01) == pytest.approx(vol, abs=1e-6)
    # below intrinsic value no volatility fits
    assert o.implied_vol("C", 1.0, 120, 100, 0.5, 0.03, 0.0) is None


def test_greeks_against_textbook_and_finite_differences():
    g = o.greeks("C", 42, 40, 0.5, 0.10, 0.0, 0.20)
    assert g["delta"] == pytest.approx(0.7791, abs=1e-4)          # N(d1) in Hull's example
    s, k, t, r, q, v, h = 100, 100, 0.5, 0.03, 0.01, 0.25, 1e-3
    for kind in ("C", "P"):
        g = o.greeks(kind, s, k, t, r, q, v)
        d = (o.price(kind, s + h, k, t, r, q, v) - o.price(kind, s - h, k, t, r, q, v)) / (2 * h)
        assert g["delta"] == pytest.approx(d, abs=1e-5)
        vega = (o.price(kind, s, k, t, r, q, v + 0.01) - o.price(kind, s, k, t, r, q, v - 0.01)) / 2
        assert g["vega"] == pytest.approx(vega, rel=1e-3)
        theta = (o.price(kind, s, k, t - 1 / 365, r, q, v) - o.price(kind, s, k, t, r, q, v))
        assert g["theta"] == pytest.approx(theta, rel=2e-2)


def test_midpoint_and_time():
    assert o.midpoint(1.0, 1.2, 5.0) == pytest.approx(1.1)
    assert o.midpoint(0.0, 1.2, 0.9) == 0.9           # one-sided quote: use the last trade
    assert o.midpoint(None, None, None) is None
    assert o.years_to(0, now=0) == pytest.approx(20 * 3600 / o.YEAR_SECONDS)


def test_rate_interpolates_the_curve():
    curve = {"tenors": [{"label": "1M", "years": 1 / 12}, {"label": "1Y", "years": 1.0}],
             "curves": [{"yields": {"1M": 4.0, "1Y": 5.0}}]}
    assert o.rate_for(0.01, curve) == pytest.approx(math.log(1.04))
    mid = (1 / 12 + 1) / 2
    assert o.rate_for(mid, curve) == pytest.approx(math.log(1.045))
    assert o.rate_for(3.0, None) == 0.04


def test_chain_from_a_saved_reply():
    res = json.loads((FIX / "options_aapl.json").read_text())["optionChain"]["result"][0]
    expiry = res["options"][0]["expirationDate"]
    chain = o.build_chain(res, now=expiry - 3 * 86400, curve=None)
    assert chain["spot"] == 343.46 and len(chain["expirations"]) == 23
    assert chain["rows"] == sorted(chain["rows"], key=lambda r: r["strike"])
    near = min(chain["rows"], key=lambda r: abs(r["strike"] - 343.46) if "call" in r and "put" in r else 1e9)
    call, put = near["call"], near["put"]
    assert 0.3 < call["delta"] < 0.7 and -0.7 < put["delta"] < -0.3
    assert call["iv"] and 0.05 < call["iv"] < 2
    # our IV, solved from the midpoint, lands near Yahoo's for a liquid at-the-money contract
    assert call["iv"] == pytest.approx(call["yahoo_iv"], abs=0.12)
