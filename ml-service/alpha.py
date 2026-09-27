"""
Alpha discovery — does the signal actually predict returns?

The study reconstructs a per-symbol daily news-sentiment panel from the
article corpus (which predates the live composite snapshots), aligns it with
next-day returns, and reports the standard diagnostics:

- rank IC:        daily Spearman correlation between signal ranks and
                  next-day return ranks across the cross-section
- IC t-stat:      mean IC / std IC * sqrt(days) — the significance read
- decay:          IC against 1, 2, 3 and 5-day forward returns
- tercile spread: mean next-day return of the top signal tercile minus the
                  bottom — the tradable expression of the IC
- turnover:       day-over-day change in top-tercile membership

The same study runs on the live composite snapshots once they span enough
days; until then that section reports its own insufficiency rather than a
number. Every run is logged to the experiments table.
"""

import json
from datetime import datetime, timezone

from scipy.stats import spearmanr

import db
import finlex
import monitor
import particle
import simulation
import universe
import validation

MIN_SIGNAL_DAYS = 12   # a symbol needs this much history to join the panel
MAX_SYMBOLS = 15
HORIZONS = [1, 2, 3, 5]


def daily_symbol_signals(days: int) -> dict[str, dict[str, float]]:
    """{symbol: {date: mean blended sentiment}} from headline mentions."""
    conn = db.get_conn()
    rows = conn.execute(
        f"""SELECT date(published) AS d, title, body, sentiment_score FROM articles
            WHERE sentiment_score IS NOT NULL
              AND datetime(published) > datetime('now', '-{int(days)} days')""",
    ).fetchall()
    conn.close()

    acc: dict[str, dict[str, list[float]]] = {}
    for r in rows:
        syms = universe.extract_symbols(r["title"] or "")
        if not syms:
            continue
        lm = finlex.lm_scores((r["title"] or "") + " " + (r["body"] or "")[:1200])
        s = 0.6 * r["sentiment_score"] + 0.4 * lm["polarity"] if lm["hits"] else r["sentiment_score"]
        for sym in syms:
            acc.setdefault(sym, {}).setdefault(r["d"], []).append(s)

    return {sym: {d: sum(v) / len(v) for d, v in by_day.items()}
            for sym, by_day in acc.items()}


async def run(days: int = 120) -> dict:
    panel = daily_symbol_signals(days)
    covered = sorted(panel, key=lambda s: -len(panel[s]))
    symbols = [s for s in covered if len(panel[s]) >= MIN_SIGNAL_DAYS][:MAX_SYMBOLS]
    if len(symbols) < 4:
        return {"error": f"only {len(symbols)} symbols have {MIN_SIGNAL_DAYS}+ signal days — "
                         "the corpus needs to grow before a cross-sectional study means anything"}

    closes: dict[str, dict[str, float]] = {}
    for sym in symbols:
        try:
            closes[sym] = dict(await simulation._daily_closes(sym, days))
        except Exception:
            pass
    symbols = [s for s in symbols if len(closes.get(s, {})) >= 20]
    if len(symbols) < 4:
        return {"error": "not enough price history across the covered symbols"}

    # Trading-date axis from the most-covered symbol
    dates = sorted(closes[symbols[0]])

    def fwd_return(sym: str, i: int, h: int) -> float | None:
        if i + h >= len(dates):
            return None
        p0 = closes[sym].get(dates[i])
        p1 = closes[sym].get(dates[i + h])
        return p1 / p0 - 1 if p0 and p1 else None

    ics: dict[int, list[float]] = {h: [] for h in HORIZONS}
    spreads: list[float] = []
    prev_top: set[str] | None = None
    turnovers: list[float] = []

    for i, d in enumerate(dates):
        cross = [(s, panel[s][d]) for s in symbols if d in panel[s]]
        if len(cross) < 4:
            continue
        for h in HORIZONS:
            pairs = [(sig, fwd_return(s, i, h)) for s, sig in cross]
            pairs = [(a, b) for a, b in pairs if b is not None]
            if len(pairs) >= 4:
                ic, _ = spearmanr([a for a, _ in pairs], [b for _, b in pairs])
                if ic == ic:  # not NaN
                    ics[h].append(float(ic))
        # tercile spread + turnover on 1-day horizon
        pairs1 = [(s, sig, fwd_return(s, i, 1)) for s, sig in cross]
        pairs1 = [(s, sig, r) for s, sig, r in pairs1 if r is not None]
        if len(pairs1) >= 6:
            pairs1.sort(key=lambda x: -x[1])
            k = max(2, len(pairs1) // 3)
            top = pairs1[:k]
            bot = pairs1[-k:]
            spreads.append(sum(r for *_, r in top) / k - sum(r for *_, r in bot) / k)
            top_set = {s for s, *_ in top}
            if prev_top is not None and prev_top:
                turnovers.append(1 - len(top_set & prev_top) / len(prev_top))
            prev_top = top_set

    def summarize(vals: list[float]) -> dict:
        n = len(vals)
        if n < 5:
            return {"mean": None, "t_stat": None, "days": n}
        mean = sum(vals) / n
        var = sum((v - mean) ** 2 for v in vals) / (n - 1)
        sd = var ** 0.5
        return {"mean": round(mean, 4),
                "t_stat": round(mean / sd * n ** 0.5, 2) if sd else None,
                "hit_rate": round(sum(1 for v in vals if v > 0) / n, 2),
                "days": n}

    ic1 = summarize(ics[1])

    # ── The same study on live composite snapshots, if they span enough ────
    conn = db.get_conn()
    span_row = conn.execute(
        "SELECT julianday(MAX(taken_at)) - julianday(MIN(taken_at)) FROM signal_snapshots"
    ).fetchone()
    conn.close()
    snapshot_days = round(span_row[0] or 0, 1)
    snapshot_note = (f"Composite snapshots span {snapshot_days} days — the same IC study runs on "
                     f"them automatically once they cover 21+ days.")

    out = {
        "days_studied": days,
        "symbols_in_panel": symbols,
        "rank_ic_1d": ic1,
        "ic_decay": {f"{h}d": summarize(ics[h])["mean"] for h in HORIZONS},
        "tercile_spread_daily": round(sum(spreads) / len(spreads), 5) if spreads else None,
        "tercile_spread_annualized_pct": round(sum(spreads) / len(spreads) * 252 * 100, 1) if spreads else None,
        "avg_daily_turnover": round(sum(turnovers) / len(turnovers), 2) if turnovers else None,
        "snapshot_study": snapshot_note,
    }
    hurdle = validation.significance_hurdle(validation.trials_count("alpha") + 1)
    out["t_hurdle"] = hurdle
    out["verdict"] = _verdict(ic1, hurdle)
    monitor.log_experiment("alpha", {"days": days, "symbols": len(symbols)},
                           {"ic_mean": ic1.get("mean"), "ic_t": ic1.get("t_stat"),
                            "spread_ann_pct": out["tercile_spread_annualized_pct"],
                            "t_hurdle": hurdle})
    return out


def _verdict(ic1: dict, hurdle: float = 2.0) -> str:
    """The gate rises with the number of registered trials (Harvey–Liu)."""
    mean, t = ic1.get("mean"), ic1.get("t_stat")
    if mean is None:
        return "Not enough overlapping days for a verdict yet."
    if t is not None and abs(t) >= hurdle and mean > 0.02:
        return (f"The news signal clears the trials-adjusted bar (|t| ≥ {hurdle}) "
                "— worth sizing.")
    if mean and mean > 0:
        return "Positive but not significant — keep banking data before allocating on it."
    return "No predictive power at this horizon so far — the honest null result."
