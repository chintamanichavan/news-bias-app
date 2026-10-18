"""The Lab's statistics and the experiments log."""

import math

import monitor


def test_hurst_and_acf_discriminate():
    import lab

    # persistent drift with mild deterministic wobble (pure trend has zero
    # return variance, which R/S can't use)
    rets = [0.01 + 0.005 * math.sin(i / 3) for i in range(240)]
    trending = [100.0]
    for r in rets:
        trending.append(trending[-1] * (1 + r))
    h = lab._hurst(trending)
    assert h is not None and h > 0.55  # the Lab's own "trending" boundary
    # perfectly alternating returns: strong negative lag-1 autocorrelation
    assert lab._acf([(-1.0) ** i for i in range(50)], 1) < -0.9


def test_experiments_log_roundtrip(tmp_db):
    monitor.log_experiment("test", {"p": 1}, {"m": 2.0})
    rows = monitor.experiments()
    assert rows and rows[0]["kind"] == "test" and rows[0]["metrics"]["m"] == 2.0
