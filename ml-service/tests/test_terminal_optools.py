"""Options tools: OCC symbols, covered calls and variance replication."""

import math

import pytest

from terminal import options, optools


def test_occ_symbol():
    assert optools.parse_occ("AAPL261016C00345000") == {"root": "AAPL", "expiry": "2026-10-16", "kind": "C", "strike": 345.0}
    assert optools.parse_occ("BRKB261120P00512500")["strike"] == 512.5


def test_covered_call_by_hand():
    c = optools.covered_call(100, 105, 2, 30)
    assert c["static_pct"] == pytest.approx(2) and c["if_called_pct"] == pytest.approx(7)
    assert c["breakeven"] == 98 and c["static_annual_pct"] == pytest.approx(2 * 365 / 30)


def _bs_chain(s, vol, t, r, step=1.0, width=0.6):
    rows = []
    k = s * (1 - width)
    while k <= s * (1 + width):
        for kind in ("C", "P"):
            p = options.price(kind, s, k, t, r, 0.0, vol)
            rows.append({"kind": kind, "strike": round(k, 2), "bid": max(p - 0.005, 0.0), "ask": p + 0.005})
        k += step
    return rows


def test_replication_recovers_a_flat_volatility():
    s, vol, t, r = 100.0, 0.25, 30 / 365, 0.04
    v = optools.expiry_variance(_bs_chain(s, vol, t, r, step=0.5), t, r)
    assert math.sqrt(v["variance"]) == pytest.approx(vol, abs=0.005)
    assert v["forward"] == pytest.approx(s * math.exp(r * t), abs=0.05)


def test_variance_interpolation_is_flat_for_a_flat_term_structure():
    assert optools.interpolate_variance(0.04, 20 / 365, 0.04, 40 / 365, 30 / 365) == pytest.approx(0.04)


def test_index_symbols_map_both_ways():
    assert optools.cboe_path("^GSPC") == "_SPX" and optools.cboe_path("SPX") == "_SPX"
    assert optools.cboe_path("BRK-B") == "BRK.B" and optools.cboe_path("aapl") == "AAPL"
    assert optools.yahoo_symbol("SPX") == "^GSPC" and optools.yahoo_symbol("AAPL") == "AAPL"
