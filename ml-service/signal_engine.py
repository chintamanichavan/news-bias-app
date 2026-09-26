"""
Composite signal engine — where every ingested signal meets.

Inputs per cycle (all already in SQLite, all scored by the ML engine where
they're text):
- news:       last-24h article sentiment (topic-tagged, markets or weather)
- social:     last-24h social sentiment + volume change (Reddit/Stocktwits/Bluesky)
- prediction: mean signed 24h probability drift on macro Polymarket markets
- vol regime: VIX level (passed in by the caller, which owns market-data access)
- hazards:    severity-weighted NWS/USGS risk index (weather composite)

Output: composite ∈ [-1, 1] per entity, snapshotted to signal_snapshots so a
time series accumulates. Entities are dynamic — the two verticals plus
whichever securities actually carry signal this cycle (top by mentions across
news + social), so coverage follows the data, not a watchlist.
"""

import json

import db
import finlex
import hazards as hazards_mod
import particle
import social_manager
import universe

MARKET_TOPICS = {"Stocks", "Bonds & Rates", "Macro", "Crypto", "Commodities",
                 "Energy", "Housing", "Currencies", "Weather & Markets"}
WEATHER_TOPICS = {"Severe Weather", "Forecasts", "Climate", "Weather & Markets"}

WEIGHTS = {"news": 0.35, "social": 0.30, "prediction": 0.15, "vol": 0.20}
WEATHER_WEIGHTS = {"news": 0.35, "social": 0.25, "hazards": 0.40}

MAX_SYMBOL_ENTITIES = 50  # per cycle; keeps unbounded universe bounded in compute

# Latest cycle's output, served by the API between cycles.
LAST_RESULTS: list[dict] = []
LAST_RUN: str | None = None


def _clamp(x: float) -> float:
    return max(-1.0, min(1.0, x))


def _news_rows(conn) -> list[dict]:
    return [dict(r) for r in conn.execute(
        """SELECT title, body, sentiment_score FROM articles
           WHERE datetime(published) > datetime('now', '-24 hours')
             AND sentiment_score IS NOT NULL""",
    ).fetchall()]


def _prediction_drift(conn) -> float | None:
    row = conn.execute(
        """SELECT AVG(yes_change_24h) FROM prediction_markets
           WHERE category IN ('macro', 'crypto') AND yes_change_24h IS NOT NULL""",
    ).fetchone()
    return float(row[0]) if row and row[0] is not None else None


def compute_composites(vix: float | None = None) -> list[dict]:
    """One engine cycle: aggregate, compose, snapshot, return."""
    conn = db.get_conn()
    news = _news_rows(conn)
    social = social_manager.social_summary(conn, hours=24)
    hazard = hazards_mod.hazards_summary(conn)
    drift = _prediction_drift(conn)

    # ── Per-vertical news sentiment + per-symbol news mentions ─────────────
    agg = {"markets": [], "weather": []}
    sym_news: dict[str, list[float]] = {}
    for a in news:
        topics = set(particle.tag_topics(a["title"], a["body"]))
        s = a["sentiment_score"]
        if topics & MARKET_TOPICS:
            # Loughran-McDonald blend: finance text scored with the finance
            # lexicon, mixed with the trained model's read
            lm = finlex.lm_scores((a["title"] or "") + " " + (a["body"] or "")[:1200])
            s_mkt = 0.6 * s + 0.4 * lm["polarity"] if lm["hits"] else s
            agg["markets"].append(s_mkt)
            s = s_mkt
        if topics & WEATHER_TOPICS:
            agg["weather"].append(s)
        for sym in universe.extract_symbols(a["title"] or ""):
            sym_news.setdefault(sym, []).append(s)

    def mean(xs):
        return sum(xs) / len(xs) if xs else None

    results: list[dict] = []

    # ── Vertical composites ────────────────────────────────────────────────
    sv = social["verticals"]
    for vertical in ("markets", "weather"):
        news_c = mean(agg[vertical])
        soc = sv.get(vertical, {})
        social_c = soc.get("sentiment")
        # volume spike amplifies whatever direction social already points
        # (Bollen et al. 2011); disagreement damps it (Antweiler & Frank 2004)
        vol_chg = soc.get("volume_change")
        if social_c is not None and vol_chg:
            social_c = _clamp(social_c * (1 + min(1.0, abs(vol_chg))))
        if social_c is not None:
            social_c = round(social_c * (1 - 0.5 * min(1.0, soc.get("disagreement", 0.0))), 3)

        comps: dict[str, float | None] = {"news": news_c, "social": social_c}
        if vertical == "markets":
            comps["prediction"] = _clamp(drift * 5) if drift is not None else None
            # VIX 15 -> +0.3 calm, 25 -> -0.3, 35 -> -0.9
            comps["vol"] = _clamp((20 - vix) * 0.06) if vix is not None else None
            weights = WEIGHTS
        else:
            comps["hazards"] = -hazard["risk_index"] if hazard else None
            weights = WEATHER_WEIGHTS

        used = {k: v for k, v in comps.items() if v is not None}
        total_w = sum(weights[k] for k in used)
        composite = _clamp(sum(weights[k] * v for k, v in used.items()) / total_w) if total_w else 0.0
        results.append({
            "entity": vertical, "name": vertical.title(), "composite": round(composite, 3),
            "components": {k: (round(v, 3) if v is not None else None) for k, v in comps.items()},
            "inputs": {"news_articles": len(agg[vertical]), "social_posts": soc.get("posts", 0)},
        })

    # ── Per-security composites: whichever symbols carry signal today ─────
    sym_social = {s["symbol"]: s for s in social["symbols"]}
    activity = {sym: len(v) for sym, v in sym_news.items()}
    for sym, s in sym_social.items():
        activity[sym] = activity.get(sym, 0) + s["posts"]
    top = sorted(activity, key=lambda s: -activity[s])[:MAX_SYMBOL_ENTITIES]

    for sym in top:
        news_c = mean(sym_news.get(sym, []))
        soc = sym_social.get(sym)
        social_c = soc["sentiment"] if soc else None
        used = [(0.5, news_c), (0.5, social_c)]
        used = [(w, v) for w, v in used if v is not None]
        if not used:
            continue
        composite = _clamp(sum(w * v for w, v in used) / sum(w for w, _ in used))
        info = universe.lookup(sym)
        results.append({
            "entity": sym,
            "name": info["name"] if info else sym,
            "asset_class": info["asset_class"] if info else None,
            "composite": round(composite, 3),
            "components": {"news": round(news_c, 3) if news_c is not None else None,
                           "social": round(social_c, 3) if social_c is not None else None},
            "inputs": {"news_articles": len(sym_news.get(sym, [])),
                       "social_posts": soc["posts"] if soc else 0},
        })

    # ── Snapshot the time series ───────────────────────────────────────────
    for r in results:
        conn.execute(
            "INSERT INTO signal_snapshots (entity, composite, components) VALUES (?,?,?)",
            (r["entity"], r["composite"], json.dumps(r["components"])),
        )
    conn.execute("DELETE FROM signal_snapshots WHERE datetime(taken_at) < datetime('now', '-30 days')")
    conn.commit()
    conn.close()

    global LAST_RESULTS, LAST_RUN
    LAST_RESULTS = results
    from datetime import datetime, timezone
    LAST_RUN = datetime.now(timezone.utc).isoformat()
    return results


def history(entity: str, hours: int = 72) -> list[dict]:
    conn = db.get_conn()
    rows = [dict(r) for r in conn.execute(
        f"""SELECT taken_at, composite FROM signal_snapshots
            WHERE entity = ? AND datetime(taken_at) > datetime('now', '-{int(hours)} hours')
            ORDER BY taken_at""",
        (entity,),
    ).fetchall()]
    conn.close()
    return rows
