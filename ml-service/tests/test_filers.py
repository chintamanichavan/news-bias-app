"""Repairs to filers' figures, on cases whose answer is known by hand."""

import numpy as np
import pandas as pd
import pytest

import filers


def test_a_figure_at_the_wrong_scale_is_brought_back():
    v = pd.Series([5.0e10, 5.2e10, 56.1, 5.5e10, 5.9e19])
    fixed = filers.rescale(v)
    assert fixed.tolist() == pytest.approx([5.0e10, 5.2e10, 5.61e10, 5.5e10, 5.9e10])


def test_a_reverse_split_does_not_read_as_a_gain():
    # Float flat at $100M; a 1-for-20 reverse split cuts the cover-page share
    # count, but the filing's own share growth is stated in the new units.
    pts = pd.DataFrame({
        "symbol": ["X", "X", "X"],
        "float_date": pd.to_datetime(["2015-06-30", "2016-06-30", "2017-06-30"]),
        "float": [100e6, 100e6, 110e6],
        "shares": [200e6, 10e6, 10e6],
        "p": [0.5, 10.0, 11.0],
        "share_growth": [np.nan, 0.0, 0.0],
    })
    link = filers.links(pts).tolist()
    assert np.isnan(link[0])
    assert link[1:] == pytest.approx([1.0, 1.1])


def test_without_share_growth_a_likely_split_breaks_the_chain():
    pts = pd.DataFrame({
        "symbol": ["X"] * 3,
        "float_date": pd.to_datetime(["2015-06-30", "2016-06-30", "2018-06-30"]),
        "float": [100e6, 100e6, 100e6], "shares": [200e6, 10e6, 10e6],
        "p": [0.5, 10.0, 10.0], "share_growth": [np.nan] * 3,
    })
    link = filers.links(pts).tolist()
    assert np.isnan(link[1])          # shares jumped twentyfold: likely a split
    assert np.isnan(link[2])          # a two-year gap
