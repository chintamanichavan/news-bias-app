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
