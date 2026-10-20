"""The pricer's arithmetic on futures whose answer is known by hand."""

import numpy as np
import pandas as pd
import pytest

import pricer

G = pricer.LONG_RUN_GROWTH
STILL = {"roic_persistence": 1.0, "roic_noise": 0.0, "growth_persistence": 1.0, "growth_noise": 0.0}


def test_terminal_value_driver():
    nopat, rate = np.array([10.0]), np.array([0.08])
    # earning 20% on new capital: growth adds value
    assert pricer.terminal(nopat, np.array([0.20]), rate)[0] == pytest.approx(10 * (1 - G / 0.2) / (0.08 - G))
    # earning less than the rate: the business is worth its profit at the rate
    assert pricer.terminal(nopat, np.array([0.05]), rate)[0] == pytest.approx(10 / 0.08)
    # losing money: worth nothing
    assert pricer.terminal(np.array([-1.0]), np.array([0.2]), rate)[0] == 0


def test_implied_return_of_an_annuity():
    # 10 a year for 10 years, nothing after, bought for its value at 6%
    cash = np.full((1, 10), 10.0)
    price = sum(10 / 1.06 ** t for t in range(1, 11))
    r = pricer.implied_return(cash, np.array([0.0]), np.array([0.1]), price)
    assert r[0] == pytest.approx(0.06, abs=1e-6)


def test_a_steady_business_returns_the_rate_it_was_priced_at():
    # ROIC 15% forever, growing at the long-run rate: worth
    # capital x (ROIC - g) / (k - g) at k. Priced that way, it returns k.
    capital, roic, k = 100.0, 0.15, 0.07
    ev = capital * (roic - G) / (k - G)
    r = pricer.simulate(capital, roic, G, ev, STILL, roic, np.random.default_rng(0), paths=3)
    assert r == pytest.approx([k] * 3, abs=1e-6)


def test_a_dearer_price_means_a_lower_return():
    fade = {"roic_persistence": 0.88, "roic_noise": 0.05, "growth_persistence": 0.3, "growth_noise": 0.08}
    args = dict(capital=100.0, roic0=0.2, growth0=0.08, fade=fade, roic_mean=0.12)
    cheap = np.median(pricer.simulate(ev=150.0, rng=np.random.default_rng(0), **args))
    dear = np.median(pricer.simulate(ev=300.0, rng=np.random.default_rng(0), **args))
    assert cheap > dear


def test_a_scale_slip_in_the_share_count_is_caught():
    same = pd.DataFrame({"tag": ["NetIncomeLoss", "EarningsPerShareDiluted"],
                         "value": [8_000_000_000.0, 11.2]})
    # filed as 712.3 (millions left off): net income / EPS gives ~714 million
    assert pricer.checked_shares(712.3, same) == pytest.approx(8e9 / 11.2)
    # a count that agrees is kept
    assert pricer.checked_shares(714e6, same) == 714e6
    # a loss-making year near zero EPS says nothing
    tiny = same.assign(value=[1e6, 0.01])
    assert pricer.checked_shares(712.3, tiny) == 712.3


def test_industry_targets_need_enough_members():
    members = {t: {"roic": r} for t, r in
               [("A", .1), ("B", .2), ("C", .3), ("D", .4), ("E", .5), ("F", .9)]}
    cards = {t: {"sic": "73" + t} for t in "ABCDE"} | {"F": {"sic": "2800"}}
    target = pricer.industry_targets(members, cards)
    assert target["A"] == pytest.approx(0.3)          # five members in SIC 73
    assert target["F"] == pytest.approx(0.35)         # alone: the median of all six


def test_own_noise_is_the_robust_spread_of_yearly_changes():
    # a steady climb: every yearly change the same, so no noise
    steady = {"return_by_year": [0.20, 0.21, 0.22, 0.23, 0.24, 0.25, 0.26]}
    assert pricer.own_noise(steady, {"roic_noise": 0.05}) == pytest.approx(0.0, abs=1e-9)
    short = {"return_by_year": [0.2, 0.3, None]}
    assert pricer.own_noise(short, {"roic_noise": 0.05}) == 0.05


def test_a_share_valued_at_its_implied_return_is_worth_its_price():
    rng = np.random.default_rng(0)
    noisy = {**STILL, "roic_persistence": 0.8, "roic_noise": 0.03}
    f = pricer.futures(100.0, 0.18, 0.06, noisy, 0.12, rng, paths=200)
    net_debt, shares, price = 300.0, 50.0, 30.0
    r = pricer.implied_return(*f, net_debt + price * shares)
    ok = r > -0.59                                  # futures worth something at the floor
    v = pricer.per_share(*(x[ok] for x in f), r[ok], net_debt, shares)
    assert v == pytest.approx(np.full(ok.sum(), price), rel=1e-6)


def test_a_share_is_worth_nothing_below_zero():
    # the business is worth 100 at 6%, owing 150: owners walk away with nothing
    cash = np.full((1, 10), 100 / sum(1 / 1.06 ** t for t in range(1, 11)))
    v = pricer.per_share(cash, np.array([0.0]), np.array([0.1]), 0.06, 150.0, 10.0)
    assert v[0] == 0
    assert pricer.per_share(cash, np.array([0.0]), np.array([0.1]), 0.06, 40.0, 10.0)[0] == pytest.approx(6.0)


def test_trajectories_feed_futures_exactly():
    import numpy as np
    fade = {"roic_persistence": 0.8, "roic_noise": 0.05, "growth_persistence": 0.3, "growth_noise": 0.08}
    roic, growth = pricer.trajectories(0.25, 0.15, fade, 0.1, np.random.default_rng(1), paths=200)
    assert roic.shape == (200, pricer.YEARS + 1) and growth.shape == (200, pricer.YEARS)
    cash, nopat, roic11 = pricer.futures(100.0, 0.25, 0.15, fade, 0.1, np.random.default_rng(1), paths=200)
    assert np.array_equal(roic11, roic[:, -1])
    assert np.allclose(cash[:, 0], 100.0 * (roic[:, 0] - growth[:, 0]))
