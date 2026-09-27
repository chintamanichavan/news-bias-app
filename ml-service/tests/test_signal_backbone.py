"""Market data is the backbone; text modifies conviction but cannot create it."""

import math

import signal_engine as se


def test_market_score_direction_and_thin_history():
    assert se.market_score([]) is None
    assert se.market_score([100.0] * 30) is None  # too thin to say anything
    rising = [100 * (1.004 ** i) for i in range(120)]
    falling = [100 * (0.996 ** i) for i in range(120)]
    up, down = se.market_score(rising), se.market_score(falling)
    assert up is not None and down is not None
    assert up > 0.3 and down < -0.3
    flat = se.market_score([100.0] * 120)
    assert flat is not None and abs(flat) <= 0.2  # trend term only


def test_sentiment_alone_cannot_open_a_position():
    import paper_trader
    for s in (1.0, 0.6, -1.0):
        c = se.compose_security(None, s)
        assert abs(c) <= se.SENTIMENT_ALONE_CAP < paper_trader.ENTRY_THRESHOLD


def test_sentiment_modifies_but_never_flips_market_conviction():
    base = se.compose_security(0.4, None)
    assert base == 0.4
    boosted = se.compose_security(0.4, 1.0)
    damped = se.compose_security(0.4, -1.0)
    assert boosted > base > damped > 0  # sign held even at maximum bearish text
    assert math.isclose(boosted, 0.4 * (1 + se.SENTIMENT_MODIFIER), rel_tol=1e-9)
    # On the short side, bullish text DAMPS the bearish signal toward zero
    # (it disagrees) — it must not amplify it, and must not flip it.
    damped_short = se.compose_security(-0.4, 1.0)
    assert -0.4 < damped_short < 0
    strengthened_short = se.compose_security(-0.4, -1.0)
    assert strengthened_short < -0.4
