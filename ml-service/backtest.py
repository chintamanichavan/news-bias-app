"""
Multi-asset walk-forward backtester with transaction costs.

Strategy family under test: each day, hold the top-K symbols by trailing
W-day mean news sentiment (long only, equal weight; cash when fewer than K
qualify). Day-t signal trades day t+1 — no lookahead. Costs: 10 bps
commission-equivalent plus 5 bps slippage per side, charged on turnover.

Validation is walk-forward: the period splits into three equal folds; the
window W is chosen on the folds before each test fold and applied
out-of-sample, so the reported OOS numbers never saw their own data during
selection. Benchmark: equal-weight buy-and-hold of the same universe with
the same starting costs. Runs are logged to the experiments table.
"""

import math

import numpy as np

import alpha
import monitor
import simulation
import validation

# 10 bps costs + 5 bps slippage — doubled for the sub-$10 band, where real
# spreads are wider than large-cap assumptions admit.
COST_PER_SIDE = 0.0015
BAND_COST_PER_SIDE = 0.0030
TOP_K = 3
WINDOWS = [2, 3, 5]
N_FOLDS = 3
MAX_SYMBOLS = 10


def _stats(returns: list[float]) -> dict:
    if not returns:
        return {"total_return_pct": None, "sharpe": None, "max_drawdown_pct": None}
    equity, peak, max_dd = 1.0, 1.0, 0.0
    for r in returns:
        equity *= 1 + r
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1)
    mean = sum(returns) / len(returns)
    var = sum((r - mean) ** 2 for r in returns) / max(1, len(returns) - 1)
    sd = math.sqrt(var)
    return {
        "total_return_pct": round((equity - 1) * 100, 2),
        "sharpe": round(mean / sd * math.sqrt(252), 2) if sd > 0 else None,
        "max_drawdown_pct": round(max_dd * 100, 2),
    }


def _daily_strategy_returns(dates, closes, panel, symbols, window, lo, hi,
                            cost: float = COST_PER_SIDE) -> list[float]:
    """Net daily returns of the top-K strategy on dates[lo:hi]."""
    rets: list[float] = []
    prev_hold: set[str] = set()
    for i in range(max(lo, 1), hi):
        d_signal = dates[i - 1]
        scores = []
        for s in symbols:
            hist = [panel[s][d] for d in sorted(panel[s]) if d <= d_signal][-window:]
            if hist:
                m = sum(hist) / len(hist)
                if m > 0:
                    scores.append((s, m))
        scores.sort(key=lambda x: -x[1])
        hold = {s for s, _ in scores[:TOP_K]}

        day_ret = 0.0
        if hold:
            per = 1 / len(hold)
            for s in hold:
                p0 = closes[s].get(dates[i - 1])
                p1 = closes[s].get(dates[i])
                if p0 and p1:
                    day_ret += per * (p1 / p0 - 1)
        # cost on names traded (entered or exited), charged as turnover
        traded = len(hold ^ prev_hold)
        charge = traded * (1 / max(1, len(hold) or len(prev_hold) or 1)) * cost
        rets.append(day_ret - charge)
        prev_hold = hold
    return rets


async def run(days: int = 150) -> dict:
    panel = alpha.daily_symbol_signals(days)
    covered = sorted(panel, key=lambda s: -len(panel[s]))
    symbols = [s for s in covered if len(panel[s]) >= alpha.MIN_SIGNAL_DAYS][:MAX_SYMBOLS]
    if len(symbols) < 4:
        return {"error": "universe too thin for a portfolio backtest — corpus still growing"}

    closes = {}
    for s in symbols:
        try:
            closes[s] = dict(await simulation._daily_closes(s, days))
        except Exception:
            pass
    symbols = [s for s in symbols if len(closes.get(s, {})) >= 30]
    if len(symbols) < 4:
        return {"error": "not enough price history across the universe"}

    dates = sorted(set.intersection(*(set(closes[s]) for s in symbols)))
    if len(dates) < 45:
        return {"error": "too few common trading days across the universe"}

    # Sub-$10 universes pay sub-$10 spreads
    import universe as _u
    last_prices = sorted(closes[s][dates[-1]] for s in symbols if dates[-1] in closes[s])
    median_px = last_prices[len(last_prices) // 2] if last_prices else 1e9
    cost = BAND_COST_PER_SIDE if median_px <= _u.price_band()[1] else COST_PER_SIDE

    fold_size = len(dates) // N_FOLDS
    folds = []
    oos_returns: list[float] = []
    for f in range(1, N_FOLDS):
        train_hi = f * fold_size
        test_lo, test_hi = train_hi, min((f + 1) * fold_size, len(dates))
        # pick W on everything before the test fold
        best_w, best_sharpe = WINDOWS[0], -99.0
        for w in WINDOWS:
            s = _stats(_daily_strategy_returns(dates, closes, panel, symbols, w, 1, train_hi, cost))
            sh = s["sharpe"] if s["sharpe"] is not None else -99.0
            if sh > best_sharpe:
                best_w, best_sharpe = w, sh
        test = _daily_strategy_returns(dates, closes, panel, symbols, best_w, test_lo, test_hi, cost)
        oos_returns.extend(test)
        folds.append({"fold": f + 1, "chosen_window": best_w,
                      "train_sharpe": round(best_sharpe, 2),
                      "oos": _stats(test)})

    # benchmark: equal-weight buy-and-hold across the same universe
    bench: list[float] = []
    start = fold_size  # OOS region only, apples to apples
    for i in range(max(start, 1), len(dates)):
        r = 0.0
        n = 0
        for s in symbols:
            p0, p1 = closes[s].get(dates[i - 1]), closes[s].get(dates[i])
            if p0 and p1:
                r += p1 / p0 - 1
                n += 1
        bench.append(r / n if n else 0.0)

    # ── Phase 2 guards: this result may not overstate itself ───────────────
    # Trials: every prior backtest experiment counts against this one's DSR.
    n_trials = validation.trials_count("backtest") + len(WINDOWS)
    dsr = validation.deflated_sharpe(oos_returns, n_trials=n_trials)
    # PBO across the config family (each window's full-period return stream)
    full = np.array([
        _daily_strategy_returns(dates, closes, panel, symbols, w, 1, len(dates), cost)
        for w in WINDOWS
    ]).T
    pbo = validation.pbo_cscv(full) if full.size else {"pbo": None}

    out = {
        "universe": symbols,
        "common_days": len(dates),
        "cost_per_side_bps": cost * 10_000,
        "top_k": TOP_K,
        "folds": folds,
        "oos_combined": _stats(oos_returns),
        "benchmark_oos": _stats(bench),
        "deflated_sharpe": dsr,
        "pbo": pbo,
        "caveats": [validation.SURVIVORSHIP_CAVEAT],
        "note": ("Walk-forward: the window is chosen only on data before each test fold. "
                 "OOS combined concatenates the test folds; the benchmark holds the same "
                 "universe equal-weight over the same OOS days. DSR discounts the Sharpe "
                 "for every registered trial; PBO is CSCV over the config family."),
    }
    monitor.log_experiment("backtest", {"days": days, "universe": len(symbols), "top_k": TOP_K},
                           {"oos": out["oos_combined"], "bench": out["benchmark_oos"],
                            "dsr": dsr.get("dsr"), "pbo": pbo.get("pbo")})
    return out
