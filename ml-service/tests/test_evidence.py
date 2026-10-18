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
