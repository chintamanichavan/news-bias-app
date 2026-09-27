"""Phase 2 acceptance: the guards must catch a deliberately overfit strategy,
purged folds must never leak, and the hurdle must rise with trials."""

import numpy as np

import validation


def test_purged_kfold_never_leaks():
    n, purge, embargo = 200, 5, 5
    for train, test in validation.purged_kfold_splits(n, k=5, purge=purge, embargo=embargo):
        assert len(np.intersect1d(train, test)) == 0
        # no training sample within `purge` before the test block
        assert not any(test[0] - purge <= i < test[0] for i in train)
        # no training sample inside the embargo after the block
        assert not any(test[-1] < i <= min(n - 1, test[-1] + purge + embargo) for i in train)


def test_deflated_sharpe_discounts_trials():
    rng = np.random.default_rng(7)
    r = rng.normal(0.0005, 0.01, 750)  # mildly positive drift
    one = validation.deflated_sharpe(list(r), n_trials=1)
    many = validation.deflated_sharpe(list(r), n_trials=200)
    assert one["dsr"] is not None and many["dsr"] is not None
    assert many["dsr"] < one["dsr"], "more trials must mean less credit"
    assert many["sr_benchmark"] > one["sr_benchmark"]


def test_overfit_strategy_is_flagged():
    """The release-bar drill: 60 skill-less random configs; selecting the
    in-sample best must be exposed by PBO ~ 0.5 and a DSR near zero credit."""
    rng = np.random.default_rng(42)
    T, C = 480, 60
    mat = rng.normal(0.0, 0.01, size=(T, C))  # zero-skill by construction

    pbo = validation.pbo_cscv(mat, n_blocks=8)
    assert pbo["pbo"] is not None and pbo["pbo"] >= 0.35, \
        f"PBO failed to flag pure noise selection (pbo={pbo['pbo']})"

    best = int(np.argmax(mat.mean(axis=0)))  # cherry-pick the winner
    naive_sr = mat[:, best].mean() / mat[:, best].std(ddof=1) * np.sqrt(252)
    dsr = validation.deflated_sharpe(list(mat[:, best]), n_trials=C)
    assert naive_sr > 1.0, "the cherry-picked config should LOOK great"
    assert dsr["dsr"] < 0.90, \
        f"DSR must withhold confidence from a best-of-{C} pick (dsr={dsr['dsr']})"


def test_hurdle_rises_with_trials():
    assert validation.significance_hurdle(1) == 2.0
    h50 = validation.significance_hurdle(50)
    h500 = validation.significance_hurdle(500)
    assert 2.0 < h50 < h500
    assert h500 >= 3.0, "hundreds of trials should demand Harvey-Liu-grade t"
