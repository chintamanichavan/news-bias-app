"""
Simulation — backtest the news-sentiment channel against real price history.

The composite snapshots only accumulate from launch day, but the article
corpus goes back further with per-article model sentiment. So the simulable
signal is the daily market-news sentiment series (with the Loughran-McDonald
blend), traded against Yahoo daily closes:

    long SYMBOL when the trailing SIGNAL_WINDOW-day mean sentiment > 0,
    cash otherwise; next-day open approximated by next close (no lookahead:
    day t's signal trades day t+1's return).

Reported against buy-and-hold with the usual stats. It's a single-asset
timing toy, labeled as such — the point is the harness: data alignment,
no-lookahead discipline, and honest comparison.
"""

import math

import httpx

import db
import finlex
import particle

YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
}
SIGNAL_WINDOW = 3  # trailing days of news sentiment


def _daily_news_sentiment(conn, days: int) -> dict[str, float]:
    """date -> mean market-scoped sentiment (model + LM blend)."""
    rows = conn.execute(
        f"""SELECT date(published) AS d, title, body, sentiment_score FROM articles
            WHERE sentiment_score IS NOT NULL
              AND datetime(published) > datetime('now', '-{int(days)} days')""",
    ).fetchall()
    by_day: dict[str, list[float]] = {}
    for r in rows:
        topics = set(particle.tag_topics(r["title"] or "", r["body"]))
        if not (topics & {"Stocks", "Bonds & Rates", "Macro", "Crypto", "Commodities",
                          "Energy", "Housing", "Currencies", "Weather & Markets"}):
            continue
        lm = finlex.lm_scores((r["title"] or "") + " " + (r["body"] or "")[:1200])
        s = 0.6 * r["sentiment_score"] + 0.4 * lm["polarity"] if lm["hits"] else r["sentiment_score"]
        by_day.setdefault(r["d"], []).append(s)
    return {d: sum(v) / len(v) for d, v in by_day.items() if v}


async def _daily_closes(symbol: str, days: int) -> list[tuple[str, float]]:
    rng = "1y" if days > 180 else "6mo" if days > 90 else "3mo"
    async with httpx.AsyncClient(timeout=15, headers=YAHOO_HEADERS) as client:
        r = await client.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
            params={"range": rng, "interval": "1d"},
        )
        r.raise_for_status()
        result = r.json()["chart"]["result"][0]
    stamps = result["timestamp"]
    closes = result["indicators"]["quote"][0]["close"]
    from datetime import datetime, timezone
    out = []
    for t, c in zip(stamps, closes):
        if c is not None:
            out.append((datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%d"), float(c)))
    return out


def _stats(returns: list[float]) -> dict:
    if not returns:
        return {"total_return_pct": 0.0, "sharpe": None, "max_drawdown_pct": 0.0}
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    for r in returns:
        equity *= 1 + r
        peak = max(peak, equity)
        max_dd = min(max_dd, equity / peak - 1)
    mean = sum(returns) / len(returns)
    var = sum((r - mean) ** 2 for r in returns) / max(1, len(returns) - 1)
    sd = math.sqrt(var)
    sharpe = round(mean / sd * math.sqrt(252), 2) if sd > 0 else None
    return {
        "total_return_pct": round((equity - 1) * 100, 2),
        "sharpe": sharpe,
        "max_drawdown_pct": round(max_dd * 100, 2),
    }


async def run(symbol: str = "SPY", days: int = 120) -> dict:
    conn = db.get_conn()
    senti = _daily_news_sentiment(conn, days)
    conn.close()
    closes = await _daily_closes(symbol, days)
    if len(closes) < 10:
        return {"error": "not enough price history"}

    dates = [d for d, _ in closes]
    px = [p for _, p in closes]

    # Signal on day t decides exposure over t -> t+1. Trailing mean over the
    # last SIGNAL_WINDOW calendar days that had scored articles.
    strat_rets: list[float] = []
    hold_rets: list[float] = []
    curve = []
    exposure_days = 0
    equity = 1.0
    known_days = sorted(senti)
    for i in range(1, len(px)):
        window = [senti[d] for d in known_days if d <= dates[i - 1]][-SIGNAL_WINDOW:]
        signal_on = bool(window) and sum(window) / len(window) > 0
        day_ret = px[i] / px[i - 1] - 1
        strat = day_ret if signal_on else 0.0
        if signal_on:
            exposure_days += 1
        strat_rets.append(strat)
        hold_rets.append(day_ret)
        equity *= 1 + strat
        curve.append({"date": dates[i], "strategy": round(equity, 4),
                      "hold": round(px[i] / px[0], 4)})

    return {
        "symbol": symbol,
        "days_simulated": len(strat_rets),
        "signal_days_available": len(senti),
        "exposure_pct": round(exposure_days / len(strat_rets) * 100, 1),
        "signal_window_days": SIGNAL_WINDOW,
        "strategy": _stats(strat_rets),
        "buy_and_hold": _stats(hold_rets),
        "curve": curve,
        "note": ("Single-asset timing on the daily market-news sentiment series; "
                 "day t's signal trades day t+1's return (no lookahead). "
                 "Signal history is only as old as the article corpus."),
    }
