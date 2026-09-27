"""
Risk management — the portfolio-level layer the per-trade rules don't cover.

- realized_vol:     annualized daily vol from closes (the sizing input)
- portfolio_var:    parametric 1-day 95% VaR with a flat correlation
                    assumption, stated as such — a lens, not a guarantee
- class_exposures:  book weight per asset class, with caps enforced by the
                    optimizer at rebalance

Vol-aware sizing itself lives in optimizer.py; this module supplies the
inputs and the report.
"""

import math

import universe

TRADING_DAYS = 252
VAR_Z_95 = 1.645
ASSUMED_CORR = 0.35   # flat pairwise correlation for the parametric VaR
DEFAULT_VOL = 0.35    # annualized fallback when history is too short

# No single asset class may exceed this share of equity at rebalance.
CLASS_CAPS = {"crypto": 0.30, "equity": 0.80, "etf": 0.80, "future": 0.40,
              "fx": 0.40, "index": 0.60}


def realized_vol(closes: list[float]) -> float:
    """Annualized vol from daily closes; falls back when history is thin."""
    if len(closes) < 10:
        return DEFAULT_VOL
    rets = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes)) if closes[i - 1]]
    if len(rets) < 8:
        return DEFAULT_VOL
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)
    return max(0.05, math.sqrt(var * TRADING_DAYS))


def asset_class(symbol: str) -> str:
    info = universe.lookup(symbol)
    return (info or {}).get("asset_class") or "equity"


def portfolio_var(weights: dict[str, float], vols: dict[str, float]) -> float:
    """1-day 95% parametric VaR as a fraction of equity, flat-correlation.
    sigma_p^2 = sum(w_i^2 s_i^2) + rho * sum_{i != j}(w_i s_i w_j s_j)."""
    if not weights:
        return 0.0
    terms = {s: weights[s] * vols.get(s, DEFAULT_VOL) / math.sqrt(TRADING_DAYS)
             for s in weights}
    sum_sq = sum(t * t for t in terms.values())
    sum_all = sum(terms.values())
    var_p = sum_sq + ASSUMED_CORR * (sum_all * sum_all - sum_sq)
    return VAR_Z_95 * math.sqrt(max(0.0, var_p))


def class_exposures(weights: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = {}
    for sym, w in weights.items():
        c = asset_class(sym)
        out[c] = out.get(c, 0.0) + w
    return {c: round(w, 4) for c, w in out.items()}


# ── Ledoit–Wolf shrinkage covariance ─────────────────────────────────────────
# Ledoit & Wolf (2004, JPM, "Honey, I Shrunk the Sample Covariance Matrix"):
# the sample covariance is shrunk toward the constant-correlation target with
# the intensity their estimator picks from the data. Replaces the flat-0.35
# assumption whenever enough joint history exists; the flat number stays as
# the fallback for thin books.

def ledoit_wolf_cov(rets) -> tuple["np.ndarray", float]:
    """rets: T×N matrix of daily returns. Returns (daily covariance, delta),
    delta being the shrinkage intensity actually applied (0 = pure sample,
    1 = pure constant-correlation target)."""
    import numpy as np
    rets = np.asarray(rets, dtype=float)
    t, n = rets.shape
    x = rets - rets.mean(axis=0)
    s = x.T @ x / t
    sd = np.sqrt(np.diag(s))
    outer = np.outer(sd, sd)
    with np.errstate(invalid="ignore", divide="ignore"):
        corr = np.where(outer > 0, s / outer, 0.0)
    rbar = (corr.sum() - n) / (n * (n - 1)) if n > 1 else 0.0
    f = rbar * outer
    np.fill_diagonal(f, np.diag(s))

    y = x ** 2
    pi_mat = (y.T @ y) / t - s ** 2
    pi_hat = pi_mat.sum()
    # rho: exact diagonal + the asymptotic off-diagonal term (covCor form)
    theta = ((x ** 3).T @ x) / t - np.diag(s)[:, None] * s
    np.fill_diagonal(theta, 0.0)
    with np.errstate(invalid="ignore", divide="ignore"):
        scale = np.where(sd[:, None] > 0, sd[None, :] / sd[:, None], 0.0)
    rho_hat = np.trace(pi_mat) + rbar * (scale * theta).sum()
    gamma_hat = np.linalg.norm(s - f, "fro") ** 2

    delta = 1.0 if gamma_hat <= 0 else max(0.0, min(1.0, (pi_hat - rho_hat) / gamma_hat / t))
    return delta * f + (1 - delta) * s, float(delta)


def pit_cov(symbols: list[str], lookback: int = 120):
    """(symbols_found, daily LW covariance, delta) from the PIT store's joint
    close history, or None when fewer than two names have enough overlap."""
    import numpy as np
    import pandas as pd

    import pit
    from datetime import datetime, timezone
    try:
        conn = pit.connect()
        px = pit.prices_asof(conn, datetime.now(timezone.utc).isoformat())
    except Exception:
        return None
    px = px[px["symbol"].isin(symbols)]
    if px.empty:
        return None
    wide = px.pivot_table(index="date", columns="symbol", values="close").sort_index()
    wide = wide.dropna(axis=1, thresh=int(len(wide) * 0.6)).tail(lookback + 1)
    rets = wide.pct_change().dropna()
    if rets.shape[1] < 2 or len(rets) < 40:
        return None
    cov, delta = ledoit_wolf_cov(rets.to_numpy())
    return list(rets.columns), cov, delta


def portfolio_var_cov(weights: dict[str, float], symbols: list[str], cov) -> float:
    """1-day 95% parametric VaR from an estimated (LW) daily covariance."""
    import numpy as np
    w = np.array([weights.get(s, 0.0) for s in symbols], dtype=float)
    return float(VAR_Z_95 * math.sqrt(max(0.0, w @ cov @ w)))
