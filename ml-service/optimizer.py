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


def optimize(signals: dict[str, float], vols: dict[str, float]) -> dict[str, float]:
    """signals: composite per symbol (only entries you'd hold — positive).
    Returns target weights summing to <= 1; the shortfall is cash."""
    if not signals:
        return {}

    raw = {s: max(0.0, sig) / max(0.05, vols.get(s, risk.DEFAULT_VOL))
           for s, sig in signals.items()}
    total = sum(raw.values())
    if total <= 0:
        return {}
    weights = {s: v / total for s, v in raw.items()}

    # Per-name cap, redistributing the excess to uncapped names (two passes
    # is enough at this book size).
    for _ in range(2):
        excess = 0.0
        uncapped = []
        for s, w in weights.items():
            if w > MAX_WEIGHT:
                excess += w - MAX_WEIGHT
                weights[s] = MAX_WEIGHT
            elif w < MAX_WEIGHT - 1e-9:
                uncapped.append(s)
        if excess <= 1e-9 or not uncapped:
            break
        pool = sum(weights[s] for s in uncapped)
        for s in uncapped:
            weights[s] += excess * (weights[s] / pool if pool else 1 / len(uncapped))

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
    est_daily_var = risk.portfolio_var(weights, vols)
    est_annual_vol = est_daily_var / risk.VAR_Z_95 * math.sqrt(risk.TRADING_DAYS)
    if est_annual_vol > TARGET_VOL:
        scale = TARGET_VOL / est_annual_vol
        weights = {s: w * scale for s, w in weights.items()}

    return {s: round(w, 4) for s, w in weights.items() if w >= 0.01}
