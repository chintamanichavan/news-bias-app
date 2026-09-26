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
