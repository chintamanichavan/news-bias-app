"""The winner study's arithmetic on cases whose answer is known by hand."""

import numpy as np
import pandas as pd
import pytest

import winners


def test_logistic_recovers_a_known_slope():
    rng = np.random.default_rng(0)
    x = rng.uniform(-0.5, 0.5, 20000)
    p = 1 / (1 + np.exp(-(-2.0 + 3.0 * x)))
    y = (rng.uniform(size=x.size) < p).astype(float)
    w = winners.fit_logistic(x[:, None], y, ridge=0.0)
    assert w == pytest.approx([-2.0, 3.0], abs=0.15)


def test_auc_counts_winners_ranked_above_the_rest():
    y = np.array([True, False, True, False])
    assert winners.auc(np.array([0.9, 0.1, 0.8, 0.2]), y) == 1.0
    assert winners.auc(np.array([0.1, 0.9, 0.2, 0.8]), y) == 0.0
    assert winners.auc(np.array([0.9, 0.8, 0.1, 0.2]), y) == 0.5
    assert winners.auc(np.array([0.5, 0.5]), np.array([True, True])) is None


def test_ranks_centre_on_zero_and_leave_missing_in_the_middle():
    day = pd.DataFrame({k: [1.0, 2.0, 3.0, None] for k in winners.TRAITS})
    X = winners.ranks(day)
    assert X[:, 0].tolist() == pytest.approx([1 / 3 - 0.5, 2 / 3 - 0.5, 0.5, 0.0])
