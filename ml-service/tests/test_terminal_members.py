"""Index members: sector weights and breadth."""

import pytest

from terminal import members


def _r(sym, w, sector, chg, price=100.0, hi=110.0, lo=80.0, v50=1.0, v200=-1.0, vol=10):
    return {"symbol": sym, "weight": w, "sector": sector, "change_pct": chg, "price": price, "high_52w": hi,
            "low_52w": lo, "vs_50d_pct": v50, "vs_200d_pct": v200, "volume": vol}


def test_sector_weights_and_their_moves():
    s = members.sector_weights([_r("A", 0.5, "Tech", 2.0), _r("B", 0.3, "Tech", -1.0), _r("C", 0.2, None, 1.0)])
    tech = s[0]
    assert tech["sector"] == "Tech" and tech["weight"] == pytest.approx(0.8) and tech["members"] == 2
    assert tech["change_pct"] == pytest.approx((0.5 * 2 - 0.3) / 0.8)
    assert s[1]["sector"] == "Other"


def test_breadth_counts():
    b = members.breadth([
        _r("A", 0.1, "x", 1.0, price=109.5),            # within 1% of its high
        _r("B", 0.1, "x", -1.0, price=80.5, v50=-2),     # within 1% of its low, under its 50-day
        _r("C", 0.1, "x", 0.0, vol=0),
    ])
    assert (b["advancing"], b["declining"], b["unchanged"]) == (1, 1, 1)
    assert b["new_highs"] == 1 and b["new_lows"] == 1
    assert b["above_50d_pct"] == pytest.approx(200 / 3)
    assert b["above_200d_pct"] == 0
    assert b["up_volume_pct"] == pytest.approx(50)
