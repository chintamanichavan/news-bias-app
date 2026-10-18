"""The odds maths on series whose answers are known by hand."""

import numpy as np
import pytest

import odds


def test_parse_french_reads_the_first_monthly_block_only():
    text = ("This file was created ...\n\n"
            "  Average Value Weighted Returns -- Monthly\n"
            ",SMALL HiBM,BIG HiBM\n"
            "199107,   1.00,  -2.50\n"
            "199108, -99.99,   0.50\n"
            "\n"
            "  Average Equal Weighted Returns -- Monthly\n"
            ",SMALL HiBM,BIG HiBM\n"
            "199107,   9.00,   9.00\n")
    assert odds.parse_french(text) == {
        "199107": {"SMALL HiBM": 0.01, "BIG HiBM": -0.025},
        "199108": {"BIG HiBM": 0.005},
    }


def test_cagr_and_rolling_on_a_steady_series():
    r = np.full(36, 0.01)
    assert odds.cagr(r) == pytest.approx(1.01 ** 12 - 1)
    assert odds.rolling(r, 12) == pytest.approx(np.full(25, 1.01 ** 12 - 1))


def test_max_drawdown_counts_from_the_starting_value():
    # Falls 50% at once, doubles back, then falls 10% from the new high.
    r = np.array([-0.5, 1.0, 0.2, -0.1])
    assert odds.max_drawdown(r) == pytest.approx(-0.5)
    assert odds.max_drawdown(np.array([0.1, -0.1])) == pytest.approx(-0.1)


def test_blocks_are_consecutive_and_wrap_round():
    idx = odds.block_bootstrap(30, 30, np.random.default_rng(0))
    assert idx.shape == (odds.PATHS, 30)
    step = np.diff(idx[:, :odds.BLOCK], axis=1) % 30
    assert (step == 1).all()


def test_a_series_that_never_varies_has_certain_odds():
    r = np.full(240, 1.18 ** (1 / 12) - 1)
    d = odds.distribution(r, np.random.default_rng(0))
    for h in d["horizons"]:
        assert h["percentiles"]["5"] == pytest.approx(0.18)
        assert h["p_goal"] == {"0.15": 1.0, "0.20": 0.0}
        assert h["p_loss"] == 0.0
    assert d["drawdown"]["median"] == 0.0


def test_an_unknown_sleeve_is_refused(monkeypatch):
    monkeypatch.setattr(odds.portfolio, "targets", lambda: {"allocations": [
        {"asset_class": "equity", "region": "mars", "factor": "value", "weight": 100}]})
    with pytest.raises(ValueError, match="mars"):
        odds.sleeves()


def _fake_history(monkeypatch):
    rng = np.random.default_rng(1)
    S = {odds.key(*k): rng.normal(0.008, 0.04, 120) for k in odds.PROXIES}
    b = {k: rng.normal(0.008, 0.04, 120) for k in odds.BENCHMARKS}
    monkeypatch.setattr(odds, "history", lambda: ([f"{2000 + i // 12}{i % 12 + 1:02d}" for i in range(120)], S, b))
    monkeypatch.setattr(odds.portfolio, "targets", lambda: {"allocations": [
        {"region": "us-developed", "factor": "small-value", "weight": 60},
        {"region": "emerging", "factor": "value", "weight": 40}]})


def test_a_what_if_with_the_plans_weights_is_the_plan(monkeypatch):
    _fake_history(monkeypatch)
    plan = odds.odds()
    same = odds.odds({"us-developed/small-value": 3, "emerging/value": 2, "global/quality": 0})
    assert same["plan"]["horizons"] == plan["plan"]["horizons"]
    assert [s["key"] for s in same["sleeves"]] == ["us-developed/small-value", "emerging/value"]


def test_a_single_sleeve_carries_all_the_risk(monkeypatch):
    _fake_history(monkeypatch)
    one = odds.odds({"global/quality": 100})
    assert one["sleeves"][0]["risk_share"] == pytest.approx(1.0)


def test_what_ifs_that_cannot_be_priced_are_refused(monkeypatch):
    _fake_history(monkeypatch)
    for bad in ({"global/quality": -5}, {"global/quality": 0}, {"moon/value": 10}):
        with pytest.raises(ValueError):
            odds.odds(bad)
