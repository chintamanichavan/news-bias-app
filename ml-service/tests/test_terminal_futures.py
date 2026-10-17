"""Terminal step 7: futures chains, the shared history helper, industries."""

from datetime import date, timedelta

import pytest

from terminal import futures, history

GOLD = futures.Root("GC", "Gold", "CMX", "GJMQVZ")


def test_listed_months_follow_the_exchange_calendar():
    assert futures.listed_months(date(2026, 10, 16), "GJMQVZ", 4) == [
        (2026, 10), (2026, 12), (2027, 2), (2027, 4)]
    assert futures.listed_months(date(2026, 12, 1), futures.QUARTERLY, 2) == [(2026, 12), (2027, 3)]


def test_contract_symbols():
    assert futures.contract_symbol(GOLD, 2026, 12) == "GCZ26.CMX"
    assert futures.contract_symbol(futures.Root("6E", "Euro", "CME", "HMUZ"), 2027, 3) == "6EH27.CME"


def test_curve_shape():
    assert futures.curve_shape([100, 101, 102]) == "contango"
    assert futures.curve_shape([102, 101, 99]) == "backwardation"
    assert futures.curve_shape([100, 100.1]) == "flat"
    assert futures.curve_shape([100]) is None


def _bars(last_day: date, values: list[float]):
    return [(last_day - timedelta(days=len(values) - 1 - i), v) for i, v in enumerate(values)]


def test_chain_drops_expired_and_missing_contracts():
    today = date(2026, 10, 16)
    closes = {
        "GCV26.CMX": _bars(date(2026, 9, 28), [4000, 4010]),    # expired: no bar for 18 days
        "GCZ26.CMX": _bars(today, [4100, 4186.7]),
        "GCG27.CMX": _bars(today, [4130, 4222.4]),
        # GCJ27 missing entirely
    }
    c = futures.chain(GOLD, today, closes)
    assert [r["symbol"] for r in c["contracts"]] == ["GCZ26.CMX", "GCG27.CMX"]
    assert c["contracts"][0]["month"] == "Dec 26"
    assert c["contracts"][0]["change_pct"] == pytest.approx((4186.7 / 4100 - 1) * 100, abs=1e-3)
    assert c["shape"] == "contango"


def test_moves_since_each_lookback():
    end = date(2026, 10, 16)
    s = [(end - timedelta(days=400 - i), 100 + i * 0.1) for i in range(401)]
    m = history.moves(s)
    assert set(m) == {"1d", "1w", "1m", "3m", "ytd", "1y"}
    assert m["1y"] == pytest.approx((140 / 103.5 - 1) * 100, abs=1e-3)
    assert m["1d"] == pytest.approx((140 / 139.9 - 1) * 100, abs=1e-3)
    assert history.moves(s[:1]) == {}


def test_industry_rows_skip_missing():
    end = date(2026, 10, 16)
    closes = {"SMH": _bars(end, [100, 101]), "IGV": []}
    rows = futures.industry_rows({"SMH": "Semiconductors", "IGV": "Software"}, closes)
    assert [r["symbol"] for r in rows] == ["SMH"]
    assert rows[0]["1d"] == pytest.approx(1.0)
