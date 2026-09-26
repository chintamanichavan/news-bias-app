"""
Social-media signal ingester — the pipeline's third text source after RSS and
prediction markets.

Platforms (all public, no API keys):
- Reddit hot posts:   market subs (wallstreetbets, stocks, investing,
                      StockMarket) + weather subs (weather, TropicalWeather)
- Stocktwits streams: a symbol watchlist; native Bullish/Bearish tags are kept
                      as free labeled data for sentiment retraining
- Bluesky search:     public appview search for market/weather phrases

Every post runs through the sentiment model at ingest, so the engine reads
one uniform schema: (text, weight, polarity, intensity, symbols).

X/Twitter is omitted: its API is paywalled. Google Trends has no public API.
"""

import asyncio
import json
import re
from datetime import datetime, timezone

import httpx

import db
import finlex
import universe

USER_AGENT = "Artha/1.0 (signal research; contact via repo)"
# Reddit's API rules want a "platform:app:version (by /u/name)" UA; anything
# generic gets a 403 from their edge.
REDDIT_UA = "linux:clearlens.signals:v1.0 (by /u/clearlens_research)"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")
REFRESH_INTERVAL = 900  # 15 minutes

REDDIT_SUBS = {
    "markets": ["wallstreetbets", "stocks", "investing", "StockMarket"],
    "weather": ["weather", "TropicalWeather"],
}
STOCKTWITS_SYMBOLS = ["SPY", "QQQ", "NVDA", "TSLA", "AAPL", "BTC.X"]
BLUESKY_QUERIES = {
    "markets": ["stock market", "fed rates"],
    "weather": ["hurricane forecast", "severe weather"],
}

# Symbol extraction runs against the global securities registry (universe.py):
# cashtags, registered tickers, and issuer-name mentions.
_symbols_of = universe.extract_symbols


def _upsert(conn, row: dict):
    conn.execute(
        """INSERT INTO social_posts
           (id, platform, channel, vertical, title, url, created, score,
            num_comments, symbols, sentiment, intensity, label)
           VALUES (:id, :platform, :channel, :vertical, :title, :url, :created,
                   :score, :num_comments, :symbols, :sentiment, :intensity, :label)
           ON CONFLICT(id) DO UPDATE SET
             score=excluded.score, num_comments=excluded.num_comments,
             fetched_at=CURRENT_TIMESTAMP""",
        row,
    )


def _scored(model, title: str) -> tuple[float, float]:
    """Blend of the trained model and the VADER-style rule scorer (Hutto &
    Gilbert 2014) — short slangy posts defeat a news-trained model alone."""
    try:
        pol, inten, _ = model.predict(title, "")
    except Exception:
        pol, inten = 0.0, 0.0
    rule = finlex.social_score(title)
    return round(0.5 * pol + 0.5 * rule, 3), inten


async def _fetch_reddit(client: httpx.AsyncClient, model, conn) -> int:
    n = 0
    for vertical, subs in REDDIT_SUBS.items():
        for sub in subs:
            try:
                r = await client.get(
                    f"https://www.reddit.com/r/{sub}/hot.json",
                    params={"limit": 40}, headers={"User-Agent": REDDIT_UA},
                )
                r.raise_for_status()
                children = r.json()["data"]["children"]
            except Exception as e:
                print(f"[social] reddit r/{sub} failed: {e!r}")
                continue
            for c in children:
                d = c.get("data", {})
                title = d.get("title") or ""
                if not title or d.get("stickied"):
                    continue
                pol, inten = _scored(model, title)
                _upsert(conn, {
                    "id": f"reddit:{d.get('id')}",
                    "platform": "reddit", "channel": sub, "vertical": vertical,
                    "title": title[:500],
                    "url": "https://reddit.com" + (d.get("permalink") or ""),
                    "created": datetime.fromtimestamp(d.get("created_utc", 0), tz=timezone.utc).isoformat(),
                    "score": int(d.get("score") or 0),
                    "num_comments": int(d.get("num_comments") or 0),
                    "symbols": json.dumps(_symbols_of(title)),
                    "sentiment": pol, "intensity": inten, "label": None,
                })
                n += 1
    return n


async def _fetch_stocktwits(client: httpx.AsyncClient, model, conn) -> int:
    n = 0
    for sym in STOCKTWITS_SYMBOLS:
        try:
            r = await client.get(
                f"https://api.stocktwits.com/api/2/streams/symbol/{sym}.json",
                headers={"User-Agent": USER_AGENT},
            )
            r.raise_for_status()
            messages = r.json().get("messages", [])
        except Exception as e:
            print(f"[social] stocktwits {sym} failed: {e!r}")
            continue
        for m in messages:
            body = (m.get("body") or "")[:500]
            if not body:
                continue
            label = ((m.get("entities") or {}).get("sentiment") or {}) or {}
            pol, inten = _scored(model, body)
            _upsert(conn, {
                "id": f"stocktwits:{m.get('id')}",
                "platform": "stocktwits", "channel": sym, "vertical": "markets",
                "title": body,
                "url": f"https://stocktwits.com/symbol/{sym}",
                "created": m.get("created_at"),
                "score": int((m.get("likes") or {}).get("total") or 0),
                "num_comments": 0,
                "symbols": json.dumps(sorted(set(_symbols_of(body)) |
                                             {universe._CRYPTO_CANON.get(sym.replace('.X', ''), sym.replace('.X', ''))})),
                "sentiment": pol, "intensity": inten,
                "label": label.get("basic"),
            })
            n += 1
    return n


async def _fetch_bluesky(client: httpx.AsyncClient, model, conn) -> int:
    n = 0
    for vertical, queries in BLUESKY_QUERIES.items():
        for q in queries:
            try:
                r = await client.get(
                    "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts",
                    params={"q": q, "limit": 30, "sort": "latest"},
                    headers={"User-Agent": BROWSER_UA},
                )
                r.raise_for_status()
                posts = r.json().get("posts", [])
            except Exception as e:
                print(f"[social] bluesky '{q}' failed: {e!r}")
                continue
            for p in posts:
                text = ((p.get("record") or {}).get("text") or "")[:500]
                if not text:
                    continue
                pol, inten = _scored(model, text)
                _upsert(conn, {
                    "id": f"bluesky:{p.get('cid')}",
                    "platform": "bluesky", "channel": q, "vertical": vertical,
                    "title": text,
                    "url": p.get("uri") or "",
                    "created": (p.get("record") or {}).get("createdAt"),
                    "score": int(p.get("likeCount") or 0),
                    "num_comments": int(p.get("replyCount") or 0),
                    "symbols": json.dumps(_symbols_of(text)),
                    "sentiment": pol, "intensity": inten, "label": None,
                })
                n += 1
    return n


async def poll_social(model) -> int:
    conn = db.get_conn()
    total = 0
    async with httpx.AsyncClient(timeout=15) as client:
        for fetcher in (_fetch_reddit, _fetch_stocktwits, _fetch_bluesky):
            total += await fetcher(client, model, conn)
    # Keep a rolling week — the composites only read 48h.
    conn.execute("DELETE FROM social_posts WHERE datetime(fetched_at) < datetime('now', '-7 days')")
    conn.commit()
    conn.close()
    print(f"[social] ingested/updated {total} posts")
    return total


async def periodic_refresh(model):
    while True:
        await asyncio.sleep(REFRESH_INTERVAL)
        try:
            await poll_social(model)
        except Exception as e:
            print(f"[social] refresh failed: {e!r}")


def social_summary(conn, hours: int = 24) -> dict:
    """Aggregates for the API + signal engine: per-vertical mood and per-symbol
    buzz, with volume change vs the previous window."""
    rows = conn.execute(
        f"""SELECT vertical, platform, title, score, symbols, sentiment, intensity, created, url, channel
            FROM social_posts
            WHERE datetime(fetched_at) > datetime('now', '-{int(hours)} hours')""",
    ).fetchall()
    prev_counts = dict(conn.execute(
        f"""SELECT vertical, COUNT(*) FROM social_posts
            WHERE datetime(fetched_at) <= datetime('now', '-{int(hours)} hours')
              AND datetime(fetched_at) > datetime('now', '-{int(hours * 2)} hours')
            GROUP BY vertical""",
    ).fetchall())

    import math
    verticals: dict[str, dict] = {}
    symbols: dict[str, dict] = {}
    for r in rows:
        r = dict(r)
        w = math.log((r["score"] or 0) + 2)
        v = verticals.setdefault(r["vertical"] or "markets",
                                 {"n": 0, "wsum": 0.0, "w": 0.0, "isum": 0.0, "all": []})
        v["n"] += 1
        v["w"] += w
        v["wsum"] += w * (r["sentiment"] or 0)
        v["isum"] += w * (r["intensity"] or 0)
        v["all"].append(r["sentiment"] or 0)
        for sym in json.loads(r["symbols"] or "[]"):
            # Read-time canonicalization too — rows ingested before the
            # crypto mapping still carry bare coin tickers.
            sym = universe._CRYPTO_CANON.get(sym, sym)
            s = symbols.setdefault(sym, {"n": 0, "wsum": 0.0, "w": 0.0, "top": None, "top_score": -1})
            s["n"] += 1
            s["w"] += w
            s["wsum"] += w * (r["sentiment"] or 0)
            if (r["score"] or 0) > s["top_score"]:
                s["top_score"] = r["score"] or 0
                s["top"] = {"title": r["title"], "url": r["url"], "platform": r["platform"], "channel": r["channel"]}

    out_v = {}
    for name, v in verticals.items():
        prev = prev_counts.get(name, 0)
        out_v[name] = {
            "posts": v["n"],
            "sentiment": round(v["wsum"] / v["w"], 3) if v["w"] else 0.0,
            "intensity": round(v["isum"] / v["w"], 3) if v["w"] else 0.0,
            "volume_change": round((v["n"] - prev) / prev, 2) if prev else None,
            # Antweiler & Frank (2004): opinion dispersion is signal, not noise
            "disagreement": finlex.disagreement(v["all"]),
        }
    out_s = sorted(
        ({"symbol": k, "posts": s["n"],
          "sentiment": round(s["wsum"] / s["w"], 3) if s["w"] else 0.0,
          "top_post": s["top"]} for k, s in symbols.items()),
        key=lambda x: -x["posts"],
    )[:12]
    return {"verticals": out_v, "symbols": out_s, "window_hours": hours}
