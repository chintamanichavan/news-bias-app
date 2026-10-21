"""The timing comparison's arithmetic, on a market written by hand."""

import pytest

import timing

NO_INTEREST = [0.0] * 6


def test_steady_buys_every_month_and_is_valued_at_the_end():
    level = [100, 100, 50, 100, 200]
    value, cash = timing.end_value(level, NO_INTEREST, fall=None, hold_back=0.0)
    # 10 + 10 + 20 + 10 units, worth 200 each
    assert value == pytest.approx(50 * 200) and cash == 0


def test_waiting_buys_only_at_the_fall():
    level = [100, 100, 50, 100, 200]
    value, cash = timing.end_value(level, NO_INTEREST, fall=30, hold_back=1.0)
    # 3,000 spent at 50 = 60 units; the 4th payment never finds a fall
    assert value == pytest.approx(60 * 200 + 1000) and cash == 1000


def test_the_high_before_the_window_counts():
    level = [80, 80, 80]
    assert timing.end_value(level, NO_INTEREST, fall=20, hold_back=1.0)[1] == 2000
    assert timing.end_value(level, NO_INTEREST, fall=20, hold_back=1.0, high=100)[1] == 0


def test_waiting_cash_earns_interest():
    level = [100, 100, 100]
    one_percent = [0.0, 0.01, 0.01]
    value, _ = timing.end_value(level, one_percent, fall=50, hold_back=1.0)
    assert value == pytest.approx(1000 * 1.01 * 1.01 + 1000 * 1.01)


def test_half_and_half_splits_each_payment():
    level = [100, 50, 100]
    value, cash = timing.end_value(level, NO_INTEREST, fall=40, hold_back=0.5)
    # month 1: 5 units, 500 held. month 2: 10 units, then 1,000 of cash buys 20
    assert value == pytest.approx(35 * 100) and cash == 0


def test_compare_counts_how_often_a_plan_beats_steady():
    level = [100.0] * 12 + [50.0] + [100.0] * 24
    out = timing.compare([str(i) for i in range(len(level))], level, [0.0] * len(level), years=1)
    by_key = {r["key"]: r for r in out["strategies"]}
    assert out["windows"] == len(level) - 12 and out["paid_in"] == 12000
    assert by_key["steady"]["beat_steady_pct"] == 0.0
    assert 0 < by_key["wait_30"]["beat_steady_pct"] < 100
