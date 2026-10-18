import pandas as pd

import smallcaps


def test_holding_is_latest_june_else_first():
    snaps = [{"date": "2026-10-18"}, {"date": "2027-06-30"}, {"date": "2027-07-31"}]
    assert smallcaps.holding(snaps, "2027-05-31")["date"] == "2026-10-18"
    assert smallcaps.holding(snaps, "2027-07-31")["date"] == "2027-06-30"


def test_change_keeps_last_close_after_trading_stops():
    c = pd.Series({"2026-01-02": 10.0, "2026-02-02": 12.0})
    assert smallcaps._change(c, "2026-01-05", "2026-06-30") == 12.0 / 10.0 - 1
    assert smallcaps._change(c, "2025-12-01", "2026-06-30") is None


def test_pick_is_fixed_by_date():
    syms = [f"CIK{i:010d}" for i in range(200)]
    assert smallcaps.pick("2026-10-18", syms) == smallcaps.pick("2026-10-18", list(reversed(syms)))
    assert len(smallcaps.pick("2026-10-18", syms)) == smallcaps.PICK
