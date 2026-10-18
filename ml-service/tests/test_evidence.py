"""The evidence statistics on series whose answer is known."""

import numpy as np
import pandas as pd
import pytest

import evidence


def test_newey_west_matches_the_plain_t_on_independent_draws():
    x = np.random.default_rng(0).normal(0.01, 0.05, 5000)
    plain = x.mean() / (x.std() / np.sqrt(len(x)))
    assert evidence.newey_west_t(x) == pytest.approx(plain, rel=0.05)


def test_newey_west_is_wider_when_months_move_together():
    rng = np.random.default_rng(1)
    e = rng.normal(0, 0.05, 3000)
    x = 0.005 + np.convolve(e, np.ones(6) / 6, mode="same")     # overlapping, so correlated
    plain = x.mean() / (x.std() / np.sqrt(len(x)))
    assert evidence.newey_west_t(x) < 0.6 * plain


def test_windows_won_counts_rolling_windows():
    idx = [f"{2000 + i // 12}{i % 12 + 1:02d}" for i in range(24)]
    long = pd.Series([0.02] * 12 + [-0.02] * 12, index=idx)
    short = pd.Series(0.0, index=idx)
    # 13 twelve-month windows; those with more gaining months than losing win: 6
    assert evidence.windows_won(long, short, 12) == pytest.approx(6 / 13)


def test_growth_is_the_compound_rate_a_year():
    r = pd.Series([0.01] * 24)
    assert evidence.growth(r) == pytest.approx(1.01 ** 12 - 1)


def test_place_puts_a_value_in_its_group():
    cuts = [0.1, 0.2, 0.3, 0.4]                  # four cut-offs, five groups
    assert [evidence.place(v, cuts) for v in (0.05, 0.1, 0.25, 0.99)] == [0, 1, 2, 4]


def test_breakpoints_reads_twenty_percentiles(monkeypatch):
    row = "2026,  1012," + ",".join(f"{v:.2f}" for v in range(5, 105, 5))
    monkeypatch.setattr(evidence.odds, "french_text", lambda name: "header\n\n       ,Count\n" + row + "\n\nCopyright\n")
    bp = evidence.breakpoints("OP_Breakpoints")
    assert list(bp) == ["2026"] and bp["2026"][3] == pytest.approx(0.20) and len(bp["2026"]) == 20


def test_operating_profitability_is_profit_less_interest_over_book_equity():
    y = pd.DataFrame({"year_end": pd.to_datetime(["2024-12-31", "2025-12-31"]),
                      "operating_income": [50.0, 60.0], "interest_expense": [5.0, 10.0],
                      "equity": [200.0, 250.0]})
    assert evidence.operating_profitability(y) == pytest.approx(50 / 250)
    assert evidence.operating_profitability(y.assign(equity=[200.0, -5.0])) is None
