"""
Signal backfill — derive composite history from historical data.

The engine snapshots signals live, so its history began at first boot while
the corpus goes back months and the PIT store years. This module rebuilds
the signal time series retroactively with the SAME scoring the live engine
uses:

- news channel per day: topic-scoped articles, model sentiment blended with
  the Loughran-McDonald lexicon (identical to signal_engine)
- vol regime per day: ^VIX daily closes from the PIT store (ingested here
  if absent)
- per-symbol signals per day: headline mentions x blended sentiment

Channels that cannot be reconstructed honestly (social beyond its 7-day
retention, prediction-market drift, NWS hazards) stay null for backfilled
days, and every backfilled row is marked {"backfilled": true} inside its
components JSON — derived history never masquerades as live capture.
Backfilled rows are replaced wholesale on each run; live rows are never
touched.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone

import db
import finlex
import particle
import pit
import signal_engine
import universe


def _daily_news(days: int) -> tuple[dict, dict, dict]:
    """Per-day channel means and per-(symbol, day) news signals from the
    article corpus — the same blend the live engine applies."""
    universe.ensure_loaded()
    conn = db.get_conn()
    rows = conn.execute(
        f"""SELECT date(published) AS d, title, body, sentiment_score FROM articles
            WHERE sentiment_score IS NOT NULL
              AND datetime(published) > datetime('now', '-{int(days)} days')""",
    ).fetchall()
    conn.close()

    markets: dict[str, list[float]] = {}
    weather: dict[str, list[float]] = {}
    per_symbol: dict[tuple[str, str], list[float]] = {}
    for r in rows:
        topics = set(particle.tag_topics(r["title"] or "", r["body"]))
        s = r["sentiment_score"]
        if topics & signal_engine.MARKET_TOPICS:
            lm = finlex.lm_scores((r["title"] or "") + " " + (r["body"] or "")[:1200])
            s_mkt = 0.6 * s + 0.4 * lm["polarity"] if lm["hits"] else s
            markets.setdefault(r["d"], []).append(s_mkt)
            s = s_mkt
        if topics & signal_engine.WEATHER_TOPICS:
            weather.setdefault(r["d"], []).append(s)
        for sym in universe.extract_symbols(r["title"] or ""):
            per_symbol.setdefault((sym, r["d"]), []).append(s)

    mean = lambda v: sum(v) / len(v)  # noqa: E731
    return ({d: mean(v) for d, v in markets.items()},
            {d: mean(v) for d, v in weather.items()},
            {k: mean(v) for k, v in per_symbol.items()})


async def _vix_by_day(days: int) -> dict[str, float]:
    """^VIX closes from the PIT store; ingested once if missing."""
    conn = pit.connect()
    try:
        px = pit.prices_asof(conn, datetime.now(timezone.utc).isoformat(), symbols=["^VIX"])
    except Exception:
        px = None
    if px is None or px.empty:
        import httpx
        import pit_ingest
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                df = await pit_ingest._yahoo_eod("^VIX", client, years=2)
            pit.write_snapshot("prices_eod", df)
            conn = pit.connect()
            px = pit.prices_asof(conn, datetime.now(timezone.utc).isoformat(), symbols=["^VIX"])
        except Exception as e:
            print(f"[backfill] VIX history unavailable: {e!r}")
            return {}
    return {str(r.date)[:10]: float(r.close) for r in px.itertuples()}


def _clamp(x: float) -> float:
    return max(-1.0, min(1.0, x))


async def backfill(days: int = 180) -> dict:
    news_mkt, news_wx, per_symbol = _daily_news(days)
    vix = await _vix_by_day(days)

    conn = db.get_conn()
    # Replace previous backfill; never touch live rows.
    conn.execute("DELETE FROM signal_snapshots WHERE components LIKE '%\"backfilled\": true%'")
    live_days = {r[0][:10] for r in conn.execute(
        "SELECT DISTINCT date(taken_at) FROM signal_snapshots").fetchall()}

    w = signal_engine.WEIGHTS
    n_rows = 0
    start = datetime.now(timezone.utc).date() - timedelta(days=days)
    for i in range(days):
        d = str(start + timedelta(days=i))
        if d in live_days:
            continue  # the live engine already covered this day
        taken_at = f"{d} 21:00:00"

        # markets: news + vol regime, renormalized over available channels
        comps_m: dict[str, float | None] = {
            "news": round(news_mkt[d], 4) if d in news_mkt else None,
            "social": None, "prediction": None,
            "vol": round(_clamp((20 - vix[d]) * 0.06), 4) if d in vix else None,
            "backfilled": True,
        }
        used = {k: v for k, v in comps_m.items() if isinstance(v, float)}
        if used:
            tw = sum(w[k] for k in used)
            comp = _clamp(sum(w[k] * v for k, v in used.items()) / tw)
            conn.execute("INSERT INTO signal_snapshots (taken_at, entity, composite, components) VALUES (?,?,?,?)",
                         (taken_at, "markets", round(comp, 4), json.dumps(comps_m)))
            n_rows += 1

        if d in news_wx:
            comps_w = {"news": round(news_wx[d], 4), "social": None,
                       "hazards": None, "backfilled": True}
            conn.execute("INSERT INTO signal_snapshots (taken_at, entity, composite, components) VALUES (?,?,?,?)",
                         (taken_at, "weather", round(_clamp(news_wx[d]), 4), json.dumps(comps_w)))
            n_rows += 1

    # per-symbol news signals
    for (sym, d), val in per_symbol.items():
        if d in live_days or d < str(start):
            continue
        conn.execute("INSERT INTO signal_snapshots (taken_at, entity, composite, components) VALUES (?,?,?,?)",
                     (f"{d} 21:00:00", sym, round(_clamp(val), 4),
                      json.dumps({"news": round(val, 4), "backfilled": True})))
        n_rows += 1

    conn.commit()
    span = conn.execute(
        "SELECT julianday(MAX(taken_at)) - julianday(MIN(taken_at)) FROM signal_snapshots").fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM signal_snapshots").fetchone()[0]
    conn.close()
    out = {"backfilled_rows": n_rows, "days_requested": days,
           "history_span_days": round(span or 0, 1), "total_snapshots": total}
    print(f"[backfill] {out}")
    return out


if __name__ == "__main__":
    asyncio.run(backfill())
