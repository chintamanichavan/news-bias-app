"""
Portfolio optimization — risk-adjusted signal weighting with constraints.

Weights are proportional to signal / vol (the strongest conviction per unit
of risk gets the most capital), then constrained:

  1. per-name cap
  2. per-asset-class caps (risk.CLASS_CAPS)
  3. portfolio vol scaled down to TARGET_VOL when the flat-correlation
     estimate exceeds it — the remainder stays in cash

This is deliberately closed-form (no scipy optimizer): every weight is
explainable as "signal over risk, clipped by caps". A mean-variance step
belongs here later, after alpha discovery justifies estimating expected
returns at all.
"""

import math

import risk

TARGET_VOL = 0.15   # annualized portfolio vol target
MAX_WEIGHT = 0.25   # per-name cap


def optimize(signals: dict[str, float], vols: dict[str, float],
             cov=None) -> dict[str, float]:
    """signals: composite per symbol (only entries you'd hold — positive).
    Returns target weights summing to <= 1; the shortfall is cash.
    cov: optional (symbols, daily covariance[, delta]) from risk.pit_cov —
    when present, the vol-target step uses the Ledoit–Wolf estimate instead
    of the flat-correlation approximation."""
    if not signals:
        return {}

    raw = {s: max(0.0, sig) / max(0.05, vols.get(s, risk.DEFAULT_VOL))
           for s, sig in signals.items()}
    total = sum(raw.values())
    if total <= 0:
        return {}
    weights = {s: v / total for s, v in raw.items()}

    # Per-name cap. Excess goes to cash, NOT to other names — redistribution
    # was quietly shoveling capped-off weight into the highest-vol asset,
    # breaking the signal-per-unit-risk ordering the whole scheme promises.
    for s, w in weights.items():
        if w > MAX_WEIGHT:
            weights[s] = MAX_WEIGHT

    # Class caps: scale each over-cap class down; freed weight becomes cash.
    exposures = risk.class_exposures(weights)
    for cls, exp in exposures.items():
        cap = risk.CLASS_CAPS.get(cls, 0.6)
        if exp > cap:
            scale = cap / exp
            for s in list(weights):
                if risk.asset_class(s) == cls:
                    weights[s] *= scale

    # Vol target: scale the whole book down when estimated vol runs hot.
    if cov is not None and set(weights) & set(cov[0]):
        est_daily_var = risk.portfolio_var_cov(weights, cov[0], cov[1])
    else:
        est_daily_var = risk.portfolio_var(weights, vols)
    est_annual_vol = est_daily_var / risk.VAR_Z_95 * math.sqrt(risk.TRADING_DAYS)
    if est_annual_vol > TARGET_VOL:
        scale = TARGET_VOL / est_annual_vol
        weights = {s: w * scale for s, w in weights.items()}

    return {s: round(w, 4) for s, w in weights.items() if w >= 0.01}


# ── Hierarchical Risk Parity ─────────────────────────────────────────────────
# López de Prado (2016, JPM, "Building Diversified Portfolios that Outperform
# Out of Sample"): cluster the correlation matrix, quasi-diagonalize, then
# split risk down the tree by inverse cluster variance. No matrix inversion,
# so it stays sane exactly where Markowitz blows up. Signal-blind by design —
# reported beside the signal/vol book as the risk-only alternative, not
# traded in its place.

def _cluster_var(cov, idx) -> float:
    import numpy as np
    sub = cov[np.ix_(idx, idx)]
    iv = 1.0 / np.diag(sub)
    iv /= iv.sum()
    return float(iv @ sub @ iv)


def hrp_weights(symbols: list[str], cov) -> dict[str, float]:
    """Long-only weights summing to 1 over `symbols`, given their daily
    covariance (same order)."""
    import numpy as np
    import scipy.cluster.hierarchy as sch
    from scipy.spatial.distance import squareform

    n = len(symbols)
    if n == 1:
        return {symbols[0]: 1.0}
    sd = np.sqrt(np.diag(cov))
    corr = np.clip(cov / np.outer(sd, sd), -1.0, 1.0)
    dist = np.sqrt(0.5 * (1.0 - corr))
    np.fill_diagonal(dist, 0.0)
    link = sch.linkage(squareform(dist, checks=False), method="single")
    order = sch.leaves_list(link).tolist()

    w = np.ones(n)
    stack = [order]
    while stack:
        cl = stack.pop()
        if len(cl) < 2:
            continue
        left, right = cl[: len(cl) // 2], cl[len(cl) // 2:]
        v_l, v_r = _cluster_var(cov, left), _cluster_var(cov, right)
        alpha = 1.0 - v_l / (v_l + v_r) if (v_l + v_r) > 0 else 0.5
        w[left] *= alpha
        w[right] *= 1.0 - alpha
        stack += [left, right]
    w /= w.sum()
    return {symbols[i]: round(float(w[i]), 4) for i in range(n)}
