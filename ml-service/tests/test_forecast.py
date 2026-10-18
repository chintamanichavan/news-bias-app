"""The forecast's pieces on cross-sections whose answer is known."""

import numpy as np
import pandas as pd
import pytest

import forecast


def _raw(n=200, seed=0):
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({f: rng.normal(size=n) for f in forecast.FEATURES},
                      index=[f"T{i}" for i in range(n)])
    df["moat"], df["name"] = "none", "x"
    return df


def test_ranks_run_from_minus_to_plus_a_half_and_missing_sits_in_the_middle():
    raw = _raw(5)
    raw.loc["T0", "roic"] = np.nan
    X = forecast.ranked(raw)
    assert X["size"].min() == pytest.approx(0.2 - 0.5) and X["size"].max() == pytest.approx(0.5)
    assert X.loc["T0", "roic"] == 0.0


def test_fit_recovers_what_a_trait_paid():
    X = forecast.ranked(_raw())
    y = 0.10 + 0.08 * X["issuance"] - 0.05 * X["momentum"]
    coef = forecast.fit(X, y)
    assert coef[0] == pytest.approx(0.10, abs=1e-3)
    j = forecast.FEATURES.index("issuance") + 1
    assert coef[j] == pytest.approx(0.08, abs=2e-3)
    assert coef[forecast.FEATURES.index("momentum") + 1] == pytest.approx(-0.05, abs=2e-3)


def test_predict_applies_the_coefficients():
    X = forecast.ranked(_raw(10))
    coef = np.zeros(len(forecast.FEATURES) + 1)
    coef[0], coef[forecast.FEATURES.index("size") + 1] = 0.07, 0.1
    assert forecast.predict(coef, X).to_numpy() == pytest.approx(0.07 + 0.1 * X["size"].to_numpy())


def test_moat_years_is_the_share_of_years_above_fifteen_percent():
    priced = {"companies": [{"ticker": "A", "name": "A", "moat": "wide", "market_value": 1e9,
                             "percentiles": {"50": 0.06}}]}
    cards = {"A": {"return_by_year": [0.2, 0.1, None, 0.3, 0.16]}}
    raw = forecast.traits(priced, cards, {"A": 0.1})
    assert raw.loc["A", "moat_years"] == pytest.approx(0.75)
    assert raw.loc["A", "implied"] == 0.06 and raw.loc["A", "momentum"] == 0.1
