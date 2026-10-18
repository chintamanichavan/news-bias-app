"""The outside-the-index test's rules and its payoff fit."""

import numpy as np
import pytest

import beyond


def _card(t, moat="wide", shares=-0.01, years=(0.2, 0.2, 0.1)):
    return {"ticker": t, "moat": moat, "share_change_yearly": shares, "return_by_year": list(years)}


def test_clean_moat_needs_a_wide_moat_and_no_dilution():
    cards = [_card("A"), _card("B", shares=0.03), _card("C", moat="narrow"), _card("D", shares=None),
             _card("E", shares=0.0)]
    assert beyond.clean_moat(cards) == ["A", "E"]


def test_moat_years():
    assert beyond.moat_years(_card("A", years=(0.2, None, 0.1, 0.3))) == pytest.approx(2 / 3)
    assert beyond.moat_years(_card("A", years=(None,))) is None


def test_payoff_recovers_what_issuance_cost():
    rng = np.random.default_rng(0)
    n = 300
    cards = [_card(f"T{i}", shares=float(rng.normal()), years=tuple(rng.uniform(0, 0.3, 10)))
             for i in range(n)]
    values = {c["ticker"]: {"market_value": float(np.exp(rng.normal(22, 1)))} for c in cards}
    # returns fall by 6 points from the least to the most diluting company
    rank = {c["ticker"]: r for c, r in zip(cards, np.argsort(np.argsort([c["share_change_yearly"] for c in cards])) / (n - 1))}
    nxt = {t: 0.10 - 0.06 * (r - 0.5) for t, r in rank.items()}
    coef = beyond.payoff(cards, values, nxt)
    assert coef[0] == pytest.approx(0.10, abs=2e-3)
    assert coef[2] == pytest.approx(-0.06, abs=2e-3)
    assert beyond.payoff(cards[:10], values, nxt) is None
