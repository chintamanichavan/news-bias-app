"""The proof's arithmetic: which years are replayed, what is held, and how
a holding year's returns are read."""

import numpy as np
import pandas as pd
import pytest

import proof
import validation


def test_only_years_whose_holding_has_fully_happened():
    assert proof.rebalance_dates("2016-07-15") == ["2014-06-30", "2015-06-30"]
    assert proof.rebalance_dates("2016-06-29") == ["2014-06-30"]


def _priced(n_wide=30, n_other=70):
    # even-numbered wide names grow, odd ones shrink
    cs = [{"ticker": f"W{i}", "moat": "wide", "alpha": 0.1 - i / 1000,
           "growth": 0.05 if i % 2 == 0 else -0.05} for i in range(n_wide)] + \
         [{"ticker": f"O{i}", "moat": "none", "alpha": 0.05 - i / 1000, "growth": 0.0}
          for i in range(n_other)]
    return {"companies": sorted(cs, key=lambda c: -c["alpha"])}


def test_holdings():
    h = proof.holdings(_priced())
    assert h["moat_top"] == [f"W{i}" for i in range(proof.TOP)]
    assert len(h["moat_all"]) == 30 and len(h["universe"]) == 100
    assert len(h["top_fifth"]) == len(h["bottom_fifth"]) == 20
    assert h["top_fifth"][0] == "W0" and h["bottom_fifth"][-1] == "O69"


def test_a_holding_year_is_the_twelve_months_after_the_date():
    months = pd.date_range("2014-01-01", "2016-12-01", freq="MS")
    rets = pd.DataFrame({"A": 0.01, "B": 0.03}, index=months)
    rets.loc["2015-03-01", "B"] = np.nan           # B has no return that month
    m = proof.hold(rets, ["A", "B", "GONE"], "2014-06-30")
    assert list(m.index) == list(pd.date_range("2014-07-01", "2015-06-01", freq="MS"))
    assert m.loc["2014-07-01"] == pytest.approx(0.02)
    assert m.loc["2015-03-01"] == pytest.approx(0.01)   # A alone that month


def test_information_coefficient_is_a_rank_correlation():
    alpha = {f"T{i}": i for i in range(40)}
    assert proof.ic(alpha, {t: v ** 3 for t, v in alpha.items()}) == pytest.approx(1.0)
    assert proof.ic(alpha, {t: -v for t, v in alpha.items()}) == pytest.approx(-1.0)
    assert proof.ic({"A": 1}, {"A": 1}) is None          # too few to say


def test_deflated_sharpe_under_the_null_variance():
    rng = np.random.default_rng(3)
    skill = list(rng.normal(0.02, 0.05, 144))       # monthly Sharpe 0.4
    luck = list(rng.normal(0.0, 0.05, 144))
    n = 144
    assert validation.deflated_sharpe(skill, 4, 1 / (n - 1))["dsr"] > 0.95
    assert validation.deflated_sharpe(luck, 4, 1 / (n - 1))["dsr"] < 0.8
    # the default bar is far higher: even real skill reads as zero
    assert validation.deflated_sharpe(skill, 4)["dsr"] < 0.01


def test_the_value_trap_guards():
    mom = {f"W{i}": (0.1 if i < 5 else -0.1) for i in range(30)}
    h = proof.holdings(_priced(), mom)
    assert h["moat_top_momentum"] == [f"W{i}" for i in range(5)]
    assert h["moat_top_growing"] == [f"W{i}" for i in range(0, 30, 2)][:proof.TOP]


def test_momentum_skips_the_last_month():
    months = pd.date_range("2013-01-01", "2014-12-01", freq="MS")
    rets = pd.DataFrame({"A": 0.01}, index=months)
    rets.loc["2014-06-01", "A"] = -0.5           # the month just before the date: skipped
    assert proof.momentum(rets, "2014-06-30")["A"] == pytest.approx(1.01 ** 11 - 1)
