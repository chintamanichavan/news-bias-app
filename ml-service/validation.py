"""
Validation that cannot lie — Phase 2.

Implements the Bailey–López de Prado program on top of the experiments
registry:

- purged_kfold_splits: K-fold indices for serially-labeled data with a purge
  gap and an embargo after each test block, so training rows never overlap
  the information horizon of test rows.
- deflated_sharpe: DSR = P(true SR > 0) after discounting the observed
  Sharpe for non-normality and for the number of trials that produced it
  (expected max SR of N tries under the null).
- pbo_cscv: Probability of Backtest Overfitting via combinatorially
  symmetric cross-validation over a returns matrix of candidate configs —
  how often the in-sample winner lands in the bottom half out-of-sample.
- trials_count / significance_hurdle: the registry-aware t-stat bar
  (Harvey–Liu: as tests accumulate, 2 is not enough).

References: Bailey & López de Prado, "The Deflated Sharpe Ratio" (JPM 2014);
Bailey, Borwein, López de Prado & Zhu, "The Probability of Backtest
Overfitting" (J. Computational Finance); Harvey & Liu, "…and the
Cross-Section of Expected Returns".
"""

import math
from itertools import combinations

import numpy as np
from scipy import stats as sstats

import db

EULER_GAMMA = 0.5772156649015329

# Stamped onto every multi-year result: the universe is built from names that
# are listed TODAY, so the companies that died on the way are invisible.
# Shumway (1997, J. Finance) showed omitting delisting returns materially
# inflates measured performance. Free data cannot cure this; honesty can.
SURVIVORSHIP_CAVEAT = (
    "Universe holds only currently-listed names — delisted failures are absent, "
    "so multi-year results skew optimistic (delisting bias; Shumway 1997)."
)


# ── Purged K-fold with embargo ──────────────────────────────────────────────

def purged_kfold_splits(n: int, k: int = 5, purge: int = 5, embargo: int = 5):
    """Yield (train_idx, test_idx) for `n` time-ordered samples. Around each
    contiguous test block, `purge` samples on each side are dropped from
    training (label overlap), plus an `embargo` after the block (leakage
    through serial correlation of features)."""
    if k < 2 or n < k * 2:
        raise ValueError("not enough samples for the requested folds")
    fold_sizes = [n // k + (1 if i < n % k else 0) for i in range(k)]
    start = 0
    for size in fold_sizes:
        test = np.arange(start, start + size)
        lo = max(0, start - purge)
        hi = min(n, start + size + purge + embargo)
        train = np.concatenate([np.arange(0, lo), np.arange(hi, n)])
        yield train, test
        start += size


# ── Deflated Sharpe ratio ───────────────────────────────────────────────────

def expected_max_sharpe(n_trials: int, var_sharpe: float = 1.0) -> float:
    """E[max SR] of n_trials independent zero-skill strategies (BLdP eq. 4)."""
    if n_trials <= 1:
        return 0.0
    sd = math.sqrt(max(var_sharpe, 1e-12))
    z1 = sstats.norm.ppf(1 - 1.0 / n_trials)
    z2 = sstats.norm.ppf(1 - 1.0 / (n_trials * math.e))
    return sd * ((1 - EULER_GAMMA) * z1 + EULER_GAMMA * z2)


def deflated_sharpe(returns: list[float], n_trials: int = 1) -> dict:
    """DSR: probability the observed (per-period) Sharpe exceeds the expected
    max Sharpe of `n_trials` skill-less tries, honoring skew/kurtosis."""
    r = np.asarray(returns, dtype=float)
    n = len(r)
    if n < 20 or r.std(ddof=1) == 0:
        return {"sharpe": None, "dsr": None, "sr_benchmark": None, "n": n}
    sr = float(r.mean() / r.std(ddof=1))
    skew = float(sstats.skew(r))
    kurt = float(sstats.kurtosis(r, fisher=False))
    sr0 = expected_max_sharpe(max(1, n_trials))
    denom = math.sqrt(max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr * sr))
    z = (sr - sr0) * math.sqrt(n - 1) / denom
    return {
        "sharpe": round(sr * math.sqrt(252), 3),          # annualized, for display
        "sharpe_per_period": round(sr, 4),
        "sr_benchmark": round(sr0, 4),                     # expected max of the trials
        "dsr": round(float(sstats.norm.cdf(z)), 4),        # P(true SR > 0)
        "n": n, "trials": n_trials,
        "skew": round(skew, 3), "kurtosis": round(kurt, 2),
    }


# ── Probability of Backtest Overfitting (CSCV) ──────────────────────────────

def pbo_cscv(returns_matrix: np.ndarray, n_blocks: int = 8) -> dict:
    """returns_matrix: T x C per-period returns of C candidate configs.
    Split time into n_blocks; for every half/half combination, pick the
    in-sample winner and record its out-of-sample rank. PBO = share of
    combinations where the IS winner is below the OOS median."""
    T, C = returns_matrix.shape
    if C < 2 or T < n_blocks * 2:
        return {"pbo": None, "combinations": 0}
    blocks = np.array_split(np.arange(T), n_blocks)
    half = n_blocks // 2
    below_median = 0
    logits = []
    combos = list(combinations(range(n_blocks), half))
    for combo in combos:
        is_idx = np.concatenate([blocks[i] for i in combo])
        oos_idx = np.concatenate([blocks[i] for i in range(n_blocks) if i not in combo])
        is_perf = returns_matrix[is_idx].mean(axis=0)
        oos_perf = returns_matrix[oos_idx].mean(axis=0)
        winner = int(np.argmax(is_perf))
        # rank of the IS winner among OOS performances (0 = worst)
        rank = float((oos_perf < oos_perf[winner]).mean())
        if rank <= 0.5:
            below_median += 1
        w = min(max(rank, 1e-6), 1 - 1e-6)
        logits.append(math.log(w / (1 - w)))
    return {
        "pbo": round(below_median / len(combos), 3),
        "combinations": len(combos),
        "mean_oos_rank_logit": round(float(np.mean(logits)), 3),
    }


# ── Trials registry + hurdle ────────────────────────────────────────────────

def trials_count(kind_prefix: str = "") -> int:
    conn = db.get_conn()
    if kind_prefix:
        row = conn.execute("SELECT COUNT(*) FROM experiments WHERE kind LIKE ?",
                           (kind_prefix + "%",)).fetchone()
    else:
        row = conn.execute("SELECT COUNT(*) FROM experiments").fetchone()
    conn.close()
    return int(row[0] or 0)


def significance_hurdle(n_trials: int) -> float:
    """Harvey–Liu-spirited t-stat bar: 2.0 for a first test, rising with the
    number of recorded trials toward 3.0+ (a Šidák-style adjustment at 5%)."""
    if n_trials <= 1:
        return 2.0
    alpha_adj = 1 - (1 - 0.05) ** (1.0 / n_trials)
    return round(max(2.0, float(sstats.norm.ppf(1 - alpha_adj / 2))), 2)


# ── The alpha gate: capital only touches validated edge ─────────────────────

def alpha_gate() -> dict:
    """The paper book may open NEW positions only when the most recent alpha
    study cleared the trials-adjusted hurdle. Limited resources buy validated
    edge or nothing — mediocre signals stay in research."""
    conn = db.get_conn()
    row = conn.execute(
        "SELECT metrics FROM experiments WHERE kind = 'alpha' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    n_alpha = conn.execute(
        "SELECT COUNT(*) FROM experiments WHERE kind = 'alpha'").fetchone()[0]
    conn.close()

    if row is None:
        return {"cleared": False, "reason": "no alpha study on record yet"}
    import json as _json
    try:
        m = _json.loads(row[0] or "{}")
    except _json.JSONDecodeError:
        m = {}
    t = m.get("ic_t")
    mean = m.get("ic_mean")
    hurdle = significance_hurdle(max(1, n_alpha))
    if t is None or mean is None:
        return {"cleared": False, "hurdle": hurdle,
                "reason": "latest alpha study had too little data for a t-stat"}
    if abs(t) >= hurdle and mean > 0.02:
        return {"cleared": True, "hurdle": hurdle, "t": t, "mean": mean,
                "reason": f"|t|={abs(t)} cleared the {hurdle} hurdle"}
    return {"cleared": False, "hurdle": hurdle, "t": t, "mean": mean,
            "reason": f"latest IC t={t} vs hurdle {hurdle} — capital stays in cash"}
